import PropertyPreference from '../models/propertyPreference.model.js';

// ──────────────────────────────────────────────────────────────────────
// 1. CREATE PROPERTY PREFERENCE
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Create property preferences for the authenticated user
 * @route   POST /api/v1/preferences/property
 * @access  Private
 */
export const createPropertyPreference = async (req, res, next) => {
  try {
    // Check if the user already has a preference document
    const existing = await PropertyPreference.findOne({ user: req.user.id });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Property preferences already exist. Use PATCH to update.',
      });
    }

    // Ownership is ALWAYS derived from the authenticated user — never from the client
    const preference = await PropertyPreference.create({
      ...req.body,
      user: req.user.id,
    });

    return res.status(201).json({
      success: true,
      message: 'Property preferences created successfully',
      data: preference,
    });
  } catch (error) {
    // Handle MongoDB duplicate-key error (race condition safety net)
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Property preferences already exist. Use PATCH to update.',
      });
    }
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 2. GET MY PROPERTY PREFERENCE
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Get the authenticated user's property preferences
 * @route   GET /api/v1/preferences/property
 * @access  Private
 */
export const getMyPropertyPreference = async (req, res, next) => {
  try {
    const preference = await PropertyPreference.findOne({ user: req.user.id });

    if (!preference) {
      return res.status(404).json({
        success: false,
        message: 'Property preferences not found. Create them first.',
      });
    }

    return res.status(200).json({
      success: true,
      data: preference,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 3. UPDATE MY PROPERTY PREFERENCE
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Update the authenticated user's property preferences
 * @route   PATCH /api/v1/preferences/property
 * @access  Private
 */
export const updateMyPropertyPreference = async (req, res, next) => {
  try {
    const preference = await PropertyPreference.findOne({ user: req.user.id });

    if (!preference) {
      return res.status(404).json({
        success: false,
        message: 'Property preferences not found. Create them first.',
      });
    }

    const updatedPreference = await PropertyPreference.findOneAndUpdate(
      { user: req.user.id },
      { $set: req.body },
      {
        new: true,            // Return the updated document
        runValidators: true,  // Enforce Mongoose schema validators
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Property preferences updated successfully',
      data: updatedPreference,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 4. DELETE MY PROPERTY PREFERENCE
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Delete the authenticated user's property preferences
 * @route   DELETE /api/v1/preferences/property
 * @access  Private
 */
export const deleteMyPropertyPreference = async (req, res, next) => {
  try {
    const preference = await PropertyPreference.findOneAndDelete({ user: req.user.id });

    if (!preference) {
      return res.status(404).json({
        success: false,
        message: 'Property preferences not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Property preferences deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};
