import Onboarding from '../models/onboarding.model.js';

/**
 * Get the onboarding status for the authenticated user.
 * Returns existing onboarding data, or a default "incomplete" response if none exists.
 */
export const getOnboardingStatus = async (userId) => {
  const onboarding = await Onboarding.findOne({ user: userId })
    .select('hasPropertyToList lookingFor onboardingCompleted')
    .lean();

  if (!onboarding) {
    return {
      hasPropertyToList: null,
      lookingFor: [],
      onboardingCompleted: false,
    };
  }

  return {
    hasPropertyToList: onboarding.hasPropertyToList,
    lookingFor: onboarding.lookingFor,
    onboardingCompleted: onboarding.onboardingCompleted,
  };
};

/**
 * Save or update onboarding data for the authenticated user.
 * Uses upsert to handle both first-time and re-submissions cleanly.
 */
export const saveOnboarding = async (userId, { hasPropertyToList, lookingFor }) => {
  const onboarding = await Onboarding.findOneAndUpdate(
    { user: userId },
    {
      user: userId,
      hasPropertyToList,
      lookingFor,
      onboardingCompleted: true,
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  )
    .select('hasPropertyToList lookingFor onboardingCompleted')
    .lean();

  return {
    hasPropertyToList: onboarding.hasPropertyToList,
    lookingFor: onboarding.lookingFor,
    onboardingCompleted: onboarding.onboardingCompleted,
  };
};
