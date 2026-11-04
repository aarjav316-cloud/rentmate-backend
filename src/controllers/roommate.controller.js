import * as roommateService from '../services/roommate.service.js';

/**
 * Safe helper to extract the authenticated user's ID.
 * Works seamlessly whether authentication middleware mounts `req.user.id` or `req.user._id`.
 *
 * @param {Object} req - Express request object
 * @returns {string|null} User ID string or null
 */
const getUserId = (req) => req.user?.id || req.user?._id || null;

// ──────────────────────────────────────────────────────────────────────
// 1. CREATE PROFILE
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Create a new roommate profile for the authenticated user
 * @route   POST /api/v1/roommates/profile
 * @access  Private
 */
export const createProfile = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const profile = await roommateService.createRoommateProfile(userId, req.body);

    return res.status(201).json({
      success: true,
      message: 'Roommate profile created successfully',
      data: profile,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 2. GET MY PROFILE
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Get the authenticated user's roommate profile
 * @route   GET /api/v1/roommates/profile/me
 * @access  Private
 */
export const getMyProfile = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const profile = await roommateService.getMyRoommateProfile(userId);

    return res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 3. UPDATE PROFILE
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Update the authenticated user's roommate profile (partial update)
 * @route   PATCH /api/v1/roommates/profile/me
 * @access  Private
 */
export const updateProfile = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const profile = await roommateService.updateRoommateProfile(userId, req.body);

    return res.status(200).json({
      success: true,
      message: 'Roommate profile updated successfully',
      data: profile,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 4. DEACTIVATE PROFILE
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Deactivate the authenticated user's roommate profile
 * @route   PATCH /api/v1/roommates/profile/deactivate
 * @access  Private
 */
export const deactivateProfile = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const profile = await roommateService.deactivateRoommateProfile(userId);

    return res.status(200).json({
      success: true,
      message: 'Roommate profile deactivated successfully',
      data: profile,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 5. DISCOVER ROOMMATES
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Discover and rank candidate roommates with hard filters, compatibility scoring, and pagination
 * @route   GET /api/v1/roommates/discovery
 * @access  Private
 */
export const discoverRoommates = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    // Express 5 / validateQuery middleware mounts clean parsed data on req.validatedQuery
    const queryFilters = req.validatedQuery || req.query || {};

    const result = await roommateService.discoverRoommates(userId, queryFilters);

    return res.status(200).json({
      success: true,
      message: 'Roommate candidates fetched successfully',
      count: result.candidates.length,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 6. INTERACT WITH ROOMMATE
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Record LIKE or PASS interaction on a candidate roommate (creates match on mutual LIKE)
 * @route   POST /api/v1/roommates/interactions
 * @access  Private
 */
export const interactWithRoommate = async (req, res, next) => {
  try {
    const userId = getUserId(req);

    // Support target user ID from request body or URL route parameter (:id or :toUserId)
    const interactionPayload = {
      ...req.body,
      toUser: req.body?.toUser || req.params?.toUserId || req.params?.id,
    };

    const result = await roommateService.interactWithRoommate(userId, interactionPayload);

    let message;
    if (result.isMatch) {
      message = "It's a match! You and this roommate liked each other.";
    } else if (interactionPayload.action === 'LIKE') {
      message = 'Roommate liked successfully';
    } else {
      message = 'Roommate passed successfully';
    }

    const statusCode = result.isMatch ? 201 : 200;

    return res.status(statusCode).json({
      success: true,
      message,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 7. GET MY MATCHES
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Get all active roommate matches for the authenticated user with partner contact details
 * @route   GET /api/v1/roommates/matches
 * @access  Private
 */
export const getMyMatches = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const matches = await roommateService.getMyRoommateMatches(userId);

    return res.status(200).json({
      success: true,
      count: matches.length,
      data: matches,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 8. CLOSE MATCH
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Close an active roommate match (only authorized members of the match can close it)
 * @route   PATCH /api/v1/roommates/matches/:id/close
 * @access  Private
 */
export const closeMatch = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const matchId = req.params?.id || req.params?.matchId;

    const match = await roommateService.closeRoommateMatch(userId, matchId);

    return res.status(200).json({
      success: true,
      message: 'Roommate match closed successfully',
      data: match,
    });
  } catch (error) {
    next(error);
  }
};
