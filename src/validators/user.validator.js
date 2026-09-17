import { z } from 'zod';

/**
 * PATCH /api/v1/users/me — Update profile.
 *
 * .strict() rejects any unknown keys (returns a Zod error instead of
 * silently stripping them). This protects against clients sending
 * forbidden fields like role, status, email, password, etc.
 *
 * All fields are optional since this is a PATCH (partial update).
 * At least one field must be present — empty PATCH bodies are rejected.
 */
export const updateProfileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Name must be at least 2 characters long')
      .max(100, 'Name cannot exceed 100 characters')
      .optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format (E.164)')
      .optional()
      .nullable(),
    avatar: z
      .string()
      .trim()
      .url('Avatar must be a valid URL')
      .max(2048, 'Avatar URL cannot exceed 2048 characters')
      .optional()
      .nullable(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one field must be provided for update' }
  );
