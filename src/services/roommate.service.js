import mongoose from 'mongoose';
import RoommateProfile from '../models/roommateProfile.model.js';
import RoommateInteraction from '../models/roommateInteraction.model.js';
import RoommateMatch from '../models/roommateMatch.model.js';
import PropertyPreference from '../models/propertyPreference.model.js';
import { calculateRoommateCompatibility } from '../utils/roommateScoring.utils.js';

// ── Helpers ───────────────────────────────────────────────────────────

const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ──────────────────────────────────────────────────────────────────────
// 1. CREATE ROOMMATE PROFILE
// ──────────────────────────────────────────────────────────────────────

/**
 * Creates a new roommate profile for the authenticated user.
 * Enforces one profile per user and rejects duplicates.
 *
 * @param {string} userId - Authenticated user's ID
 * @param {Object} profileData - Validated profile fields from Zod
 * @returns {Promise<Object>} Created profile document
 */
export const createRoommateProfile = async (userId, profileData) => {
  // Check if profile already exists for this user
  const existing = await RoommateProfile.findOne({ user: userId });
  if (existing) {
    const error = new Error('Roommate profile already exists. Use update to modify your profile.');
    error.statusCode = 409;
    error.code = 'ROOMMATE_PROFILE_EXISTS';
    throw error;
  }

  try {
    const profile = await RoommateProfile.create({
      ...profileData,
      user: userId,
      isActive: true,
    });
    return profile;
  } catch (error) {
    // Handle concurrent duplicate-key race condition
    if (error.code === 11000) {
      const conflictError = new Error('Roommate profile already exists. Use update to modify your profile.');
      conflictError.statusCode = 409;
      conflictError.code = 'ROOMMATE_PROFILE_EXISTS';
      throw conflictError;
    }
    throw error;
  }
};

// ──────────────────────────────────────────────────────────────────────
// 2. GET MY ROOMMATE PROFILE
// ──────────────────────────────────────────────────────────────────────

/**
 * Retrieves the authenticated user's roommate profile.
 *
 * @param {string} userId - Authenticated user's ID
 * @returns {Promise<Object>} Roommate profile document populated with user details
 */
export const getMyRoommateProfile = async (userId) => {
  const profile = await RoommateProfile.findOne({ user: userId }).populate(
    'user',
    'name avatar email phone'
  );

  if (!profile) {
    const error = new Error('Roommate profile not found. Please create one first.');
    error.statusCode = 404;
    error.code = 'PROFILE_NOT_FOUND';
    throw error;
  }

  return profile;
};

// ──────────────────────────────────────────────────────────────────────
// 3. UPDATE ROOMMATE PROFILE
// ──────────────────────────────────────────────────────────────────────

/**
 * Supports partial updates to the authenticated user's roommate profile.
 * Re-validates budget relationships against existing values when partial updates occur.
 *
 * @param {string} userId - Authenticated user's ID
 * @param {Object} updateData - Partial validated update fields from Zod
 * @returns {Promise<Object>} Updated profile document
 */
export const updateRoommateProfile = async (userId, updateData) => {
  const profile = await RoommateProfile.findOne({ user: userId });

  if (!profile) {
    const error = new Error('Roommate profile not found. Please create one first.');
    error.statusCode = 404;
    error.code = 'PROFILE_NOT_FOUND';
    throw error;
  }

  // Cross-validate budget when only one bound is updated
  const effectiveMin = updateData.budgetMin !== undefined ? updateData.budgetMin : profile.budgetMin;
  const effectiveMax = updateData.budgetMax !== undefined ? updateData.budgetMax : profile.budgetMax;

  if (
    effectiveMin !== undefined &&
    effectiveMin !== null &&
    effectiveMax !== undefined &&
    effectiveMax !== null &&
    effectiveMin > effectiveMax
  ) {
    const error = new Error('Minimum budget cannot exceed maximum budget');
    error.statusCode = 400;
    error.code = 'INVALID_BUDGET_RANGE';
    throw error;
  }

  // Update scalar fields
  const ALLOWED_FIELDS = ['bio', 'gender', 'age', 'occupation', 'budgetMin', 'budgetMax'];
  for (const field of ALLOWED_FIELDS) {
    if (updateData[field] !== undefined) {
      profile[field] = updateData[field];
    }
  }

  // Handle lifestyle / lifestylePreferences update
  const incomingLifestyle = updateData.lifestylePreferences || updateData.lifestyle;
  if (incomingLifestyle) {
    profile.lifestylePreferences = {
      ...(profile.lifestylePreferences ? profile.lifestylePreferences.toObject() : {}),
      ...incomingLifestyle,
    };
  }

  await profile.save();
  return profile;
};

