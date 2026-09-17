import User from '../models/user.model.js';

/**
 * Fetch the authenticated user's profile.
 * Password is excluded by schema default (select: false).
 * @param {string} userId
 * @returns {Promise<Object>}
 */
export const getUserProfile = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  return user;
};

/**
 * Update the authenticated user's profile.
 * Only whitelisted fields are written — everything else is ignored
 * even if it somehow bypasses Zod (defense in depth).
 * @param {string} userId
 * @param {Object} updateData - Validated fields from Zod
 * @returns {Promise<Object>}
 */
export const updateUserProfile = async (userId, updateData) => {
  // Whitelist: only these fields can ever be written through this endpoint
  const ALLOWED_FIELDS = ['name', 'phone', 'avatar'];

  const sanitised = {};
  for (const field of ALLOWED_FIELDS) {
    if (updateData[field] !== undefined) {
      sanitised[field] = updateData[field];
    }
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { $set: sanitised },
    {
      new: true,           // Return the updated document
      runValidators: true,  // Run Mongoose schema validators
    }
  );

  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  return user;
};
