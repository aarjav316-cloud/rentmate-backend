import { z } from 'zod';

// ── Shared field definitions ─────────────────────────────────────────

const PROPERTY_TYPES = ['APARTMENT', 'HOUSE', 'PG', 'STUDIO', 'VILLA'];
const PROPERTY_STATUSES = ['AVAILABLE', 'UNAVAILABLE', 'RENTED'];

const titleField = z
  .string({ required_error: 'Title is required' })
  .trim()
  .min(5, 'Title must be at least 5 characters long')
  .max(150, 'Title cannot exceed 150 characters');

const descriptionField = z
  .string({ required_error: 'Description is required' })
  .trim()
  .min(10, 'Description must be at least 10 characters long')
  .max(3000, 'Description cannot exceed 3000 characters');

const propertyTypeField = z.enum(PROPERTY_TYPES, {
  errorMap: () => ({ message: `Property type must be one of: ${PROPERTY_TYPES.join(', ')}` }),
});

const locationSchema = z.object({
  address: z
    .string({ required_error: 'Address is required' })
    .trim()
    .min(3, 'Address must be at least 3 characters long')
    .max(300, 'Address cannot exceed 300 characters'),
  city: z
    .string({ required_error: 'City is required' })
    .trim()
    .min(2, 'City must be at least 2 characters long')
    .max(100, 'City cannot exceed 100 characters'),
  state: z
    .string({ required_error: 'State is required' })
    .trim()
    .min(2, 'State must be at least 2 characters long')
    .max(100, 'State cannot exceed 100 characters'),
  pincode: z
    .string({ required_error: 'Pincode is required' })
    .trim()
    .min(4, 'Pincode must be at least 4 characters long')
    .max(10, 'Pincode cannot exceed 10 characters')
    .regex(/^\d{4,10}$/, 'Pincode must contain only digits'),
});

const rentField = z
  .number({ required_error: 'Rent is required', invalid_type_error: 'Rent must be a number' })
  .positive('Rent must be greater than 0');

const depositField = z
  .number({ required_error: 'Deposit is required', invalid_type_error: 'Deposit must be a number' })
  .min(0, 'Deposit cannot be negative');

const bedroomsField = z
  .number({ required_error: 'Bedrooms is required', invalid_type_error: 'Bedrooms must be a number' })
  .int('Bedrooms must be a whole number')
  .min(0, 'Bedrooms cannot be negative');

const bathroomsField = z
  .number({ required_error: 'Bathrooms is required', invalid_type_error: 'Bathrooms must be a number' })
  .min(0, 'Bathrooms cannot be negative');

const amenitiesField = z
  .array(
    z.string().trim().min(1, 'Amenity cannot be empty').max(100, 'Amenity name too long'),
    { invalid_type_error: 'Amenities must be an array of strings' }
  )
  .max(30, 'Cannot have more than 30 amenities')
  .default([]);

const imagesField = z
  .array(
    z.string().trim().url('Each image must be a valid URL').max(2048, 'Image URL too long'),
    { invalid_type_error: 'Images must be an array of URLs' }
  )
  .max(15, 'Cannot have more than 15 images')
  .default([]);

const availableFromField = z.coerce.date({
  required_error: 'Available from date is required',
  invalid_type_error: 'Available from must be a valid date',
});

const availableRoomsField = z
  .number({ required_error: 'Available rooms is required', invalid_type_error: 'Available rooms must be a number' })
  .int('Available rooms must be a whole number')
  .min(0, 'Available rooms cannot be negative');

const statusField = z.enum(PROPERTY_STATUSES, {
  errorMap: () => ({ message: `Status must be one of: ${PROPERTY_STATUSES.join(', ')}` }),
});

// ── Create Property Schema ───────────────────────────────────────────
// .strict() rejects any unknown keys (createdBy, _id, etc.)

export const createPropertySchema = z
  .object({
    title: titleField,
    description: descriptionField,
    propertyType: propertyTypeField,
    location: locationSchema,
    rent: rentField,
    deposit: depositField,
    bedrooms: bedroomsField,
    bathrooms: bathroomsField,
    amenities: amenitiesField,
    images: imagesField,
    availableFrom: availableFromField,
    availableRooms: availableRoomsField,
    status: statusField.optional(),
  })
  .strict();

