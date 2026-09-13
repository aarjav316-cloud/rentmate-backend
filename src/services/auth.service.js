import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';

// Fallbacks are placed here strictly to prevent crashing, but these should live in .env
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'secret-access-key-replace-me';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'secret-refresh-key-replace-me';
const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

/**
 * Utility: Generate Access & Refresh Tokens
 * @param {string} userId
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
 * Register a new user
 * @param {Object} userData 
 */
export const registerUser = async (userData) => {
  const { email, password, name, phone, role } = userData;

  // 1. Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    const error = new Error('User already exists with this email');
    error.statusCode = 409;
    throw error;
  }

  // 2. Hash password securely
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // 3. Create database entry
  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    phone,
    role,
  });

  // 4. Generate token payload (Embedding role)
  const tokens = generateTokens(user._id, user.role);

  // 5. Exclude password structurally so it doesn't accidentally leak
  const userObj = user.toObject();
  delete userObj.password;

  return {
    user: userObj,
    ...tokens,
  };
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

  // 2. Verify hashed password comparison
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    const error = new Error('Invalid email or password');
    error.statusCode = 401;
    throw error;
  }
  
  // 3. Verify user status
  if (user.status !== 'active') {
      const error = new Error('User account is suspended or inactive');
      error.statusCode = 403;
      throw error;
  }

  // 4. Issue new tokens (Embedding role)
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
