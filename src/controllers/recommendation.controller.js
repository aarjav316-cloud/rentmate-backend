import Property from '../models/property.model.js';
import PropertyPreference from '../models/propertyPreference.model.js';
import { buildHardFilterQuery } from '../utils/recommendation.utils.js';
import { scoreAllCandidates } from '../utils/scoring.utils.js';
import {
  generateRecommendationCacheKey,
  getCachedData,
  setCachedData,
} from '../utils/cache.utils.js';

/**
 * Safe owner fields to populate when exposing property creator info.
 * Mirrors the constant used in property.controller.js and recommendation.utils.js.
 */
const OWNER_PUBLIC_FIELDS = 'name email avatar phone';

// ──────────────────────────────────────────────────────────────────────
// 1. GET RECOMMENDED PROPERTIES
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Get ranked, paginated property recommendations for the authenticated user
 * @route   GET /api/v1/recommendations/properties?page=1&limit=12
 * @access  Private
 *
 * Flow:
 *   1. Auth middleware sets req.user.id
 *   2. Query validation middleware parses page/limit from req.query
 *   3. Load user's PropertyPreference (needed for cache key + scoring)
 *   4. Generate cache key → check Redis
 *   5. On cache hit → return cached response
 *   6. On cache miss → hard-filter candidate query → scoring → ranking → pagination
 *   7. Cache the response → return
 */
export const getRecommendedProperties = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { page, limit } = req.validatedQuery;

    // ── Load preferences (needed for cache key + scoring) ─────────────
    const preferences = await PropertyPreference.findOne({ user: userId }).lean();

    if (!preferences) {
      return res.status(404).json({
        success: false,
        message: 'Please complete your property preferences first.',
      });
    }

    // ── Check Redis cache ─────────────────────────────────────────────
    const cacheKey = generateRecommendationCacheKey(userId, preferences, page, limit);
    const cachedResponse = await getCachedData(cacheKey);

    if (cachedResponse) {
      return res.status(200).json(cachedResponse);
    }

    // ── Cache miss — run full recommendation pipeline ─────────────────

    // Step 2: Build hard filters + query candidates
    const filter = buildHardFilterQuery(userId, preferences);
    const candidates = await Property.find(filter)
      .populate('createdBy', OWNER_PUBLIC_FIELDS)
      .lean();

    // Step 3: Compatibility scoring
    const scoredProperties = scoreAllCandidates(candidates, preferences);

    // Step 5: Ranking
    //   Primary:    compatibilityScore DESC
    //   Tie-break:  createdAt DESC
    scoredProperties.sort((a, b) => {
      const scoreDiff = b.compatibilityScore - a.compatibilityScore;
      if (scoreDiff !== 0) return scoreDiff;

      const dateA = new Date(a.createdAt).getTime() || 0;
      const dateB = new Date(b.createdAt).getTime() || 0;
      return dateB - dateA;
    });

    // Step 6: Pagination
    const total = scoredProperties.length;
    const totalPages = Math.ceil(total / limit) || 0;
    const skip = (page - 1) * limit;
    const paginatedResults = scoredProperties.slice(skip, skip + limit);

    // ── Build response ────────────────────────────────────────────────
    const responsePayload = {
      success: true,
      message: 'Property recommendations fetched successfully',
      count: paginatedResults.length,
      data: {
        recommendations: paginatedResults,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      },
    };

    // ── Store in Redis (failures are non-blocking) ────────────────────
    await setCachedData(cacheKey, responsePayload);

    return res.status(200).json(responsePayload);
  } catch (error) {
    next(error);
  }
};
