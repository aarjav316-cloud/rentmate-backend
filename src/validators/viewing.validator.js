import { z } from 'zod';
import {
  VIEWING_TIME_SLOT_ENUM,
  VIEWING_TYPE_ENUM,
  VIEWING_STATUS_ENUM,
} from '../models/propertyViewing.model.js';

/**
 * 24-character hexadecimal MongoDB ObjectId regex pattern.
 */
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

/**
 * Allowed status transitions when updating a property viewing status.
 * (Confirmed by owner, rescheduled by owner, rejected by owner, or cancelled by tenant/owner).
 */
export const UPDATE_VIEWING_STATUS_ENUM = [
  'CONFIRMED',
  'REJECTED',
  'RESCHEDULED',
  'CANCELLED',
];

// ── Shared Field Definitions ──────────────────────────────────────────

const propertyIdField = z
  .string({ required_error: 'Property ID is required' })
  .trim()
  .regex(OBJECT_ID_REGEX, 'Invalid property ID format (must be a 24-character hexadecimal string)');

/**
 * Helper to validate a date input:
 * - Coerces valid string/timestamp to Date
 * - Ensures valid calendar date (!isNaN)
 * - Ensures date is today or in the future
 */
const futureDateField = (fieldName = 'Date') =>
  z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? undefined : val),
    z.coerce
      .date({
        required_error: `${fieldName} is required`,
        invalid_type_error: `${fieldName} must be a valid date`,
      })
      .refine((date) => !isNaN(date.getTime()), {
        message: `${fieldName} must be a valid date`,
      })
      .refine(
        (date) => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          return date >= today;
        },
        { message: `${fieldName} must be in the future` }
      )
  );

const timeSlotField = z.enum(VIEWING_TIME_SLOT_ENUM, {
  required_error: 'Time slot is required',
  errorMap: () => ({
    message: `Time slot must be one of: ${VIEWING_TIME_SLOT_ENUM.join(', ')}`,
  }),
});

const viewingTypeField = z
  .enum(VIEWING_TYPE_ENUM, {
    errorMap: () => ({
      message: `Viewing type must be one of: ${VIEWING_TYPE_ENUM.join(', ')}`,
    }),
  })
  .default('IN_PERSON');

const tenantNotesField = z
  .string({ invalid_type_error: 'Tenant notes must be a string' })
  .trim()
  .max(500, 'Tenant notes cannot exceed 500 characters')
  .optional()
  .default('');

const ownerNotesField = z
  .string({ invalid_type_error: 'Owner notes must be a string' })
  .trim()
  .max(500, 'Owner notes cannot exceed 500 characters')
  .optional()
  .default('');

// ──────────────────────────────────────────────────────────────────────
// 1. Create Viewing Schema
// ──────────────────────────────────────────────────────────────────────

/**
 * Validates request body for POST /api/v1/viewings.
 * Disallows client-supplied tenant, owner, or status fields via .strict().
 */
export const createViewingSchema = z
  .object({
    propertyId: propertyIdField,
    viewingDate: futureDateField('Viewing date'),
    timeSlot: timeSlotField,
    viewingType: viewingTypeField,
    tenantNotes: tenantNotesField,
  })
  .strict('Unexpected fields detected. Fields like tenant, owner, or status are server-derived.');

// ──────────────────────────────────────────────────────────────────────
// 2. Update Viewing Status Schema
// ──────────────────────────────────────────────────────────────────────

/**
 * Validates request body for PATCH /api/v1/viewings/:id/status.
 * Only accepts CONFIRMED, REJECTED, RESCHEDULED, or CANCELLED with optional ownerNotes.
 * When status is RESCHEDULED, rescheduledDate and rescheduledTimeSlot are conditionally required.
 */
export const updateViewingStatusSchema = z
  .object({
    status: z.enum(UPDATE_VIEWING_STATUS_ENUM, {
      required_error: 'Status is required',
      errorMap: () => ({
        message: `Status must be one of: ${UPDATE_VIEWING_STATUS_ENUM.join(', ')}`,
      }),
    }),
    rescheduledDate: z
      .preprocess(
        (val) => (val === '' || val === null || val === undefined ? undefined : val),
        z.coerce
          .date({ invalid_type_error: 'Rescheduled date must be a valid date' })
          .refine((date) => !isNaN(date.getTime()), {
            message: 'Rescheduled date must be a valid date',
          })
          .refine(
            (date) => {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              return date >= today;
            },
            { message: 'Rescheduled date must be in the future' }
          )
      )
      .optional(),
    rescheduledTimeSlot: z
      .enum(VIEWING_TIME_SLOT_ENUM, {
        errorMap: () => ({
          message: `Rescheduled time slot must be one of: ${VIEWING_TIME_SLOT_ENUM.join(', ')}`,
        }),
      })
      .optional(),
    ownerNotes: ownerNotesField,
  })
  .strict('Unexpected fields detected. Only status, rescheduledDate, rescheduledTimeSlot, and ownerNotes are allowed.')
  .superRefine((data, ctx) => {
    if (data.status === 'RESCHEDULED') {
      if (!data.rescheduledDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Rescheduled date is required when status is RESCHEDULED',
          path: ['rescheduledDate'],
        });
      }
      if (!data.rescheduledTimeSlot) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Rescheduled time slot is required when status is RESCHEDULED',
          path: ['rescheduledTimeSlot'],
        });
      }
    }
  });

// ──────────────────────────────────────────────────────────────────────
// 3. Viewing Route Parameter Schema
// ──────────────────────────────────────────────────────────────────────

/**
 * Validates :id route parameters for property viewings.
 */
export const viewingParamsSchema = z
  .object({
    id: z
      .string({ required_error: 'Viewing ID is required' })
      .trim()
      .regex(OBJECT_ID_REGEX, 'Invalid viewing ID format (must be a 24-character hexadecimal string)'),
  })
  .strict();

// ──────────────────────────────────────────────────────────────────────
// 4. Viewing Query Schema (Pagination & Filtering)
// ──────────────────────────────────────────────────────────────────────

/**
 * Validates query parameters for listing property viewings.
 */
export const viewingQuerySchema = z
  .object({
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
    status: z.enum(VIEWING_STATUS_ENUM).optional(),
    propertyId: z
      .string()
      .trim()
      .regex(OBJECT_ID_REGEX, 'Invalid property ID format')
      .optional(),
  })
  .strip();

// ──────────────────────────────────────────────────────────────────────
// 5. Express Middleware Helper for Route Params
// ──────────────────────────────────────────────────────────────────────

/**
 * Express middleware helper to validate req.params against a Zod schema.
 * Formats errors consistently with validate and validateQuery middleware.
 */
export const validateParams = (schema) => {
  return async (req, res, next) => {
    try {
      const parsedParams = await schema.parseAsync(req.params);
      req.params = parsedParams;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        const zodIssues = error.issues || error.errors || [];
        const formattedErrors = zodIssues.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: formattedErrors,
        });
      }
      next(error);
    }
  };
};
