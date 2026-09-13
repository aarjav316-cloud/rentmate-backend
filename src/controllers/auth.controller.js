import * as authService from '../services/auth.service.js';
import * as googleAuthService from '../services/google-auth.service.js';

/**
 * @desc    Register a new user (sends OTP, no JWT returned)
 * @route   POST /api/auth/register
 * @access  Public
 */
export const register = async (req, res, next) => {
  try {
    const data = await authService.registerUser(req.body);

    return res.status(201).json({
      success: true,
      message: 'Verification OTP sent to your email',
      data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Verify email with OTP and issue JWT tokens
 * @route   POST /api/auth/verify-email
 * @access  Public
 */
export const verifyEmail = async (req, res, next) => {
  try {
    const data = await authService.verifyEmail(req.body);

    return res.status(200).json({
      success: true,
      message: 'Email verified successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Resend verification OTP
 * @route   POST /api/auth/resend-otp
 * @access  Public
 */
export const resendOtp = async (req, res, next) => {
  try {
    await authService.resendOtp(req.body);

    return res.status(200).json({
      success: true,
      message: 'A new verification OTP has been sent',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Login user
 * @route   POST /api/auth/login
 * @access  Public
 */
export const login = async (req, res, next) => {
  try {
    const data = await authService.loginUser(req.body);

    return res.status(200).json({
      success: true,
      message: 'User logged in successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Refresh access token
 * @route   POST /api/auth/refresh-token
 * @access  Public
 */
export const refreshToken = async (req, res, next) => {
  try {
    const data = await authService.refreshUserToken(req.body);

    return res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Logout user
 * @route   POST /api/auth/logout
 * @access  Private
 */
export const logout = async (req, res, next) => {
  try {
    await authService.logoutUser(req.user);

    return res.status(200).json({
      success: true,
      message: 'User logged out successfully',
      data: null,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get current logged-in user profile
 * @route   GET /api/auth/me
 * @access  Private
 */
export const getMe = async (req, res, next) => {
  try {
    const data = await authService.getUserProfile(req.user);

    return res.status(200).json({
      success: true,
      message: 'User profile retrieved successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Handle successful Google OAuth callback and redirect to frontend with token code
 * @route   GET /api/auth/google/callback
 * @access  Public
 */
export const googleCallback = async (req, res, next) => {
  try {
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
    const code = googleAuthService.generateOAuthCode(req.user._id);
    res.redirect(`${FRONTEND_URL}/auth/google/callback?code=${code}`);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Exchange short-lived OAuth code for full JWT tokens
 * @route   POST /api/auth/google/exchange
 * @access  Public
 */
export const googleExchange = async (req, res, next) => {
  try {
    const { code } = req.body;
    const data = await googleAuthService.exchangeOAuthCode(code);

    return res.status(200).json({
      success: true,
      message: 'Google authentication successful',
      data,
    });
  } catch (error) {
    next(error);
  }
};
