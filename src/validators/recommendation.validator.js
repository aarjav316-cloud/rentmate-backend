import { z } from 'zod';

// ──────────────────────────────────────────────────────────────────────
// Recommendation Query Schema
// ──────────────────────────────────────────────────────────────────────

/**
 * Validates and coerces the query parameters for the recommendation
 * endpoint. Follows the same Zod + coerce pattern as
 * propertyQuerySchema in property.validator.js.
 */
export const recommendationQuerySchema = z
  .object({
    page: z.coerce
      .number()
      .int('Page must be a whole number')
      .min(1, 'Page must be at least 1')
      .default(1),
    limit: z.coerce
      .number()
      .int('Limit must be a whole number')
      .min(1, 'Limit must be at least 1')
      .max(50, 'Limit cannot exceed 50')
      .default(12),
  })
  .strip(); // Silently drop unknown query parameters
