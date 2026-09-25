/**
 * Compatibility Scoring Engine
 *
 * Calculates a 0–100 compatibility score for a candidate property
 * against a user's PropertyPreference, following the exact formulas
 * defined in docs/property-recommendation-design.md.
 *
 * This module is a pure computation layer — it does NOT:
 *   - access MongoDB
 *   - modify any documents
 *   - touch Redis or caching
 *   - expose any API routes
 */

// ── Base Weights ─────────────────────────────────────────────────────

const WEIGHTS = {
  location:     30,
  rent:         25,
  propertyType: 15,
  bedrooms:     10,
  amenities:    10,
  availability: 10,
};

const AVAILABILITY_GRACE_PERIOD_DAYS = 30;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

// ══════════════════════════════════════════════════════════════════════
// INDIVIDUAL RATIO CALCULATORS (each returns 0.0 – 1.0)
// ══════════════════════════════════════════════════════════════════════

// ── 1. Location Ratio ────────────────────────────────────────────────
/**
 * Location is a hard filter — candidates that survive already match.
 * Ratio is always 1.0 for any scoring-eligible property.
 *
 * @returns {number} 1.0
 */
export const calculateLocationRatio = () => 1.0;

// ── 2. Rent Ratio ────────────────────────────────────────────────────
/**
 * Computes how well the property's rent matches the user's budget.
 * Closer to minRent = higher score (tenants prefer lower rent).
 *
 * @param {Object} property    — lean property document
 * @param {Object} preferences — lean PropertyPreference document
 * @returns {number} 0.0 – 1.0
 */
export const calculateRentRatio = (property, preferences) => {
  const { minRent, maxRent } = preferences;
  const rent = property.rent;

  const hasMin = minRent != null;
  const hasMax = maxRent != null;

  // Guard: if property has no rent value, cannot score
  if (rent == null) return hasMin || hasMax ? 0 : 1.0;

  // Case 4: Neither minRent nor maxRent — full score
  if (!hasMin && !hasMax) return 1.0;

  // Case 2: Only maxRent
  if (!hasMin && hasMax) {
    if (rent <= maxRent) return 1 - rent / maxRent;
    return 0; // should not happen after hard filter
  }

  // Case 3: Only minRent
  if (hasMin && !hasMax) {
    if (rent >= minRent) return 1.0;
    if (minRent === 0) return 1.0;
    const distanceBelow = minRent - rent;
    const penalty = distanceBelow / minRent;
    return Math.max(0, 1 - penalty);
  }

  // Case 1: Both minRent and maxRent
  const rentRange = maxRent - minRent;

  if (rentRange === 0) {
    return rent === maxRent ? 1.0 : 0;
  }

  if (rent < minRent) {
    if (minRent === 0) return 1.0;
    const distanceBelow = minRent - rent;
    const penalty = distanceBelow / minRent;
    return Math.max(0, 1 - penalty);
  }

  // Within [minRent, maxRent]
  const distanceFromMin = rent - minRent;
  return 1 - distanceFromMin / rentRange;
};

// ── 3. Property Type Ratio ───────────────────────────────────────────
/**
 * Property type is a hard filter — candidates that survive already match.
 * Ratio is always 1.0 for any scoring-eligible property.
 *
 * @returns {number} 1.0
 */
export const calculatePropertyTypeRatio = () => 1.0;

// ── 4. Bedroom Ratio ─────────────────────────────────────────────────
/**
 * Distance-decay formula from the ideal bedroom count.
 *
 * @param {Object} property    — lean property document
 * @param {Object} preferences — lean PropertyPreference document
 * @returns {number} 0.0 – 1.0
 */
export const calculateBedroomRatio = (property, preferences) => {
  const { minBedrooms, maxBedrooms } = preferences;
  const bedrooms = property.bedrooms;

  const hasMin = minBedrooms != null;
  const hasMax = maxBedrooms != null;

  // No bedroom preference — full score
  if (!hasMin && !hasMax) return 1.0;

  // Guard: if property has no bedroom count, cannot score
  if (bedrooms == null) return 0;

  let idealBedrooms;
  let bedroomRange;

  if (hasMin && hasMax) {
    idealBedrooms = (minBedrooms + maxBedrooms) / 2;
    bedroomRange = maxBedrooms - minBedrooms;
  } else if (hasMin) {
    idealBedrooms = minBedrooms;
    bedroomRange = 2; // default tolerance
  } else {
    idealBedrooms = maxBedrooms;
    bedroomRange = 2; // default tolerance
  }

  const diff = Math.abs(bedrooms - idealBedrooms);

  if (diff === 0) return 1.0;

  const tolerance = Math.max(bedroomRange, 1);
  return Math.max(0, 1 - diff / (tolerance + 1));
};

// ── 5. Amenities Ratio ───────────────────────────────────────────────
/**
 * Fraction of user-requested amenities that the property provides.
 * Comparison is case-insensitive.
 *
 * @param {Object} property    — lean property document
 * @param {Object} preferences — lean PropertyPreference document
 * @returns {number} 0.0 – 1.0
 */
export const calculateAmenityRatio = (property, preferences) => {
  const required = preferences.requiredAmenities;

  // No amenity preference — full score
  if (!required || required.length === 0) return 1.0;

  const propertyAmenities = (property.amenities || []).map((a) => a.toLowerCase());

  const matchedCount = required.filter((amenity) =>
    propertyAmenities.includes(amenity.toLowerCase())
  ).length;

  return matchedCount / required.length;
};

