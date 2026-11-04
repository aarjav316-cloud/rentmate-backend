import { z } from 'zod';
import {
  GENDER_ENUM,
  CLEANLINESS_ENUM,
  SLEEP_SCHEDULE_ENUM,
  SMOKING_ENUM,
  DRINKING_ENUM,
  PETS_ENUM,
  DIET_ENUM,
  GUESTS_ENUM,
} from '../models/roommateProfile.model.js';
import { INTERACTION_ACTION_ENUM } from '../models/roommateInteraction.model.js';

// ── Shared Field Definitions ──────────────────────────────────────────

const bioField = z
  .string({ invalid_type_error: 'Bio must be a string' })
  .trim()
  .max(500, 'Bio cannot exceed 500 characters');

const genderField = z.enum(GENDER_ENUM, {
  errorMap: () => ({ message: `Gender must be one of: ${GENDER_ENUM.join(', ')}` }),
});

const ageField = z
  .number({ invalid_type_error: 'Age must be a number' })
  .int('Age must be a whole number')
  .min(18, 'Age must be at least 18')
  .max(120, 'Age cannot exceed 120');

const occupationField = z
  .string({ invalid_type_error: 'Occupation must be a string' })
  .trim()
  .max(100, 'Occupation cannot exceed 100 characters');

const budgetMinField = z
  .number({ invalid_type_error: 'Minimum budget must be a number' })
  .min(0, 'Minimum budget cannot be negative');

const budgetMaxField = z
  .number({ invalid_type_error: 'Maximum budget must be a number' })
  .min(0, 'Maximum budget cannot be negative');

const cleanlinessField = z.enum(CLEANLINESS_ENUM, {
  errorMap: () => ({ message: `Cleanliness must be one of: ${CLEANLINESS_ENUM.join(', ')}` }),
});

const sleepScheduleField = z.enum(SLEEP_SCHEDULE_ENUM, {
  errorMap: () => ({ message: `Sleep schedule must be one of: ${SLEEP_SCHEDULE_ENUM.join(', ')}` }),
});

const smokingField = z.enum(SMOKING_ENUM, {
  errorMap: () => ({ message: `Smoking preference must be one of: ${SMOKING_ENUM.join(', ')}` }),
});

const drinkingField = z.enum(DRINKING_ENUM, {
  errorMap: () => ({ message: `Drinking preference must be one of: ${DRINKING_ENUM.join(', ')}` }),
});

const petsField = z.enum(PETS_ENUM, {
  errorMap: () => ({ message: `Pets preference must be one of: ${PETS_ENUM.join(', ')}` }),
});

const dietField = z.enum(DIET_ENUM, {
  errorMap: () => ({ message: `Diet preference must be one of: ${DIET_ENUM.join(', ')}` }),
});

const guestsField = z.enum(GUESTS_ENUM, {
  errorMap: () => ({ message: `Guests preference must be one of: ${GUESTS_ENUM.join(', ')}` }),
});

const interestsField = z
  .array(
    z
      .string({ invalid_type_error: 'Each interest must be a string' })
      .trim()
      .min(1, 'Interest string cannot be empty')
      .max(50, 'Interest string cannot exceed 50 characters'),
    { invalid_type_error: 'Interests must be an array of strings' }
  )
  .max(20, 'Cannot have more than 20 interests');

// ── Lifestyle Sub-Schemas ─────────────────────────────────────────────

const createLifestyleSchema = z
  .object({
    cleanliness: cleanlinessField.optional(),
    sleepSchedule: sleepScheduleField.optional(),
    smoking: smokingField.optional(),
    drinking: drinkingField.optional(),
    pets: petsField.optional(),
    diet: dietField.optional(),
    guests: guestsField.optional(),
    interests: interestsField.default([]),
  })
  .strict('Unexpected properties in lifestyle object');

const updateLifestyleSchema = z
  .object({
    cleanliness: cleanlinessField.optional(),
    sleepSchedule: sleepScheduleField.optional(),
    smoking: smokingField.optional(),
    drinking: drinkingField.optional(),
    pets: petsField.optional(),
    diet: dietField.optional(),
    guests: guestsField.optional(),
    interests: interestsField.optional(),
  })
  .strict('Unexpected properties in lifestyle object');

// ── Cross-Field Budget Validation Helper ──────────────────────────────

const crossFieldBudgetValidation = (data, ctx) => {
  if (data.budgetMin !== undefined && data.budgetMax !== undefined) {
    if (data.budgetMin > data.budgetMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Minimum budget cannot exceed maximum budget',
        path: ['budgetMin'],
      });
    }
  }
};

