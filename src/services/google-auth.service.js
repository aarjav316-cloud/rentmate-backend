import crypto from 'crypto';
import User from '../models/user.model.js';
import jwt from 'jsonwebtoken';

// Temporarily store codes in memory (Could be moved to Redis easily)
// Key: temporaryCode (string), Value: { userId (string), expiresAt (number) }
const oauthCodes = new Map();

// Helper copied from auth.service to keep them identical in logic and env reading structure
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'secret-access-key-replace-me';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'secret-refresh-key-replace-me';
const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

const generateTokens = (userId, role) => {
  const accessToken = jwt.sign({ id: userId, role }, JWT_ACCESS_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRES_IN,
  });
  const refreshToken = jwt.sign({ id: userId, role }, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
  });
  return { accessToken, refreshToken };
};

/**
 * Handle business logic for the Google OAuth verified profile
 */
export const handleGoogleCallback = async (profile) => {
  if (!profile.emails || !profile.emails[0].value) {
    const err = new Error('Google did not provide an email address');
    err.statusCode = 400;
    throw err;
  }

  const email = profile.emails[0].value.toLowerCase();
  const googleId = profile.id;
  
  // 1. Check if user already exists via Google Auth
  let user = await User.findOne({ googleId });

  if (user) {
    if (user.status !== 'active') {
      const err = new Error('User account is suspended or inactive');
      err.statusCode = 403;
      throw err;
    }
    return user;
  }

  // 2. Fallback: Check if email already belongs to a local account
  const localUser = await User.findOne({ email });

  if (localUser) {
    // If it's a local user without google ID, warn them to login normally
    if (localUser.authProvider === 'local') {
      const err = new Error('Account with this email already exists. Please log in with your email and password.');
      err.statusCode = 409;
      throw err;
    }
  }

  // 3. Create fresh Google User
  user = await User.create({
    name: profile.displayName,
    email: email,
    avatar: profile.photos && profile.photos[0] ? profile.photos[0].value : '',
    authProvider: 'google',
    googleId: googleId,
    isVerified: true,
    role: 'tenant', // Existing RentMate fallback
    status: 'active'
  });

  return user;
};

/**
 * Generate a cryptographically secure, temporary one-time-use code
 */
export const generateOAuthCode = (userId) => {
  const code = crypto.randomBytes(32).toString('hex');
  
  // Code expires in 3 minutes
  const expiresAt = Date.now() + 3 * 60 * 1000;
  
  oauthCodes.set(code, { userId: userId.toString(), expiresAt });
  
  return code;
};

/**
 * Exchange the single-use code for real JWT tokens
 */
export const exchangeOAuthCode = async (code) => {
  const record = oauthCodes.get(code);

  // 1. Verify existence
  if (!record) {
    const error = new Error('Invalid or expired authorization code');
    error.statusCode = 401;
    throw error;
  }

  // 2. Consume it instantly (One-Time-Use)
  oauthCodes.delete(code);

  // 3. Check expiration
  if (Date.now() > record.expiresAt) {
    const error = new Error('Authorization code has expired');
    error.statusCode = 401;
    throw error;
  }

  // 4. Retrieve User
  const user = await User.findById(record.userId);
  
  if (!user || user.status !== 'active') {
    const error = new Error('User not found or inactive');
    error.statusCode = 401;
    throw error;
  }

  // 5. Generate matching JWTs exactly like local auth
  const tokens = generateTokens(user._id, user.role);

  const userObj = user.toObject();
  delete userObj.password;

  return {
    user: userObj,
    ...tokens,
  };
};