// ── 6. Availability Ratio ────────────────────────────────────────────
/**
 * Full score when available on or before the user's date.
 * Linear 30-day decay when available after.
 *
 * @param {Object} property    — lean property document
 * @param {Object} preferences — lean PropertyPreference document
 * @returns {number} 0.0 – 1.0
 */
export const calculateAvailabilityRatio = (property, preferences) => {
  const preferred = preferences.preferredAvailableFrom;

  // No availability preference — full score
  if (preferred == null) return 1.0;

  // Guard: if property has no availableFrom, assume worst case
  if (property.availableFrom == null) return 0;

  const propertyDate = new Date(property.availableFrom);
  const preferredDate = new Date(preferred);

  // Guard: if either date is invalid, return 0
  if (isNaN(propertyDate.getTime()) || isNaN(preferredDate.getTime())) return 0;

  const diffDays = (propertyDate - preferredDate) / MS_PER_DAY;

  // Available on or before — full score
  if (diffDays <= 0) return 1.0;

  // Gradual decay over the grace period
  return Math.max(0, 1 - diffDays / AVAILABILITY_GRACE_PERIOD_DAYS);
};

// ══════════════════════════════════════════════════════════════════════
// MAIN SCORING FUNCTION
// ══════════════════════════════════════════════════════════════════════

/**
 * Calculates the compatibility score (0–100) for a single property
 * against the user's preferences, with full weight redistribution
 * for missing/inactive criteria.
 *
 * @param {Object} property    — lean property document (from candidate query)
 * @param {Object} preferences — lean PropertyPreference document
 * @returns {{ compatibilityScore: number, scoreBreakdown: Object }}
 */
export const calculatePropertyCompatibility = (property, preferences) => {
  // Step 1 — Determine which criteria are active
  const criteria = [
    {
      name:       'location',
      baseWeight: WEIGHTS.location,
      isActive:   preferences.preferredLocations?.length > 0,
      calcRatio:  calculateLocationRatio,
    },
    {
      name:       'rent',
      baseWeight: WEIGHTS.rent,
      isActive:   preferences.minRent != null || preferences.maxRent != null,
      calcRatio:  calculateRentRatio,
    },
    {
      name:       'propertyType',
      baseWeight: WEIGHTS.propertyType,
      isActive:   preferences.propertyTypes?.length > 0,
      calcRatio:  calculatePropertyTypeRatio,
    },
    {
      name:       'bedrooms',
      baseWeight: WEIGHTS.bedrooms,
      isActive:   preferences.minBedrooms != null || preferences.maxBedrooms != null,
      calcRatio:  calculateBedroomRatio,
    },
    {
      name:       'amenities',
      baseWeight: WEIGHTS.amenities,
      isActive:   preferences.requiredAmenities?.length > 0,
      calcRatio:  calculateAmenityRatio,
    },
    {
      name:       'availability',
      baseWeight: WEIGHTS.availability,
      isActive:   preferences.preferredAvailableFrom != null,
      calcRatio:  calculateAvailabilityRatio,
    },
  ];

  const activeCriteria = criteria.filter((c) => c.isActive);

  // Step 2 — If no preferences at all, every property gets 100
  if (activeCriteria.length === 0) {
    return {
      compatibilityScore: 100,
      scoreBreakdown: {
        location:     0,
        rent:         0,
        propertyType: 0,
        bedrooms:     0,
        amenities:    0,
        availability: 0,
      },
    };
  }

  // Step 3 — Weight redistribution
  const activeWeightSum = activeCriteria.reduce((sum, c) => sum + c.baseWeight, 0);
  const scaleFactor = 100 / activeWeightSum;

  // Step 4 — Calculate raw ratios and effective scores
  const scoreBreakdown = {};
  let finalScore = 0;

  for (const criterion of criteria) {
    if (criterion.isActive) {
      const ratio = criterion.calcRatio(property, preferences);
      const effectiveWeight = criterion.baseWeight * scaleFactor;
      const points = ratio * effectiveWeight;

      scoreBreakdown[criterion.name] = Math.round(points * 100) / 100; // 2 decimal places
      finalScore += points;
    } else {
      scoreBreakdown[criterion.name] = 0; // inactive — not contributing
    }
  }

  // Step 5 — Clamp to [0, 100] and round to 1 decimal
  const clampedScore = Math.min(100, Math.max(0, finalScore));
  const roundedScore = Math.round(clampedScore * 10) / 10;

  return {
    compatibilityScore: roundedScore,
    scoreBreakdown,
  };
};

// ══════════════════════════════════════════════════════════════════════
// BATCH SCORING
// ══════════════════════════════════════════════════════════════════════

/**
 * Scores an array of candidate properties and attaches the score
 * and breakdown to each property object.
 *
 * Does NOT mutate the original property documents in MongoDB.
 * Returns new objects with scoring data attached.
 *
 * @param {Object[]} candidates  — array of lean property documents
 * @param {Object}   preferences — lean PropertyPreference document
 * @returns {Object[]} Array of { ...property, compatibilityScore, scoreBreakdown }
 */
export const scoreAllCandidates = (candidates, preferences) => {
  return candidates.map((property) => {
    const { compatibilityScore, scoreBreakdown } = calculatePropertyCompatibility(
      property,
      preferences
    );
    return {
      ...property,
      compatibilityScore,
      scoreBreakdown,
    };
  });
};
