import { z } from 'zod';
import { RENTAL_REQUEST_STATUS_ENUM } from '../models/rentalRequest.model.js';

/**
 * 24-character hexadecimal MongoDB ObjectId regex pattern.
 */
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

/**
 * Allowed status transitions when updating a rental request.
 * (A client can only accept, reject, or cancel an application).
 */
export const UPDATE_RENTAL_REQUEST_STATUS_ENUM = ['ACCEPTED', 'REJECTED', 'CANCELLED'];

// ── Shared Field Definitions ──────────────────────────────────────────

const propertyIdField = z
  .string({ required_error: 'Property ID is required' })
  .trim()
  .regex(OBJECT_ID_REGEX, 'Invalid property ID format (must be a 24-character hexadecimal string)');

const moveInDateField = z.preprocess(
  (val) => (val === '' || val === null || val === undefined ? undefined : val),
  z.coerce
    .date({
      required_error: 'Move-in date is required',
      invalid_type_error: 'Move-in date must be a valid date',
    })
    .refine(
      (date) => !isNaN(date.getTime()),
      { message: 'Move-in date must be a valid date' }
    )
    .refine(
      (date) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return date >= today;
      },
      { message: 'Move-in date must be in the future' }
    )
);

const leaseDurationMonthsField = z.coerce
  .number({
    required_error: 'Lease duration is required',
    invalid_type_error: 'Lease duration must be a number',
  })
  .int('Lease duration must be a whole number of months')
  .min(1, 'Lease duration must be at least 1 month')
  .max(60, 'Lease duration cannot exceed 60 months')
  .default(12);

const occupantsCountField = z.coerce
  .number({
    required_error: 'Occupants count is required',
    invalid_type_error: 'Occupants count must be a number',
  })
  .int('Occupants count must be a whole number')
  .min(1, 'Must have at least 1 occupant')
  .max(20, 'Occupants count cannot exceed 20')
  .default(1);

const proposedRentField = z.coerce
  .number({
    required_error: 'Proposed rent is required',
    invalid_type_error: 'Proposed rent must be a number',
  })
  .positive('Proposed rent must be greater than 0');

const messageField = z
  .string({ invalid_type_error: 'Message must be a string' })
  .trim()
  .max(1000, 'Message cannot exceed 1000 characters')
  .optional()
  .default('');

// ──────────────────────────────────────────────────────────────────────
// 1. Create Rental Request Schema
// ──────────────────────────────────────────────────────────────────────

/**
 * Validates request body for POST /api/v1/rental-requests.
 * Disallows client-supplied tenant, owner, or status fields via .strict().
 */
export const createRentalRequestSchema = z
  .object({
    propertyId: propertyIdField,
    moveInDate: moveInDateField,
    leaseDurationMonths: leaseDurationMonthsField,
    occupantsCount: occupantsCountField,
    proposedRent: proposedRentField,
    message: messageField,
  })
  .strict('Unexpected fields detected. Fields like tenant, owner, or status are server-derived.');

// ──────────────────────────────────────────────────────────────────────
// 2. Update Rental Request Status Schema
// ──────────────────────────────────────────────────────────────────────

/**
 * Validates request body for PATCH /api/v1/rental-requests/:id/status.
 * Only accepts ACCEPTED, REJECTED, or CANCELLED with optional ownerNotes.
 */
export const updateRentalRequestStatusSchema = z
  .object({
    status: z.enum(UPDATE_RENTAL_REQUEST_STATUS_ENUM, {
      required_error: 'Status is required',
      errorMap: () => ({
        message: `Status must be one of: ${UPDATE_RENTAL_REQUEST_STATUS_ENUM.join(', ')}`,
      }),
    }),
    ownerNotes: z
      .string({ invalid_type_error: 'Owner notes must be a string' })
      .trim()
      .max(500, 'Owner notes cannot exceed 500 characters')
      .optional()
      .default(''),
  })
  .strict('Unexpected fields detected. Only status and ownerNotes are allowed.');

// ──────────────────────────────────────────────────────────────────────
// 3. Rental Request Route Parameter Schema
// ──────────────────────────────────────────────────────────────────────

/**
 * Validates :id route parameters for rental requests.
 */
export const rentalRequestParamsSchema = z
  .object({
    id: z
      .string({ required_error: 'Rental request ID is required' })
      .trim()
      .regex(OBJECT_ID_REGEX, 'Invalid rental request ID format (must be a 24-character hexadecimal string)'),
  })
  .strict();

// ──────────────────────────────────────────────────────────────────────
// 4. Rental Request Query Schema (Pagination & Filtering)
// ──────────────────────────────────────────────────────────────────────

/**
 * Validates query parameters for listing rental requests.
 */
export const rentalRequestQuerySchema = z
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
    status: z.enum(RENTAL_REQUEST_STATUS_ENUM).optional(),
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
