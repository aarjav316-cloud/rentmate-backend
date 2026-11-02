/**
 * Roommate Compatibility Scoring Engine
 *
 * Calculates a bidirectional 0–100 compatibility score between two potential
 * roommates using individual rent-share budgets, lifestyle preferences, and
 * shared move-in availability preferences.
 *
 * Weighted Factors (Sum = 100%):
 *   - Budget overlap:    25%
 *   - Sleep schedule:    20%
 *   - Cleanliness:       15%
 *   - Diet:              15%
 *   - Smoking/drinking:  15%
 *   - Move-in date:      10%
 *
 * This module is a pure computation utility:
 *   - Independent of Express, Mongoose queries, controllers, and services.
 *   - Zero database access and zero network calls.
 *   - Does not mutate input objects.
 *   - Strictly bidirectional: calculateRoommateCompatibility(A, B) === calculateRoommateCompatibility(B, A).
 */

import {
  CLEANLINESS_ENUM,
  SLEEP_SCHEDULE_ENUM,
  SMOKING_ENUM,
  DRINKING_ENUM,
  DIET_ENUM,
} from '../models/roommateProfile.model.js';

// ── Base Weights ──────────────────────────────────────────────────────

export const ROOMMATE_WEIGHTS = {
  budget: 25,
  sleepSchedule: 20,
  cleanliness: 15,
  diet: 15,
  smokingDrinking: 15,
  moveInDate: 10,
};

// ── Internal Helper Functions ─────────────────────────────────────────

const toPlainObject = (obj) => {
  if (!obj) return {};
  if (typeof obj.toObject === 'function') {
    return obj.toObject();
  }
  return obj;
};

const getLifestyle = (profile) => {
  const p = toPlainObject(profile);
  return p.lifestylePreferences || p.lifestyle || {};
};

const getBudget = (profile) => {
  const p = toPlainObject(profile);
  const min = p.budgetMin ?? p.minBudget ?? null;
  const max = p.budgetMax ?? p.maxBudget ?? null;

  return {
    min: min !== null && min !== undefined ? Number(min) : null,
    max: max !== null && max !== undefined ? Number(max) : null,
  };
};

const getMoveInDate = (profile, preference) => {
  const prefObj = toPlainObject(preference);
  const profObj = toPlainObject(profile);

  const rawDate =
    prefObj.preferredAvailableFrom ||
    profObj.preferredAvailableFrom ||
    profObj.moveInDate ||
    null;

  if (!rawDate) return null;
  const d = new Date(rawDate);
  return isNaN(d.getTime()) ? null : d;
};

// ══════════════════════════════════════════════════════════════════════
// INDIVIDUAL FACTOR RATIO CALCULATORS (each returns { ratio, reason })
// ══════════════════════════════════════════════════════════════════════

/**
 * 1. Budget Overlap Ratio (Weight: 25%)
 *
 * Compares individual monthly rent-share budgets (budgetMin & budgetMax).
 * Bidirectional: uses commutative interval intersection and range metrics.
 * Missing data yields a neutral 0.5 baseline.
 *
 * @param {Object} profileA - User A's roommate profile
 * @param {Object} profileB - User B's roommate profile
 * @returns {{ ratio: number, reason: string }}
 */
