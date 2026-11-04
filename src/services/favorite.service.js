import mongoose from 'mongoose';
import Favorite from '../models/favorite.model.js';
import Property from '../models/property.model.js';

/**
 * Safe owner fields to populate when exposing property creator info.
 * Mirrors the safe projection used across Property controllers.
 */
const OWNER_PUBLIC_FIELDS = 'name email avatar phone';

/**
 * ──────────────────────────────────────────────────────────────────────
 * 1. ADD FAVORITE
 * ──────────────────────────────────────────────────────────────────────
 * Saves a property to the authenticated user's favorites list.
 * 
 * Business Rules:
 * - Property must exist in database.
 * - Property must have status 'AVAILABLE'.
 * - User cannot favorite their own property listing.
 * - Database compound unique index { user: 1, property: 1 } prevents duplicates.
 * - Duplicate-key error 11000 is handled gracefully and idempotently.
 *
 * @param {string} userId - Authenticated user's ID
 * @param {string} propertyId - ID of property to favorite
 * @returns {Promise<{ favorite: Object, isNew: boolean }>}
 */
export const addFavorite = async (userId, propertyId) => {
  // 1. Verify property existence
  const property = await Property.findById(propertyId).lean();
  if (!property) {
    const error = new Error('Property not found');
    error.statusCode = 404;
    error.code = 'PROPERTY_NOT_FOUND';
    throw error;
  }

  // 2. Business rule: Prevent favoriting own listing
  if (property.createdBy && property.createdBy.toString() === userId.toString()) {
    const error = new Error('You cannot save your own property listing to favorites');
    error.statusCode = 400;
    error.code = 'CANNOT_FAVORITE_OWN_PROPERTY';
    throw error;
  }

  // 3. Business rule: Property must be currently available
  if (property.status !== 'AVAILABLE') {
    const error = new Error(`Cannot favorite a property that is currently ${property.status.toLowerCase()}`);
    error.statusCode = 400;
    error.code = 'PROPERTY_NOT_AVAILABLE';
    throw error;
  }

  // 4. Create Favorite with graceful 11000 duplicate handling
  try {
    const favorite = await Favorite.create({
      user: userId,
      property: propertyId,
    });

    return {
      favorite,
      isNew: true,
    };
  } catch (error) {
    if (error.code === 11000) {
      // Race condition / already favorited: fetch existing record idempotently
      const existingFavorite = await Favorite.findOne({
        user: userId,
        property: propertyId,
      }).lean();

      return {
        favorite: existingFavorite,
        isNew: false,
      };
    }
    throw error;
  }
};

/**
 * ──────────────────────────────────────────────────────────────────────
 * 2. REMOVE FAVORITE
 * ──────────────────────────────────────────────────────────────────────
 * Removes a property from the authenticated user's favorites list.
 * Enforces ownership: users can only delete their own favorites.
 *
 * @param {string} userId - Authenticated user's ID
 * @param {string} propertyId - ID of property to remove
 * @returns {Promise<Object>} The removed favorite document
 */
export const removeFavorite = async (userId, propertyId) => {
  const favorite = await Favorite.findOneAndDelete({
    user: userId,
    property: propertyId,
  });

  if (!favorite) {
    const error = new Error('Favorite not found or already removed');
    error.statusCode = 404;
    error.code = 'FAVORITE_NOT_FOUND';
    throw error;
  }

  return favorite;
};

/**
 * ──────────────────────────────────────────────────────────────────────
 * 3. GET FAVORITES (PAGINATED)
 * ──────────────────────────────────────────────────────────────────────
 * Retrieves all saved properties for the authenticated user with full
 * property details, owner information, and database-level pagination.
 *
 * Performance:
 * - Employs index { user: 1, createdAt: -1 } to avoid memory SORT stages.
 * - Safely handles dangling references if a saved property was deleted.
 *
 * @param {string} userId - Authenticated user's ID
 * @param {Object} pagination - Validated pagination params ({ page, limit })
 * @returns {Promise<{ favorites: Array, pagination: Object }>}
 */
export const getFavorites = async (userId, { page = 1, limit = 12 } = {}) => {
  const skip = (page - 1) * limit;

  // Run query and count in parallel for optimal throughput
  const [rawFavorites, total] = await Promise.all([
    Favorite.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: 'property',
        populate: {
          path: 'createdBy',
          select: OWNER_PUBLIC_FIELDS,
        },
      })
      .lean(),
    Favorite.countDocuments({ user: userId }),
  ]);

  // Safely filter out any orphaned records where the property listing was deleted
  const validFavorites = rawFavorites.filter((fav) => fav.property != null);

  const totalPages = Math.ceil(total / limit);

  return {
    favorites: validFavorites,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
};

/**
 * ──────────────────────────────────────────────────────────────────────
 * 4. GET FAVORITE IDS (LIGHTWEIGHT)
 * ──────────────────────────────────────────────────────────────────────
 * Retrieves only the array of property IDs favorited by the user.
 * 
 * Performance:
 * - Index-covered query projecting only the property field.
 * - Zero population overhead.
 * - Used by frontend to construct an O(1) Set for instantaneous heart icons.
 *
 * @param {string} userId - Authenticated user's ID
 * @returns {Promise<string[]>} Array of property ID strings
 */
export const getFavoriteIds = async (userId) => {
  const favorites = await Favorite.find({ user: userId })
    .select('property -_id')
    .lean();

  const propertyIds = favorites
    .map((fav) => fav.property?.toString())
    .filter(Boolean);

  return propertyIds;
};
