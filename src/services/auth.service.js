import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';
import { generateOtp } from '../utils/otp.utils.js';
import { storeOtp, verifyOtp, canResendOtp, invalidateOtp } from './otp.service.js';
import { sendVerificationOtpEmail } from './email.service.js';

// Fallbacks are placed here strictly to prevent crashing, but these should live in .env
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'secret-access-key-replace-me';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'secret-refresh-key-replace-me';
const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

/**
 * Utility: Generate Access & Refresh Tokens
 * @param {string} userId
 * @param {string} role
 */
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
 * Register a new user (creates unverified account and sends OTP)
 * @param {Object} userData 
 */
export const registerUser = async (userData) => {
  const { email, password, name, phone, role } = userData;

  // 1. Check if user already exists
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    // If Google account exists with this email
    if (existingUser.authProvider === 'google') {
      const error = new Error('An account already exists with this email. Please continue with Google.');
      error.statusCode = 409;
      error.code = 'GOOGLE_ACCOUNT_EXISTS';
      throw error;
    }

    // If a verified local account exists
    if (existingUser.isVerified) {
      const error = new Error('User already exists with this email');
      error.statusCode = 409;
      throw error;
    }

    // If an unverified local account exists — resend OTP for that account
    // Update their details in case they changed name/password during re-registration
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    existingUser.name = name;
    existingUser.password = hashedPassword;
    if (phone) existingUser.phone = phone;
    if (role) existingUser.role = role;
    await existingUser.save();

    // Generate and send fresh OTP
    const otp = generateOtp();
    await storeOtp(email, otp);

    try {
      await sendVerificationOtpEmail(email, otp);
    } catch (emailErr) {
      console.error('Failed to send verification email:', emailErr.message);
      const error = new Error('Failed to send verification email. Please try resending the OTP.');
      error.statusCode = 503;
      error.code = 'EMAIL_SEND_FAILED';
      throw error;
    }

    return {
      email: existingUser.email,
      requiresVerification: true,
    };
  }

  // 2. Hash password securely
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // 3. Create database entry with isVerified = false (default from schema)
  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    phone,
    role,
    authProvider: 'local',
    isVerified: false,
  });

  // 4. Generate OTP, store hash, send email
  const otp = generateOtp();
  await storeOtp(email, otp);

  try {
    await sendVerificationOtpEmail(email, otp);
  } catch (emailErr) {
    console.error('Failed to send verification email:', emailErr.message);
    const error = new Error('Account created but failed to send verification email. Please try resending the OTP.');
    error.statusCode = 503;
    error.code = 'EMAIL_SEND_FAILED';
    throw error;
  }

  // 5. Return only email + verification flag (NO tokens yet)
  return {
    email: user.email,
    requiresVerification: true,
  };
};


/**
 * Verify email using OTP and issue JWT tokens
 * @param {Object} data - { email, otp }
 */
export const verifyEmail = async ({ email, otp }) => {
  // 1. Find the user
  const user = await User.findOne({ email, authProvider: 'local' });

  if (!user) {
    const error = new Error('No account found with this email');
    error.statusCode = 404;
    throw error;
  }

  if (user.isVerified) {
    const error = new Error('Email is already verified');
    error.statusCode = 400;
    error.code = 'ALREADY_VERIFIED';
    throw error;
  }

  // 2. Verify OTP through the OTP service
  const result = await verifyOtp(email, otp);

  if (!result.valid) {
    const statusMap = {
      OTP_EXPIRED: 410,
      TOO_MANY_ATTEMPTS: 429,
      OTP_INVALID: 401,
    };
    const error = new Error(
      result.code === 'OTP_EXPIRED'
        ? 'OTP has expired. Please request a new one.'
        : result.code === 'TOO_MANY_ATTEMPTS'
          ? 'Too many failed attempts. Please request a new OTP.'
          : 'Invalid OTP. Please try again.'
    );
    error.statusCode = statusMap[result.code] || 400;
    error.code = result.code;
    throw error;
  }

  // 3. Mark user as verified
  user.isVerified = true;
  await user.save();

  // 4. Generate JWT tokens (same as login)
  const tokens = generateTokens(user._id, user.role);

  const userObj = user.toObject();
  delete userObj.password;

  return {
    user: userObj,
    ...tokens,
  };
};


/**
 * Resend OTP to an unverified user
 * @param {Object} data - { email }
 */