// ── Target User ID Schema ─────────────────────────────────────────────

const objectIdField = z
  .string({ invalid_type_error: 'Target user ID must be a string' })
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid user ID format (must be a 24-character hexadecimal string)');

// ──────────────────────────────────────────────────────────────────────
// 1. Create Roommate Profile Schema
// ──────────────────────────────────────────────────────────────────────

/**
 * Validates request body for POST /api/v1/roommates/profile.
 * - Disallows server-managed fields (user, _id, isActive, timestamps) via .strict().
 * - Rejects budgetMin > budgetMax.
 * - Supports lifestylePreferences or the virtual alias lifestyle.
 */
export const createRoommateProfileSchema = z
  .object({
    bio: bioField.optional().default(''),
    gender: genderField.optional(),
    age: ageField.optional(),
    occupation: occupationField.optional().default(''),
    budgetMin: budgetMinField.optional(),
    budgetMax: budgetMaxField.optional(),
    lifestylePreferences: createLifestyleSchema.optional(),
    lifestyle: createLifestyleSchema.optional(),
  })
  .strict('Unexpected fields detected. Fields like user, _id, or isActive are not allowed.')
  .superRefine((data, ctx) => {
    crossFieldBudgetValidation(data, ctx);
  });

// ──────────────────────────────────────────────────────────────────────
// 2. Update Roommate Profile Schema
// ──────────────────────────────────────────────────────────────────────

/**
 * Validates request body for PATCH /api/v1/roommates/profile.
 * - Supports partial updates (all fields optional).
 * - Rejects empty update payloads.
 * - Cross-validates budgetMin and budgetMax when both are provided.
 * - Disallows server-managed fields (user, _id, isActive, timestamps) via .strict().
 */
export const updateRoommateProfileSchema = z
  .object({
    bio: bioField.optional(),
    gender: genderField.optional(),
    age: ageField.optional(),
    occupation: occupationField.optional(),
    budgetMin: budgetMinField.optional(),
    budgetMax: budgetMaxField.optional(),
    lifestylePreferences: updateLifestyleSchema.optional(),
    lifestyle: updateLifestyleSchema.optional(),
  })
  .strict('Unexpected fields detected. Fields like user, _id, or isActive are not allowed.')
  .superRefine((data, ctx) => {
    // Cross-validate budget relationship when both are provided in the payload
    crossFieldBudgetValidation(data, ctx);

    // Reject empty payload for partial updates
    if (Object.keys(data).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one field must be provided for update',
        path: [],
      });
    }
  });

// ──────────────────────────────────────────────────────────────────────
// 3. Roommate Discovery Query Schema
// ──────────────────────────────────────────────────────────────────────

/**
 * Validates query parameters for GET /api/v1/roommates/discovery.
 * - Coerces query strings to appropriate numbers/types.
 * - Enforces sensible pagination defaults (page=1, limit=12, max limit=50).
 * - Supports search query and location filter (city override).
 * - Supports demographic filters (gender, minAge, maxAge).
 * - Supports budget range filters (budgetMin/budgetMax and minBudget/maxBudget).
 * - Supports lifestyle filters (cleanliness, sleepSchedule, smoking, drinking, pets, diet, guests).
 * - Silently strips unknown query parameters via .strip().
 */
