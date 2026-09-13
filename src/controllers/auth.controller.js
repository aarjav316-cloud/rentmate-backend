import * as authService from '../services/auth.service.js';

/**
 * @desc    Register a new user
 * @route   POST /api/auth/register
 * @access  Public
 */
export const register = async (req, res, next) => {
  try {
    // The req.body is already validated by the Zod middleware before reaching here
    const data = await authService.registerUser(req.body);

    return res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data,
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
    // Assuming refresh token might be passed in body or cookies depending on config.
    // For now passing req.body exactly as validated by our schema
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
    // Handled in the service layer (e.g., blacklisting tokens, modifying user records)
    // Safe to pass req.user which would be injected by a future protect/auth middleware
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