// ──────────────────────────────────────────────────────────────────────
// 4. DEACTIVATE ROOMMATE PROFILE
// ──────────────────────────────────────────────────────────────────────

/**
 * Deactivates the authenticated user's roommate profile so it no longer
 * appears in candidate discovery.
 *
 * @param {string} userId - Authenticated user's ID
 * @returns {Promise<Object>} Deactivated profile document
 */
export const deactivateRoommateProfile = async (userId) => {
  const profile = await RoommateProfile.findOne({ user: userId });

  if (!profile) {
    const error = new Error('Roommate profile not found. Please create one first.');
    error.statusCode = 404;
    error.code = 'PROFILE_NOT_FOUND';
    throw error;
  }

  profile.isActive = false;
  await profile.save();

  return profile;
};

// ──────────────────────────────────────────────────────────────────────
// 5. DISCOVER ROOMMATES
// ──────────────────────────────────────────────────────────────────────

/**
 * Discovers and ranks roommate candidates based on:
 *   - Only active profiles.
 *   - Excluding current user and already interacted users (LIKE/PASS).
 *   - Hard filtering on common preferred city (via PropertyPreference).
 *   - Gender filtering defaulting to 'ANY'.
 *   - Ranking by compatibility score calculated with calculateRoommateCompatibility.
 *   - Pagination.
 *   - Zero private contact exposure (email/phone excluded).
 *
 * @param {string} userId - Authenticated user's ID
 * @param {Object} queryFilters - Validated query parameters
 * @returns {Promise<Object>} Paginated ranked candidates and pagination metadata
 */
