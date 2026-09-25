import mongoose from 'mongoose';
import Property from '../models/property.model.js';
import PropertyPreference from '../models/propertyPreference.model.js';

/**
 * Safe owner fields to populate when exposing property creator info.
 * Mirrors the constant used in property.controller.js.
 */
const OWNER_PUBLIC_FIELDS = 'name email avatar phone';

// ──────────────────────────────────────────────────────────────────────
// 1. LOAD USER PREFERENCES
// ──────────────────────────────────────────────────────────────────────

/**
 * Fetches the authenticated user's PropertyPreference document.
 *
 * @param {string} userId — The authenticated user's ObjectId (from req.user.id)
 * @returns {Object|null} The preference document (lean), or null if none exists.
 */
export const loadUserPreferences = async (userId) => {
  const preferences = await PropertyPreference.findOne({ user: userId }).lean();
  return preferences;
};

// ──────────────────────────────────────────────────────────────────────
// 2. BUILD HARD FILTER QUERY
// ──────────────────────────────────────────────────────────────────────

/**
 * Constructs a MongoDB filter object containing ONLY the hard-filter
 * constraints defined in the recommendation design document.
 *
 * Hard filters:
 *   1. status = 'AVAILABLE'                            (always)
 *   2. createdBy ≠ userId                              (always)
 *   3. location.city ∈ preferredLocations              (when non-empty)
 *   4. rent ≤ maxRent                                  (when defined)
 *   5. propertyType ∈ propertyTypes                    (when non-empty)
 *
 * @param {string} userId      — The authenticated user's ObjectId string
 * @param {Object} preferences — The user's PropertyPreference document (lean)
 * @returns {Object} A MongoDB filter object ready for Property.find()
 */
export const buildHardFilterQuery = (userId, preferences) => {
  // ── Always-applied filters ───────────────────────────────────────
  const filter = {
    status: 'AVAILABLE',
    createdBy: { $ne: new mongoose.Types.ObjectId(userId) },
  };

  // ── Conditionally-applied filters ────────────────────────────────

  // 3. Preferred locations — case-insensitive match against location.city
  //    Uses $in with regex to mirror the discovery controller's pattern.
  if (preferences.preferredLocations && preferences.preferredLocations.length > 0) {
    filter['location.city'] = {
      $in: preferences.preferredLocations.map(
        (city) => new RegExp(`^${escapeRegex(city)}$`, 'i')
      ),
    };
  }

  // 4. Maximum rent — only when maxRent is defined
  if (preferences.maxRent != null) {
    filter.rent = { $lte: preferences.maxRent };
  }

  // 5. Property types — only when the array is non-empty
  if (preferences.propertyTypes && preferences.propertyTypes.length > 0) {
    filter.propertyType = { $in: preferences.propertyTypes };
  }

  return filter;
};

// ──────────────────────────────────────────────────────────────────────
// 3. GET CANDIDATE PROPERTIES
// ──────────────────────────────────────────────────────────────────────

/**
 * Full pipeline: load preferences → build hard filters → query candidates.
 *
 * Returns an object with:
 *   - preferences: the user's PropertyPreference document (needed by scoring step)
 *   - candidates:  array of lean property documents that satisfy hard filters
 *   - filter:      the MongoDB filter object used (useful for debugging/logging)
 *
 * If the user has no PropertyPreference, returns { preferences: null, ... }
 * so the caller can return an appropriate response.
 *
 * @param {string} userId — The authenticated user's ObjectId string
 * @returns {Promise<{ preferences: Object|null, candidates: Object[], filter: Object }>}
 */
export const getCandidateProperties = async (userId) => {
  // Step 1 — Load preferences
  const preferences = await loadUserPreferences(userId);

  if (!preferences) {
    return { preferences: null, candidates: [], filter: {} };
  }

  // Step 2 — Build hard filter
  const filter = buildHardFilterQuery(userId, preferences);

  // Step 3 — Query MongoDB using existing indexes
  //   Primary index hit: { status: 1, 'location.city': 1, rent: 1 }
  //   Fallback index:    { status: 1, rent: 1 }
  //   Uses .lean() for plain JS objects (no Mongoose overhead for scoring)
  const candidates = await Property.find(filter)
    .populate('createdBy', OWNER_PUBLIC_FIELDS)
    .lean();

  return { preferences, candidates, filter };
};

// ──────────────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ──────────────────────────────────────────────────────────────────────

/**
 * Escape special regex characters to prevent regex injection.
 * Identical to the helper in property.controller.js.
 */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