export const roommateDiscoveryQuerySchema = z
  .object({
    // Pagination
    page: z.coerce
      .number({ invalid_type_error: 'Page must be a number' })
      .int('Page must be a whole number')
      .min(1, 'Page must be at least 1')
      .default(1),
    limit: z.coerce
      .number({ invalid_type_error: 'Limit must be a number' })
      .int('Limit must be a whole number')
      .min(1, 'Limit must be at least 1')
      .max(50, 'Limit cannot exceed 50')
      .default(12),

    // Search query
    search: z.string().trim().max(100, 'Search query cannot exceed 100 characters').optional(),

    // Location filter (city override)
    city: z
      .string({ invalid_type_error: 'City must be a string' })
      .trim()
      .min(1, 'City cannot be empty')
      .max(100, 'City cannot exceed 100 characters')
      .optional(),

    // Demographic filters
    gender: z.enum(GENDER_ENUM, {
      errorMap: () => ({ message: `Gender must be one of: ${GENDER_ENUM.join(', ')}` }),
    }).optional(),
    minAge: z.coerce
      .number({ invalid_type_error: 'Minimum age must be a number' })
      .int('Minimum age must be a whole number')
      .min(18, 'Minimum age must be at least 18')
      .max(120, 'Minimum age cannot exceed 120')
      .optional(),
    maxAge: z.coerce
      .number({ invalid_type_error: 'Maximum age must be a number' })
      .int('Maximum age must be a whole number')
      .min(18, 'Maximum age must be at least 18')
      .max(120, 'Maximum age cannot exceed 120')
      .optional(),

    // Budget range filters (supports budgetMin/budgetMax and minBudget/maxBudget)
    budgetMin: z.coerce.number().min(0, 'Minimum budget cannot be negative').optional(),
    budgetMax: z.coerce.number().min(0, 'Maximum budget cannot be negative').optional(),
    minBudget: z.coerce.number().min(0, 'Minimum budget cannot be negative').optional(),
    maxBudget: z.coerce.number().min(0, 'Maximum budget cannot be negative').optional(),

    // Lifestyle filters
    cleanliness: z.enum(CLEANLINESS_ENUM, {
      errorMap: () => ({ message: `Cleanliness must be one of: ${CLEANLINESS_ENUM.join(', ')}` }),
    }).optional(),
    sleepSchedule: z.enum(SLEEP_SCHEDULE_ENUM, {
      errorMap: () => ({ message: `Sleep schedule must be one of: ${SLEEP_SCHEDULE_ENUM.join(', ')}` }),
    }).optional(),
    smoking: z.enum(SMOKING_ENUM, {
      errorMap: () => ({ message: `Smoking preference must be one of: ${SMOKING_ENUM.join(', ')}` }),
    }).optional(),
    drinking: z.enum(DRINKING_ENUM, {
      errorMap: () => ({ message: `Drinking preference must be one of: ${DRINKING_ENUM.join(', ')}` }),
    }).optional(),
    pets: z.enum(PETS_ENUM, {
      errorMap: () => ({ message: `Pets preference must be one of: ${PETS_ENUM.join(', ')}` }),
    }).optional(),
    diet: z.enum(DIET_ENUM, {
      errorMap: () => ({ message: `Diet preference must be one of: ${DIET_ENUM.join(', ')}` }),
    }).optional(),
    guests: z.enum(GUESTS_ENUM, {
      errorMap: () => ({ message: `Guests preference must be one of: ${GUESTS_ENUM.join(', ')}` }),
    }).optional(),

    // Sorting
    sortBy: z.enum(['compatibility', 'createdAt', 'budgetMin', 'budgetMax', 'age'], {
      errorMap: () => ({ message: 'Sort field must be one of: compatibility, createdAt, budgetMin, budgetMax, age' }),
    }).default('compatibility'),
    sortOrder: z.enum(['asc', 'desc'], {
      errorMap: () => ({ message: 'Sort order must be asc or desc' }),
    }).default('desc'),
  })
  .strip()
  .superRefine((data, ctx) => {
    // Cross-validate budget
    const effectiveMin = data.budgetMin !== undefined ? data.budgetMin : data.minBudget;
    const effectiveMax = data.budgetMax !== undefined ? data.budgetMax : data.maxBudget;
    if (effectiveMin !== undefined && effectiveMax !== undefined && effectiveMin > effectiveMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Minimum budget cannot exceed maximum budget',
        path: [data.budgetMin !== undefined ? 'budgetMin' : 'minBudget'],
      });
    }

    // Cross-validate age
    if (data.minAge !== undefined && data.maxAge !== undefined && data.minAge > data.maxAge) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Minimum age cannot exceed maximum age',
        path: ['minAge'],
      });
    }
  });

// ──────────────────────────────────────────────────────────────────────
// 4. Roommate Interaction Schema
// ──────────────────────────────────────────────────────────────────────

/**
 * Validates request body for roommate interaction actions (LIKE / PASS).
 * - Action is strictly required and must be 'LIKE' or 'PASS'.
 * - Accepts target user ID as toUser, targetUserId, or userId.
 * - When target user ID is provided, validates that it is a valid 24-character hex ObjectId.
 * - Strictly rejects unknown or unauthorized fields (such as fromUser, which is server-derived).
 */
export const roommateInteractionSchema = z
  .object({
    action: z.enum(INTERACTION_ACTION_ENUM, {
      required_error: 'Interaction action is required',
      errorMap: () => ({ message: `Action must be one of: ${INTERACTION_ACTION_ENUM.join(', ')}` }),
    }),
    toUser: objectIdField.optional(),
    targetUserId: objectIdField.optional(),
    userId: objectIdField.optional(),
  })
  .strict('Unexpected fields detected. Only action and target user ID are allowed.')
  .superRefine((data, ctx) => {
    if (data.toUser && data.targetUserId && data.toUser !== data.targetUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'toUser and targetUserId must match if both are provided',
        path: ['targetUserId'],
      });
    }
  });