export const calculateBudgetOverlapRatio = (profileA, profileB) => {
  const bA = getBudget(profileA);
  const bB = getBudget(profileB);

  // Missing data guard
  if ((bA.min == null && bA.max == null) || (bB.min == null && bB.max == null)) {
    return {
      ratio: 0.5,
      reason: 'Budget data not specified by one or both candidates (neutral baseline applied)',
    };
  }

  // Normalize single-bound budgets: if only max is provided, min is 0; if only min is provided, estimate max
  const minA = bA.min != null ? Math.max(0, bA.min) : 0;
  const maxA = bA.max != null ? Math.max(minA, bA.max) : minA * 1.5;

  const minB = bB.min != null ? Math.max(0, bB.min) : 0;
  const maxB = bB.max != null ? Math.max(minB, bB.max) : minB * 1.5;

  const overlapMin = Math.max(minA, minB);
  const overlapMax = Math.min(maxA, maxB);
  const overlap = Math.max(0, overlapMax - overlapMin);

  const rangeA = maxA - minA;
  const rangeB = maxB - minB;

  // Case 1: Overlap exists
  if (overlapMax >= overlapMin && (overlap > 0 || minA === minB)) {
    let ratio = 1.0;

    if (rangeA > 0 || rangeB > 0) {
      const minRange = Math.min(rangeA, rangeB);
      const maxRange = Math.max(rangeA, rangeB);

      if (minRange === 0) {
        // Point budget completely enclosed in the other candidate's budget range
        ratio = 1.0;
      } else {
        const overlapToMin = overlap / minRange;
        const overlapToMax = maxRange > 0 ? overlap / maxRange : 1.0;
        ratio = (overlapToMin + overlapToMax) / 2;
      }
    }

    ratio = Math.min(1.0, Math.max(0.0, ratio));

    if (ratio >= 0.8) {
      return {
        ratio,
        reason: 'Strong budget alignment with substantial rent-share overlap',
      };
    }
    return {
      ratio,
      reason: 'Moderate budget overlap between preferred rent-share ranges',
    };
  }

  // Case 2: No overlap — evaluate distance gap
  const gap = overlapMin - overlapMax;
  const avgBudget = ((minA + maxA) / 2 + (minB + maxB) / 2) / 2;

  if (avgBudget > 0 && gap <= avgBudget * 0.25) {
    const ratio = Math.max(0.0, 0.4 * (1 - gap / (avgBudget * 0.25)));
    return {
      ratio: Math.round(ratio * 100) / 100,
      reason: 'Slight budget gap between preferred rent-share ranges',
    };
  }

  return {
    ratio: 0.0,
    reason: 'Budgets do not overlap (significant gap between rent-share ranges)',
  };
};

/**
 * 2. Sleep Schedule Ratio (Weight: 20%)
 *
 * Compares sleepSchedule from lifestylePreferences:
 *   - Exact match: 1.0
 *   - FLEXIBLE with EARLY_RISER or NIGHT_OWL: 0.85
 *   - EARLY_RISER vs NIGHT_OWL: 0.1
 *   - Missing: 0.5 (neutral)
 *
 * @param {Object} lifestyleA - User A's lifestyle preferences
 * @param {Object} lifestyleB - User B's lifestyle preferences
 * @returns {{ ratio: number, reason: string }}
 */
export const calculateSleepScheduleRatio = (lifestyleA, lifestyleB) => {
  const schedA = lifestyleA?.sleepSchedule;
  const schedB = lifestyleB?.sleepSchedule;

  if (!schedA || !schedB) {
    return {
      ratio: 0.5,
      reason: 'Sleep schedule preference not specified by one or both candidates (neutral baseline applied)',
    };
  }

  if (schedA === schedB) {
    if (schedA === 'EARLY_RISER') {
      return { ratio: 1.0, reason: 'Both roommates are early risers' };
    }
    if (schedA === 'NIGHT_OWL') {
      return { ratio: 1.0, reason: 'Both roommates are night owls' };
    }
    return { ratio: 1.0, reason: 'Both roommates have flexible sleep schedules' };
  }

  if (schedA === 'FLEXIBLE' || schedB === 'FLEXIBLE') {
    const specific = schedA === 'FLEXIBLE' ? schedB : schedA;
    if (specific === 'EARLY_RISER') {
      return { ratio: 0.85, reason: 'Flexible sleep schedule accommodates early riser' };
    }
    return { ratio: 0.85, reason: 'Flexible sleep schedule accommodates night owl' };
  }

  // EARLY_RISER vs NIGHT_OWL clash
  return {
    ratio: 0.1,
    reason: 'Conflicting sleep schedules (early riser vs. night owl)',
  };
};

/**
 * 3. Cleanliness Ratio (Weight: 15%)
 *
 * Cleanliness scale: RELAXED (0) < MODERATE (1) < STRICT (2).
 *   - Same level: 1.0
 *   - 1 step difference: 0.65
 *   - 2 steps difference: 0.1
 *   - Missing: 0.5 (neutral)
 *
 * @param {Object} lifestyleA - User A's lifestyle preferences
 * @param {Object} lifestyleB - User B's lifestyle preferences
 * @returns {{ ratio: number, reason: string }}
 */
