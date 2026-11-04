import * as favoriteService from '../services/favorite.service.js';

/**
 * Safe helper to extract the authenticated user's ID.
 * Works seamlessly whether authentication middleware mounts req.user.id or req.user._id.
 *
 * @param {Object} req - Express request object
 * @returns {string|null} User ID string or null
 */
const getUserId = (req) => req.user?.id || req.user?._id || null;

/**
 * ──────────────────────────────────────────────────────────────────────
 * 1. ADD FAVORITE
 * ──────────────────────────────────────────────────────────────────────
 * @desc    Save a property to the authenticated user's favorites
 * @route   POST /api/v1/favorites/:propertyId
 * @access  Private (Authenticated users only)
 */
export const addFavorite = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { propertyId } = req.params;

    const { favorite, isNew } = await favoriteService.addFavorite(userId, propertyId);

    const statusCode = isNew ? 201 : 200;
    const message = isNew
      ? 'Property saved to favorites successfully'
      : 'Property is already in favorites';

    return res.status(statusCode).json({
      success: true,
      message,
      data: favorite,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ──────────────────────────────────────────────────────────────────────
 * 2. REMOVE FAVORITE
 * ──────────────────────────────────────────────────────────────────────
 * @desc    Remove a property from the authenticated user's favorites
 * @route   DELETE /api/v1/favorites/:propertyId
 * @access  Private (Authenticated users only)
 */
export const removeFavorite = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { propertyId } = req.params;

    await favoriteService.removeFavorite(userId, propertyId);

    return res.status(200).json({
      success: true,
      message: 'Property removed from favorites successfully',
      data: { propertyId },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ──────────────────────────────────────────────────────────────────────
 * 3. GET FAVORITES (PAGINATED)
 * ──────────────────────────────────────────────────────────────────────
 * @desc    Get all saved properties for the authenticated user
 * @route   GET /api/v1/favorites
 * @access  Private (Authenticated users only)
 */
export const getFavorites = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    // Prefer validated query parsed by Zod validateQuery middleware
    const query = req.validatedQuery || req.query || {};

    const { favorites, pagination } = await favoriteService.getFavorites(userId, {
      page: query.page,
      limit: query.limit,
    });

    return res.status(200).json({
      success: true,
      count: favorites.length,
      data: favorites,
      pagination,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * ──────────────────────────────────────────────────────────────────────
 * 4. GET FAVORITE IDS (LIGHTWEIGHT)
 * ──────────────────────────────────────────────────────────────────────
 * @desc    Get array of saved property IDs for fast frontend lookup
 * @route   GET /api/v1/favorites/ids
 * @access  Private (Authenticated users only)
 */
export const getFavoriteIds = async (req, res, next) => {
  try {
    const userId = getUserId(req);

    const propertyIds = await favoriteService.getFavoriteIds(userId);

    return res.status(200).json({
      success: true,
      count: propertyIds.length,
      data: propertyIds,
    });
  } catch (error) {
    next(error);
  }
};
