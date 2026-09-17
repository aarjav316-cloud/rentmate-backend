import mongoose from 'mongoose';
import Property from '../models/property.model.js';

/**
 * Validate a string as a valid MongoDB ObjectId.
 * Returns a clean 400 error instead of letting Mongoose throw a raw CastError.
 */
const assertValidId = (id, res) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({
      success: false,
      message: 'Invalid property ID format',
    });
    return false;
  }
  return true;
};

/**
 * Safe owner fields to populate when exposing property creator info.
 * Never expose password, tokens, or internal auth fields.
 */
const OWNER_PUBLIC_FIELDS = 'name email avatar phone';

// ──────────────────────────────────────────────────────────────────────
// 1. CREATE PROPERTY
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Create a new property listing
 * @route   POST /api/v1/properties
 * @access  Private
 */
export const createProperty = async (req, res, next) => {
  try {
    // Ownership is ALWAYS derived from the authenticated user — never from the client
    const propertyData = {
      ...req.body,
      createdBy: req.user.id,
    };

    const property = await Property.create(propertyData);

    return res.status(201).json({
      success: true,
      message: 'Property created successfully',
      data: property,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 2. GET ALL PROPERTIES (public, AVAILABLE only)
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Get all available properties
 * @route   GET /api/v1/properties
 * @access  Public
 */
export const getProperties = async (req, res, next) => {
  try {
    const properties = await Property.find({ status: 'AVAILABLE' })
      .populate('createdBy', OWNER_PUBLIC_FIELDS)
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: properties.length,
      data: properties,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 3. GET SINGLE PROPERTY
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Get a single property by ID
 * @route   GET /api/v1/properties/:id
 * @access  Public
 */
export const getPropertyById = async (req, res, next) => {
  try {
    if (!assertValidId(req.params.id, res)) return;

    const property = await Property.findById(req.params.id)
      .populate('createdBy', OWNER_PUBLIC_FIELDS);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: property,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 4. UPDATE PROPERTY
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Update a property (owner only)
 * @route   PATCH /api/v1/properties/:id
 * @access  Private
 */
export const updateProperty = async (req, res, next) => {
  try {
    if (!assertValidId(req.params.id, res)) return;

    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    // Ownership check — only the creator can update
    if (property.createdBy.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this property',
      });
    }

    const updatedProperty = await Property.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      {
        new: true,            // Return the updated document
        runValidators: true,  // Enforce Mongoose schema validators
      }
    ).populate('createdBy', OWNER_PUBLIC_FIELDS);

    return res.status(200).json({
      success: true,
      message: 'Property updated successfully',
      data: updatedProperty,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 5. DELETE PROPERTY
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Delete a property (owner only)
 * @route   DELETE /api/v1/properties/:id
 * @access  Private
 */
export const deleteProperty = async (req, res, next) => {
  try {
    if (!assertValidId(req.params.id, res)) return;

    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    // Ownership check — only the creator can delete
    if (property.createdBy.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to delete this property',
      });
    }

    await Property.findByIdAndDelete(req.params.id);

    return res.status(200).json({
      success: true,
      message: 'Property deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 6. GET MY PROPERTIES
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Get all properties created by the authenticated user
 * @route   GET /api/v1/properties/my
 * @access  Private
 */
export const getMyProperties = async (req, res, next) => {
  try {
    const properties = await Property.find({ createdBy: req.user.id })
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: properties.length,
      data: properties,
    });
  } catch (error) {
    next(error);
  }
};