export const calculateCleanlinessRatio = (lifestyleA, lifestyleB) => {
  const cleanA = lifestyleA?.cleanliness;
  const cleanB = lifestyleB?.cleanliness;

  if (!cleanA || !cleanB) {
    return {
      ratio: 0.5,
      reason: 'Cleanliness preference not specified by one or both candidates (neutral baseline applied)',
    };
  }

  const LEVELS = {
    RELAXED: 0,
    MODERATE: 1,
    STRICT: 2,
  };

  const levelA = LEVELS[cleanA];
  const levelB = LEVELS[cleanB];

  if (levelA === undefined || levelB === undefined) {
    return {
      ratio: 0.5,
      reason: 'Unrecognized cleanliness preference (neutral baseline applied)',
    };
  }

  const diff = Math.abs(levelA - levelB);

  if (diff === 0) {
    if (cleanA === 'STRICT') {
      return { ratio: 1.0, reason: 'Shared high cleanliness standards (strict)' };
    }
    if (cleanA === 'MODERATE') {
      return { ratio: 1.0, reason: 'Shared moderate cleanliness expectations' };
    }
    return { ratio: 1.0, reason: 'Shared relaxed cleanliness expectations' };
  }

  if (diff === 1) {
    const [lower, higher] = [cleanA, cleanB].sort();
    return {
      ratio: 0.65,
      reason: `Compatible cleanliness standards with minor difference (${lower.toLowerCase()} vs. ${higher.toLowerCase()})`,
    };
  }

  return {
    ratio: 0.1,
    reason: 'Conflicting cleanliness standards (strict vs. relaxed)',
  };
};

/**
 * 4. Diet Ratio (Weight: 15%)
 *
 * Compares dietary preferences (VEGETARIAN, NON_VEGETARIAN, VEGAN, ANY):
 *   - Identical or either is ANY: 1.0
 *   - VEGAN + VEGETARIAN: 0.85
 *   - VEGETARIAN + NON_VEGETARIAN: 0.5
 *   - VEGAN + NON_VEGETARIAN: 0.3
 *   - Missing: 0.5 (neutral)
 *
 * @param {Object} lifestyleA - User A's lifestyle preferences
 * @param {Object} lifestyleB - User B's lifestyle preferences
 * @returns {{ ratio: number, reason: string }}
 */
export const calculateDietRatio = (lifestyleA, lifestyleB) => {
  const dietA = lifestyleA?.diet;
  const dietB = lifestyleB?.diet;

  if (!dietA || !dietB) {
    return {
      ratio: 0.5,
      reason: 'Dietary preference not specified by one or both candidates (neutral baseline applied)',
    };
  }

  if (dietA === dietB) {
    return {
      ratio: 1.0,
      reason: `Identical dietary preferences (${dietA.toLowerCase()})`,
    };
  }

  if (dietA === 'ANY' || dietB === 'ANY') {
    return {
      ratio: 1.0,
      reason: 'Flexible dietary preferences compatible with any diet',
    };
  }

  const pairKey = [dietA, dietB].sort().join('+');

  if (pairKey === 'VEGAN+VEGETARIAN') {
    return {
      ratio: 0.85,
      reason: 'Compatible plant-based dietary preferences (vegetarian and vegan)',
    };
  }

  if (pairKey === 'NON_VEGETARIAN+VEGETARIAN') {
    return {
      ratio: 0.5,
      reason: 'Mixed dietary preferences (vegetarian and non-vegetarian)',
    };
  }

  if (pairKey === 'NON_VEGETARIAN+VEGAN') {
    return {
      ratio: 0.3,
      reason: 'Differing dietary preferences (vegan and non-vegetarian)',
    };
  }

  return {
    ratio: 0.5,
    reason: 'Different dietary preferences',
  };
};

/**
 * 5. Smoking / Drinking Ratio (Weight: 15%)
 *
 * Combines smoking (50%) and drinking (50%) preferences:
 *   - Smoking: NON_SMOKER, OUTSIDE_ONLY, SMOKER
 *   - Drinking: NON_DRINKER, SOCIAL, REGULAR
 *
 * @param {Object} lifestyleA - User A's lifestyle preferences
 * @param {Object} lifestyleB - User B's lifestyle preferences
 * @returns {{ ratio: number, reason: string }}
 */