export const resendOtp = async ({ email }) => {
  // 1. Find user
  const user = await User.findOne({ email, authProvider: 'local' });

  if (!user) {
    const error = new Error('No account found with this email');
    error.statusCode = 404;
    throw error;
  }

  if (user.isVerified) {
    const error = new Error('Email is already verified');
    error.statusCode = 400;
    error.code = 'ALREADY_VERIFIED';
    throw error;
  }

  // 2. Check cooldown
  const cooldownCheck = await canResendOtp(email);
  if (!cooldownCheck.allowed) {
    const error = new Error(
      `Please wait ${Math.ceil(cooldownCheck.retryAfterMs / 1000)} seconds before requesting a new OTP.`
    );
    error.statusCode = 429;
    error.code = 'OTP_RESEND_COOLDOWN';
    throw error;
  }

  // 3. Generate, store, send new OTP (old one is overwritten)
  const otp = generateOtp();
  await storeOtp(email, otp);

  try {
    await sendVerificationOtpEmail(email, otp);
  } catch (emailErr) {
    console.error('Failed to resend verification email:', emailErr.message);
    const error = new Error('Failed to send verification email. Please try again later.');
    error.statusCode = 503;
    error.code = 'EMAIL_SEND_FAILED';
    throw error;
  }

  return { email };
};


/**
 * Login user via email and password
 * @param {Object} loginData 
 */
export const loginUser = async (loginData) => {
  const { email, password } = loginData;

  // 1. Find the user. Note that we explicitly select the password here because the model hides it by default
  const user = await User.findOne({ email }).select('+password');
  
  if (!user) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  // 1.5 If it's a Google account, they should use Google login
  if (user.authProvider === 'google') {
    const error = new Error('This account uses Google sign-in. Please continue with Google.');
    error.statusCode = 400;
    error.code = 'GOOGLE_ACCOUNT_EXISTS';
    throw error;
  }

  // 2. Verify hashed password comparison
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }

  // 3. Check email verification status
  if (!user.isVerified) {
    const error = new Error('Please verify your email before logging in.');
    error.statusCode = 403;
    error.code = 'EMAIL_NOT_VERIFIED';
    throw error;
  }
  
  // 4. Verify user status
  if (user.status !== 'active') {
      const error = new Error('User account is suspended or inactive');
      error.statusCode = 403;
      throw error;
  }

  // 5. Issue new tokens (Embedding role)
  const tokens = generateTokens(user._id, user.role);

  const userObj = user.toObject();
  delete userObj.password;

  return {
    user: userObj,
    ...tokens,
  };
};


/**
 * Reissue a new set of Access & Refresh Tokens using a valid existing Refresh Token
 * @param {Object} tokenPayload 
 */
export const refreshUserToken = async ({ refreshToken }) => {
  try {
    // 1. Verify the authenticity/expiry of the incoming refresh token
    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);

    // 2. Lookup user to ensure they are fully active/exist and haven't been banned
    const user = await User.findById(decoded.id);
    if (!user || user.status !== 'active') {
      const error = new Error('User not found or inactive');
      error.statusCode = 401;
      throw error; 
    }

    // NOTE: Space left intentionally here to hook into a Redis store later 
    // to check for blacklisted/revoked refresh tokens.

    // 3. Generate a brand new token pair (Token Rotation & embedding role)
    const tokens = generateTokens(user._id, user.role);

    return tokens;
  } catch (error) {
    // jwt.verify automatically throws if expired or modified, we catch it securely
    const customError = new Error('Session expired or token invalid');
    customError.statusCode = 401;
    throw customError;
  }
};


/**
 * Handle user logout logic
 * @param {Object} userSession 
 */
export const logoutUser = async (userSession) => {
  // If no session exists gracefully succeed
  if (!userSession || !userSession.id) return true;

  // In the future (Redis integration step), you would:
  // 1. Retrieve the incoming token or token jti
  // 2. Push it to a redis 'blacklist' set so it can no longer be used.
  // await redisClient.set(`blacklist_${token}`, true, 'EX', tokenExpiryInSeconds);
  
  return true;
};


/**
 * Get profile data for the currently authenticated User
 * @param {Object} userSession 
 */
export const getUserProfile = async (userSession) => {
  // Guarantee there is session injection originating from auth middleware
  if (!userSession || !userSession.id) {
    const error = new Error('Not authorized');
    error.statusCode = 401;
    throw error;
  }

  // Mongoose automatically excludes `password` due to the schema rule `select: false`
  const user = await User.findById(userSession.id);
  
  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  return user;
};