// ── Update Property Schema ───────────────────────────────────────────
// All fields optional (PATCH). .strict() prevents protected field injection.
// amenities/images re-declared without .default() so omitting them doesn't
// inject default keys (which would break the empty-body refine check).

const amenitiesFieldOptional = z
  .array(
    z.string().trim().min(1, 'Amenity cannot be empty').max(100, 'Amenity name too long'),
    { invalid_type_error: 'Amenities must be an array of strings' }
  )
  .max(30, 'Cannot have more than 30 amenities')
  .optional();

const imagesFieldOptional = z
  .array(
    z.string().trim().url('Each image must be a valid URL').max(2048, 'Image URL too long'),
    { invalid_type_error: 'Images must be an array of URLs' }
  )
  .max(15, 'Cannot have more than 15 images')
  .optional();

export const updatePropertySchema = z
  .object({
    title: titleField.optional(),
    description: descriptionField.optional(),
    propertyType: propertyTypeField.optional(),
    location: locationSchema.partial().optional(),
    rent: rentField.optional(),
    deposit: depositField.optional(),
    bedrooms: bedroomsField.optional(),
    bathrooms: bathroomsField.optional(),
    amenities: amenitiesFieldOptional,
    images: imagesFieldOptional,
    availableFrom: availableFromField.optional(),
    availableRooms: availableRoomsField.optional(),
    status: statusField.optional(),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one field must be provided for update' }
  );

// ── Property Discovery Query Schema ──────────────────────────────────
// Validates query parameters for GET /api/v1/properties
// All query params arrive as strings, so z.coerce is used for numbers/dates.

const SORT_FIELDS = ['createdAt', 'rent', 'availableFrom'];
const SORT_ORDERS = ['asc', 'desc'];

export const propertyQuerySchema = z
  .object({
    // Keyword search
    search: z.string().trim().max(200, 'Search query too long').optional(),

    // Location filters
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),

    // Rent range
    minRent: z.coerce.number().min(0, 'Minimum rent cannot be negative').optional(),
    maxRent: z.coerce.number().min(0, 'Maximum rent cannot be negative').optional(),

    // Property type
    propertyType: z.enum(PROPERTY_TYPES, {
      errorMap: () => ({ message: `Property type must be one of: ${PROPERTY_TYPES.join(', ')}` }),
    }).optional(),

    // Bedroom range
    minBedrooms: z.coerce.number().int('Bedrooms must be a whole number').min(0).optional(),
    maxBedrooms: z.coerce.number().int('Bedrooms must be a whole number').min(0).optional(),

    // Amenities (comma-separated string from URL)
    amenities: z.string().trim().max(500).optional(),

    // Availability
    availableFrom: z.coerce.date({ invalid_type_error: 'Available from must be a valid date' }).optional(),

    // Status
    status: z.enum(PROPERTY_STATUSES, {
      errorMap: () => ({ message: `Status must be one of: ${PROPERTY_STATUSES.join(', ')}` }),
    }).optional(),

    // Pagination
    page: z.coerce.number().int().min(1, 'Page must be at least 1').default(1),
    limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(50, 'Limit cannot exceed 50').default(12),

    // Sorting
    sortBy: z.enum(SORT_FIELDS, {
      errorMap: () => ({ message: `Sort field must be one of: ${SORT_FIELDS.join(', ')}` }),
    }).default('createdAt'),
    sortOrder: z.enum(SORT_ORDERS, {
      errorMap: () => ({ message: 'Sort order must be asc or desc' }),
    }).default('desc'),
  })
  .strip() // Silently drop unknown query parameters instead of erroring
  .superRefine((data, ctx) => {
    if (data.minRent !== undefined && data.maxRent !== undefined) {
      if (data.minRent > data.maxRent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Minimum rent cannot be greater than maximum rent',
          path: ['minRent'],
        });
      }
    }
    if (data.minBedrooms !== undefined && data.maxBedrooms !== undefined) {
      if (data.minBedrooms > data.maxBedrooms) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Minimum bedrooms cannot be greater than maximum bedrooms',
          path: ['minBedrooms'],
        });
      }
    }
  });
