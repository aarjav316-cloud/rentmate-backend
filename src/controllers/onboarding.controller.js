import * as onboardingService from '../services/onboarding.service.js';

/**
 * @desc    Get authenticated user's onboarding status
 * @route   GET /api/v1/onboarding
 * @access  Private
 */
export const getOnboarding = async (req, res, next) => {
  try {
    const data = await onboardingService.getOnboardingStatus(req.user.id);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Save onboarding data for the authenticated user
 * @route   POST /api/v1/onboarding
 * @access  Private
 */
export const saveOnboarding = async (req, res, next) => {
  try {
    const data = await onboardingService.saveOnboarding(req.user.id, req.body);

    return res.status(200).json({
      success: true,
      message: 'Onboarding completed successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};
