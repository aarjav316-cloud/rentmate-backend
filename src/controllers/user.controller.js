import * as userService from '../services/user.service.js';

/**
 * @desc    Get authenticated user's profile
 * @route   GET /api/v1/users/me
 * @access  Private
 */
export const getProfile = async (req, res, next) => {
  try {
    const user = await userService.getUserProfile(req.user.id);

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update authenticated user's profile
 * @route   PATCH /api/v1/users/me
 * @access  Private
 */
export const updateProfile = async (req, res, next) => {
  try {
    const user = await userService.updateUserProfile(req.user.id, req.body);

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: user,
    });
  } catch (error) {
    next(error);
  }
};