export const calculateSmokingDrinkingRatio = (lifestyleA, lifestyleB) => {
  const smokeA = lifestyleA?.smoking;
  const smokeB = lifestyleB?.smoking;
  const drinkA = lifestyleA?.drinking;
  const drinkB = lifestyleB?.drinking;

  // ── Smoking Sub-Score ──
  let smokeRatio = 0.5;
  if (smokeA && smokeB) {
    if (smokeA === smokeB) {
      smokeRatio = 1.0;
    } else {
      const pair = [smokeA, smokeB].sort().join('+');
      if (pair === 'NON_SMOKER+OUTSIDE_ONLY') {
        smokeRatio = 0.7;
      } else if (pair === 'OUTSIDE_ONLY+SMOKER') {
        smokeRatio = 0.6;
      } else {
        // NON_SMOKER + SMOKER
        smokeRatio = 0.1;
      }
    }
  }

  // ── Drinking Sub-Score ──
  let drinkRatio = 0.5;
  if (drinkA && drinkB) {
    if (drinkA === drinkB) {
      drinkRatio = 1.0;
    } else {
      const pair = [drinkA, drinkB].sort().join('+');
      if (pair === 'NON_DRINKER+SOCIAL') {
        drinkRatio = 0.8;
      } else if (pair === 'REGULAR+SOCIAL') {
        drinkRatio = 0.75;
      } else {
        // NON_DRINKER + REGULAR
        drinkRatio = 0.3;
      }
    }
  }

  const combinedRatio = Math.round(((smokeRatio + drinkRatio) / 2) * 100) / 100;

  let reason;
  if (!smokeA && !drinkA && !smokeB && !drinkB) {
    reason = 'Smoking and drinking preferences not specified (neutral baseline applied)';
  } else if (combinedRatio >= 0.85) {
    reason = 'Highly aligned smoking and drinking habits';
  } else if (combinedRatio >= 0.65) {
    reason = 'Compatible smoking and drinking habits with minor differences';
  } else if (combinedRatio >= 0.45) {
    reason = 'Mixed compatibility in smoking or drinking preferences';
  } else {
    reason = 'Conflicting smoking and/or drinking preferences';
  }

  return {
    ratio: combinedRatio,
    reason,
  };
};

/**
 * 6. Move-in Date Ratio (Weight: 10%)
 *
 * Compares preferred move-in dates:
 *   - Within 7 days: 1.0
 *   - 7 to 30 days: linear decay 1.0 -> 0.7
 *   - 30 to 60 days: linear decay 0.7 -> 0.2
 *   - > 60 days: 0.0
 *   - Missing date: 0.5 (neutral)
 *
 * @param {Date|string|null} dateA - User A's preferred move-in date
 * @param {Date|string|null} dateB - User B's preferred move-in date
 * @returns {{ ratio: number, reason: string }}
 */
export const calculateMoveInDateRatio = (dateA, dateB) => {
  if (!dateA || !dateB) {
    return {
      ratio: 0.5,
      reason: 'Move-in date preference not specified by one or both candidates (neutral baseline applied)',
    };
  }

  const dA = new Date(dateA);
  const dB = new Date(dateB);

  if (isNaN(dA.getTime()) || isNaN(dB.getTime())) {
    return {
      ratio: 0.5,
      reason: 'Invalid move-in date format (neutral baseline applied)',
    };
  }

  const diffMs = Math.abs(dA.getTime() - dB.getTime());
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays <= 7) {
    return {
      ratio: 1.0,
      reason: 'Move-in timelines align closely (within 1 week)',
    };
  }

  if (diffDays <= 30) {
    const ratio = 1.0 - 0.3 * ((diffDays - 7) / 23);
    return {
      ratio: Math.round(ratio * 100) / 100,
      reason: `Move-in dates are within ${Math.round(diffDays)} days of each other`,
    };
  }

  if (diffDays <= 60) {
    const ratio = 0.7 - 0.5 * ((diffDays - 30) / 30);
    return {
      ratio: Math.round(ratio * 100) / 100,
      reason: `Move-in dates are about ${Math.round(diffDays / 30)} months apart`,
    };
  }

  return {
    ratio: 0.0,
    reason: `Move-in timelines are too far apart (${Math.round(diffDays)} days difference)`,
  };
};

// ══════════════════════════════════════════════════════════════════════
// MAIN SCORING FUNCTION
// ══════════════════════════════════════════════════════════════════════

/**
 * Calculates a comprehensive 0–100 roommate compatibility score between two users.
 *
 * Flexible signature supports:
 *   1. calculateRoommateCompatibility(profileA, profileB, prefA, prefB)
 *   2. calculateRoommateCompatibility(profileA, profileB, { preferenceA, preferenceB })
 *   3. calculateRoommateCompatibility(profileA, profileB, { prefA, prefB })
 *   4. calculateRoommateCompatibility(profileA, profileB, sharedPreference)
 *   5. calculateRoommateCompatibility(profileA, profileB) when preferences are attached directly
 *
 * @param {Object} profileA - User A's RoommateProfile document or plain object
 * @param {Object} profileB - User B's RoommateProfile document or plain object
 * @param {Object} [param3]  - User A's PropertyPreference or container object
 * @param {Object} [param4]  - User B's PropertyPreference (when passed as 4th argument)
 * @returns {{
 *   compatibilityScore: number,
 *   factorScores: {
 *     budget: number,
 *     sleepSchedule: number,
 *     cleanliness: number,
 *     diet: number,
 *     smokingDrinking: number,
 *     moveInDate: number,
 *   },
 *   factorPercentages: {
 *     budget: number,
 *     sleepSchedule: number,
 *     cleanliness: number,
 *     diet: number,
 *     smokingDrinking: number,
 *     moveInDate: number,
 *   },
 *   reasons: string[],
 *   factorDetails: Object,
 * }}
 */
