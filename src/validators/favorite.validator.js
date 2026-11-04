import { z } from 'zod';

/**
 * 24-character hexadecimal MongoDB ObjectId regex pattern.
 */
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

/**
 * Validation schema for route parameters containing a propertyId.
 * Used for POST /api/v1/favorites/:propertyId and DELETE /api/v1/favorites/:propertyId.
 */
export const favoriteParamsSchema = z
  .object({
    propertyId: z
      .string({ required_error: 'Property ID is required' })
      .trim()
      .regex(OBJECT_ID_REGEX, 'Invalid property ID format (must be a 24-character hexadecimal string)'),
  })
  .strict();

/**
 * Validation schema for query parameters on GET /api/v1/favorites.
 * - page: Integer >= 1, defaults to 1.
 * - limit: Integer between 1 and 50, defaults to 12 (matching property discovery pagination).
 * - Strips unknown query parameters.
 */
export const favoriteQuerySchema = z
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
  })
  .strip();

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