export const discoverRoommates = async (userId, queryFilters = {}) => {
  // 1. Ensure current user has an active profile
  const myProfile = await RoommateProfile.findOne({ user: userId }).lean();
  if (!myProfile) {
    const error = new Error('Roommate profile not found. Please create one first.');
    error.statusCode = 404;
    error.code = 'PROFILE_NOT_FOUND';
    throw error;
  }

  if (!myProfile.isActive) {
    const error = new Error('Your roommate profile is inactive. Please activate it to discover roommates.');
    error.statusCode = 400;
    error.code = 'PROFILE_INACTIVE';
    throw error;
  }

  // 2. Load current user's PropertyPreference
  const myPreference = await PropertyPreference.findOne({ user: userId }).lean();

  // 3. Determine hard filter cities
  let targetCities = [];
  if (queryFilters.city && queryFilters.city.trim() !== '') {
    targetCities = [queryFilters.city.trim()];
  } else if (myPreference?.preferredLocations?.length > 0) {
    targetCities = myPreference.preferredLocations.map((c) => c.trim()).filter(Boolean);
  }

  if (targetCities.length === 0) {
    const error = new Error(
      'Please set preferred locations in your property preferences or specify a city query filter to discover roommates.'
    );
    error.statusCode = 400;
    error.code = 'LOCATION_PREFERENCE_REQUIRED';
    throw error;
  }

  // 4. Find candidate users who share at least one preferred city
  const cityRegexes = targetCities.map((city) => new RegExp(`^${escapeRegex(city)}$`, 'i'));
  const candidatePreferences = await PropertyPreference.find({
    user: { $ne: userId },
    preferredLocations: { $in: cityRegexes },
  })
    .select('user preferredLocations preferredAvailableFrom minRent maxRent')
    .lean();

  if (candidatePreferences.length === 0) {
    return {
      candidates: [],
      pagination: {
        total: 0,
        page: Number(queryFilters.page) || 1,
        limit: Number(queryFilters.limit) || 12,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      },
    };
  }

  const prefByUserId = new Map(
    candidatePreferences.map((pref) => [pref.user.toString(), pref])
  );
  const potentialUserIds = candidatePreferences.map((pref) => pref.user);

  // 5. Exclude already interacted candidates (LIKE or PASS)
  const interactedUserIds = await RoommateInteraction.find({
    fromUser: userId,
  }).distinct('toUser');

  const interactedSet = new Set(interactedUserIds.map((id) => id.toString()));
  const eligibleUserIds = potentialUserIds.filter(
    (id) => !interactedSet.has(id.toString())
  );

  if (eligibleUserIds.length === 0) {
    return {
      candidates: [],
      pagination: {
        total: 0,
        page: Number(queryFilters.page) || 1,
        limit: Number(queryFilters.limit) || 12,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      },
    };
  }

  // 6. Build query for active candidate profiles
  const profileQuery = {
    user: { $in: eligibleUserIds },
    isActive: true,
  };

  // Gender filter: defaults to 'ANY' if omitted or explicit 'ANY'
  if (queryFilters.gender && queryFilters.gender !== 'ANY') {
    profileQuery.gender = queryFilters.gender;
  }

  // Age filters
  if (queryFilters.minAge !== undefined || queryFilters.maxAge !== undefined) {
    profileQuery.age = {};
    if (queryFilters.minAge !== undefined) {
      profileQuery.age.$gte = Number(queryFilters.minAge);
    }
    if (queryFilters.maxAge !== undefined) {
      profileQuery.age.$lte = Number(queryFilters.maxAge);
    }
  }

  // Budget filters (query bounds)
  if (queryFilters.budgetMax !== undefined) {
    profileQuery.budgetMin = { $lte: Number(queryFilters.budgetMax) };
  }
  if (queryFilters.budgetMin !== undefined) {
    profileQuery.budgetMax = { $gte: Number(queryFilters.budgetMin) };
  }

  // Lifestyle filters
  const LIFESTYLE_FIELDS = [
    'cleanliness',
    'sleepSchedule',
    'smoking',
    'drinking',
    'pets',
    'diet',
    'guests',
  ];
  for (const field of LIFESTYLE_FIELDS) {
    if (queryFilters[field]) {
      profileQuery[`lifestylePreferences.${field}`] = queryFilters[field];
    }
  }

  // Keyword search on bio or occupation
  if (queryFilters.search && queryFilters.search.trim() !== '') {
    const sRegex = new RegExp(escapeRegex(queryFilters.search.trim()), 'i');
    profileQuery.$or = [{ bio: sRegex }, { occupation: sRegex }];
  }

  // 7. Query candidate profiles — ONLY populate public fields (name, avatar, _id)
  const candidateProfiles = await RoommateProfile.find(profileQuery)
    .populate('user', 'name avatar')
    .lean();

  if (candidateProfiles.length === 0) {
    return {
      candidates: [],
      pagination: {
        total: 0,
        page: Number(queryFilters.page) || 1,
        limit: Number(queryFilters.limit) || 12,
        totalPages: 0,
        hasNextPage: false,
        hasPrevPage: false,
      },
    };
  }

  // 8. Calculate compatibility scores for all candidates
  const scoredCandidates = candidateProfiles.map((candidate) => {
    const candidatePref = prefByUserId.get(candidate.user._id.toString()) || null;
    const scoring = calculateRoommateCompatibility(
      myProfile,
      candidate,
      myPreference,
      candidatePref
    );

    return {
      ...candidate,
      compatibilityScore: scoring.compatibilityScore,
      factorScores: scoring.factorScores,
      factorPercentages: scoring.factorPercentages,
      reasons: scoring.reasons,
      factorDetails: scoring.factorDetails,
    };
  });

  // 9. Rank candidates (default: compatibilityScore descending)
  const sortBy = queryFilters.sortBy || 'compatibility';
  const sortOrder = queryFilters.sortOrder === 'asc' ? 1 : -1;

  scoredCandidates.sort((a, b) => {
    if (sortBy === 'budgetMin') {
      const aVal = a.budgetMin ?? 0;
      const bVal = b.budgetMin ?? 0;
      return (aVal - bVal) * sortOrder;
    }
    if (sortBy === 'budgetMax') {
      const aVal = a.budgetMax ?? 0;
      const bVal = b.budgetMax ?? 0;
      return (aVal - bVal) * sortOrder;
    }
    if (sortBy === 'age') {
      const aVal = a.age ?? 0;
      const bVal = b.age ?? 0;
      return (aVal - bVal) * sortOrder;
    }
    if (sortBy === 'createdAt') {
      const aVal = new Date(a.createdAt).getTime();
      const bVal = new Date(b.createdAt).getTime();
      return (aVal - bVal) * sortOrder;
    }
    // Default: compatibilityScore descending
    return (b.compatibilityScore - a.compatibilityScore) * (sortOrder === -1 ? 1 : -1);
  });

  // 10. Pagination
  const page = Math.max(1, Number(queryFilters.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(queryFilters.limit) || 12));
  const total = scoredCandidates.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const startIndex = (page - 1) * limit;
  const paginatedCandidates = scoredCandidates.slice(startIndex, startIndex + limit);

  return {
    candidates: paginatedCandidates,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
};

// ──────────────────────────────────────────────────────────────────────
// 6. INTERACT WITH ROOMMATE (LIKE / PASS)
// ──────────────────────────────────────────────────────────────────────

/**
 * Records a user's LIKE or PASS decision on a candidate roommate.
 * Uses a Mongoose session and transaction for multi-document writes (interaction + match creation).
 * Handles race conditions and mutual likes concurrently and safely without attempting
 * queries on aborted transactions.
 *
 * @param {string} fromUserId - Authenticated user's ID
 * @param {string|Object} targetUserId - Target roommate user ID (or object containing targetUserId/action)
 * @param {string|Object} [actionInput] - Interaction action 'LIKE' | 'PASS' (or object containing action)
 * @returns {Promise<Object>} { interaction, isMatch, match }
 */
export const interactWithRoommate = async (fromUserId, targetUserId, actionInput) => {
  let targetId = targetUserId;
  let action = actionInput;

  // Support both (fromUserId, targetUserId, action) and legacy object payloads
  if (typeof targetUserId === 'object' && targetUserId !== null) {
    targetId = targetUserId.targetUserId || targetUserId.toUser || targetUserId.userId;
    action = targetUserId.action;
  } else if (typeof actionInput === 'object' && actionInput !== null) {
    action = actionInput.action;
  }

  // Normalize action string
  if (typeof action === 'string') {
    action = action.trim().toUpperCase();
  }

  if (!fromUserId) {
    const error = new Error('Authenticated user ID is required');
    error.statusCode = 401;
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  if (!targetId) {
    const error = new Error('Target user ID is required');
    error.statusCode = 400;
    error.code = 'TARGET_USER_REQUIRED';
    throw error;
  }

  if (!mongoose.Types.ObjectId.isValid(fromUserId)) {
    const error = new Error('Invalid authenticated user ID format');
    error.statusCode = 400;
    error.code = 'INVALID_USER_ID';
    throw error;
  }

  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    const error = new Error('Invalid target user ID format');
    error.statusCode = 400;
    error.code = 'INVALID_TARGET_USER_ID';
    throw error;
  }

  // Prevent self-interaction
  if (fromUserId.toString() === targetId.toString()) {
    const error = new Error('You cannot interact with yourself');
    error.statusCode = 400;
    error.code = 'SELF_INTERACTION_FORBIDDEN';
    throw error;
  }

  // Validate action
  if (!action || !['LIKE', 'PASS'].includes(action)) {
    const error = new Error('Action must be LIKE or PASS');
    error.statusCode = 400;
    error.code = 'INVALID_ACTION';
    throw error;
  }

  // Verify target user has an active roommate profile
  const targetProfile = await RoommateProfile.findOne({ user: targetId, isActive: true });
  if (!targetProfile) {
    const error = new Error('Target roommate profile not found or is inactive');
    error.statusCode = 404;
    error.code = 'TARGET_PROFILE_NOT_FOUND';
    throw error;
  }

  // Verify current user has an active roommate profile
  const fromProfile = await RoommateProfile.findOne({ user: fromUserId, isActive: true });
  if (!fromProfile) {
    const error = new Error('You must have an active roommate profile to interact');
    error.statusCode = 400;
    error.code = 'PROFILE_INACTIVE';
    throw error;
  }

  // Pre-check for existing interaction before starting transaction
  const existingInteraction = await RoommateInteraction.findOne({
    fromUser: fromUserId,
    toUser: targetId,
  });

  if (existingInteraction) {
    const error = new Error('You have already interacted with this roommate');
    error.statusCode = 409;
    error.code = 'INTERACTION_EXISTS';
    throw error;
  }

  // ── Execute with Transaction for Multi-Document Consistency ────────
  const session = await mongoose.startSession();
  let createdInteraction = null;
  let match = null;
  let isMatch = false;

  try {
    await session.withTransaction(async () => {
      // 1. Record interaction using session
      const [newInteraction] = await RoommateInteraction.create(
        [
          {
            fromUser: fromUserId,
            toUser: targetId,
            action,
          },
        ],
        { session }
      );
      createdInteraction = newInteraction;

      // 2. Only check for mutual match when action is LIKE
      if (action === 'LIKE') {
        const reciprocalLike = await RoommateInteraction.findOne({
          fromUser: targetId,
          toUser: fromUserId,
          action: 'LIKE',
        }).session(session);

        if (reciprocalLike) {
          // Canonical ordering guarantees userA < userB for compound unique index
          const id1 = fromUserId.toString();
          const id2 = targetId.toString();
          const [userA, userB] = id1 < id2 ? [fromUserId, targetId] : [targetId, fromUserId];

          // Check if match document already exists between the two users
          const existingMatch = await RoommateMatch.findOne({ userA, userB }).session(session);

          if (existingMatch) {
            if (existingMatch.status === 'ACTIVE') {
              match = existingMatch;
              isMatch = true;
            } else {
              // Keep CLOSED matches closed for MVP - do not reactivate automatically
              match = existingMatch;
              isMatch = false;
            }
          } else {
            // Create a new ACTIVE match
            const [newMatch] = await RoommateMatch.create(
              [
                {
                  userA,
                  userB,
                  status: 'ACTIVE',
                },
              ],
              { session }
            );
            match = newMatch;
            isMatch = true;
          }
        }
      }
    });
  } catch (error) {
    // Handle MongoDB duplicate key error (code 11000) for race conditions
    if (error.code === 11000 || error.codeName === 'DuplicateKey') {
      const conflictError = new Error('You have already interacted with this roommate');
      conflictError.statusCode = 409;
      conflictError.code = 'INTERACTION_EXISTS';
      throw conflictError;
    }
    throw error;
  } finally {
    // End session safely in finally block
    await session.endSession();
  }

  // Only expose contact information when an ACTIVE match exists
  let populatedMatch = null;
  if (isMatch && match && match.status === 'ACTIVE') {
    const rawMatch = await RoommateMatch.findById(match._id)
      .populate('userA', 'name email phone avatar')
      .populate('userB', 'name email phone avatar')
      .lean();

    if (rawMatch) {
      const isUserA = rawMatch.userA?._id?.toString() === fromUserId.toString();
      const matchedPartner = isUserA ? rawMatch.userB : rawMatch.userA;
      populatedMatch = {
        _id: rawMatch._id,
        matchId: rawMatch._id,
        userA: rawMatch.userA,
        userB: rawMatch.userB,
        status: rawMatch.status,
        createdAt: rawMatch.createdAt,
        updatedAt: rawMatch.updatedAt,
        matchedUser: matchedPartner,
      };
    }
  }

  return {
    interaction: createdInteraction?.toObject ? createdInteraction.toObject() : createdInteraction,
    isMatch,
    match: isMatch ? populatedMatch : null,
  };
};

// ──────────────────────────────────────────────────────────────────────
// 7. GET MY ROOMMATE MATCHES
// ──────────────────────────────────────────────────────────────────────

/**
 * Returns all ACTIVE matches for the authenticated user with the matched partner's
 * contact details exposed.
 *
 * @param {string} userId - Authenticated user's ID
 * @returns {Promise<Array>} List of active matches with partner contact details
 */
export const getMyRoommateMatches = async (userId) => {
  const matches = await RoommateMatch.find({
    $or: [{ userA: userId }, { userB: userId }],
    status: 'ACTIVE',
  })
    .populate('userA', 'name email phone avatar')
    .populate('userB', 'name email phone avatar')
    .sort({ createdAt: -1 })
    .lean();

  return matches.map((m) => {
    const isUserA = m.userA._id.toString() === userId.toString();
    const matchedPartner = isUserA ? m.userB : m.userA;

    return {
      _id: m._id,
      matchId: m._id,
      status: m.status,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      matchedUser: matchedPartner,
    };
  });
};

// ──────────────────────────────────────────────────────────────────────
// 8. CLOSE ROOMMATE MATCH
// ──────────────────────────────────────────────────────────────────────

/**
 * Closes an active roommate match.
 * Only members of the match are authorized to close it.
 *
 * @param {string} userId - Authenticated user's ID
 * @param {string} matchId - Match document ID to close
 * @returns {Promise<Object>} Updated match document with CLOSED status
 */
export const closeRoommateMatch = async (userId, matchId) => {
  if (!mongoose.Types.ObjectId.isValid(matchId)) {
    const error = new Error('Invalid match ID format');
    error.statusCode = 400;
    error.code = 'INVALID_ID_FORMAT';
    throw error;
  }

  const match = await RoommateMatch.findById(matchId);

  if (!match) {
    const error = new Error('Roommate match not found');
    error.statusCode = 404;
    error.code = 'MATCH_NOT_FOUND';
    throw error;
  }

  // Verify authorization: current user must belong to this match
  const userAStr = match.userA.toString();
  const userBStr = match.userB.toString();
  const userIdStr = userId.toString();

  if (userIdStr !== userAStr && userIdStr !== userBStr) {
    const error = new Error('You are not authorized to close this match');
    error.statusCode = 403;
    error.code = 'NOT_MATCH_MEMBER';
    throw error;
  }

  if (match.status === 'CLOSED') {
    return match;
  }

  match.status = 'CLOSED';
  await match.save();

  return match;
};