export const calculateRoommateCompatibility = (profileA, profileB, param3, param4) => {
  // Resolve PropertyPreferences
  let prefA = null;
  let prefB = null;

  if (param4 !== undefined) {
    // Signature: (profileA, profileB, prefA, prefB)
    prefA = param3;
    prefB = param4;
  } else if (param3) {
    // Signature: (profileA, profileB, { preferenceA, preferenceB }) or similar container
    prefA =
      param3.prefA ||
      param3.preferenceA ||
      param3.preferencesA ||
      param3.userA ||
      param3.userAPreference ||
      null;

    prefB =
      param3.prefB ||
      param3.preferenceB ||
      param3.preferencesB ||
      param3.userB ||
      param3.userBPreference ||
      null;

    // Single shared preference object passed
    if (!prefA && !prefB && (param3.preferredAvailableFrom !== undefined || param3.minRent !== undefined)) {
      prefA = param3;
      prefB = param3;
    }
  }

  // Fallback to preferences attached to profiles if not provided via arguments
  if (!prefA) prefA = profileA?.propertyPreference || profileA?.preferences || null;
  if (!prefB) prefB = profileB?.propertyPreference || profileB?.preferences || null;

  // Extract lifestyle structures
  const lifestyleA = getLifestyle(profileA);
  const lifestyleB = getLifestyle(profileB);

  // Extract move-in dates
  const dateA = getMoveInDate(profileA, prefA);
  const dateB = getMoveInDate(profileB, prefB);

  // ── Calculate Individual Factor Ratios and Reasons ──
  const budgetResult = calculateBudgetOverlapRatio(profileA, profileB);
  const sleepResult = calculateSleepScheduleRatio(lifestyleA, lifestyleB);
  const cleanResult = calculateCleanlinessRatio(lifestyleA, lifestyleB);
  const dietResult = calculateDietRatio(lifestyleA, lifestyleB);
  const smokeDrinkResult = calculateSmokingDrinkingRatio(lifestyleA, lifestyleB);
  const moveInResult = calculateMoveInDateRatio(dateA, dateB);

  const factorResults = [
    { key: 'budget', weight: ROOMMATE_WEIGHTS.budget, ...budgetResult },
    { key: 'sleepSchedule', weight: ROOMMATE_WEIGHTS.sleepSchedule, ...sleepResult },
    { key: 'cleanliness', weight: ROOMMATE_WEIGHTS.cleanliness, ...cleanResult },
    { key: 'diet', weight: ROOMMATE_WEIGHTS.diet, ...dietResult },
    { key: 'smokingDrinking', weight: ROOMMATE_WEIGHTS.smokingDrinking, ...smokeDrinkResult },
    { key: 'moveInDate', weight: ROOMMATE_WEIGHTS.moveInDate, ...moveInResult },
  ];

  // ── Compute Scores ──
  const factorScores = {};
  const factorPercentages = {};
  const factorDetails = {};
  const reasons = [];
  let totalScore = 0;

  for (const factor of factorResults) {
    const points = factor.ratio * factor.weight;
    const roundedScore = Math.round(points * 10) / 10;
    const percentage = Math.round(factor.ratio * 100);

    factorScores[factor.key] = roundedScore;
    factorPercentages[factor.key] = percentage;
    factorDetails[factor.key] = {
      score: roundedScore,
      maxScore: factor.weight,
      percentage,
      reason: factor.reason,
    };

    reasons.push(factor.reason);
    totalScore += points;
  }

  // Clamp final score between 0 and 100, rounded to 1 decimal place
  const compatibilityScore = Math.round(Math.min(100, Math.max(0, totalScore)) * 10) / 10;

  return {
    compatibilityScore,
    factorScores,
    factorPercentages,
    reasons,
    factorDetails,
  };
};
