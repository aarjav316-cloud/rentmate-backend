import { z } from 'zod';

const PROPERTY_TYPES = ['APARTMENT', 'HOUSE', 'PG', 'STUDIO', 'VILLA'];

// Base schemas for fields to keep rules identical between create and update
const preferredLocationsField = z
  .array(
    z.string().trim().min(1, 'Location string cannot be empty')
  )
  .max(10, 'Cannot exceed 10 preferred locations')
  .optional();

const minRentField = z
  .number()
  .min(0, 'Minimum rent cannot be negative')
  .optional();

const maxRentField = z
  .number()
  .min(0, 'Maximum rent cannot be negative')
  .optional();

const minBedroomsField = z
  .number()
  .int('Minimum bedrooms must be an integer')
  .min(0, 'Minimum bedrooms cannot be negative')
  .optional();

const maxBedroomsField = z
  .number()
  .int('Maximum bedrooms must be an integer')
  .min(0, 'Maximum bedrooms cannot be negative')
  .optional();

const propertyTypesField = z
  .array(
    z.enum(PROPERTY_TYPES, {
      errorMap: () => ({ message: `Property type must be one of: ${PROPERTY_TYPES.join(', ')}` }),
    })
  )
  .optional();

const requiredAmenitiesField = z
  .array(
    z.string().trim().min(1, 'Amenity string cannot be empty')
  )
  .max(30, 'Cannot exceed 30 required amenities')
  .optional();

const preferredAvailableFromField = z
  .coerce.date()
  .optional();

// ── Cross-field Validation Helper ────────────────────────────────────

const crossFieldValidation = (data, ctx) => {
  // Validate Rent Range
  if (data.minRent !== undefined && data.maxRent !== undefined) {
    if (data.minRent > data.maxRent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Minimum rent cannot be greater than maximum rent',
        path: ['minRent'],
      });
    }
  }

  // Validate Bedrooms Range
  if (data.minBedrooms !== undefined && data.maxBedrooms !== undefined) {
    if (data.minBedrooms > data.maxBedrooms) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Minimum bedrooms cannot be greater than maximum bedrooms',
        path: ['minBedrooms'],
      });
    }
  }
};

// ── Create Schema ────────────────────────────────────────────────────

export const createPropertyPreferenceSchema = z
  .object({
    preferredLocations: preferredLocationsField.default([]),
    minRent: minRentField,
    maxRent: maxRentField,
    propertyTypes: propertyTypesField.default([]),
    minBedrooms: minBedroomsField,
    maxBedrooms: maxBedroomsField,
    requiredAmenities: requiredAmenitiesField.default([]),
    preferredAvailableFrom: preferredAvailableFromField,
  })
  .strict('Unexpected fields detected. Fields like user, _id, or timestamps are not allowed.')
  .superRefine(crossFieldValidation);

// ── Update Schema ────────────────────────────────────────────────────

export const updatePropertyPreferenceSchema = z
  .object({
    // Defaults are omitted in the update schema to prevent overwriting existing data with empty arrays if omitted from partial payload
    preferredLocations: preferredLocationsField,
    minRent: minRentField,
    maxRent: maxRentField,
    propertyTypes: propertyTypesField,
    minBedrooms: minBedroomsField,
    maxBedrooms: maxBedroomsField,
    requiredAmenities: requiredAmenitiesField,
    preferredAvailableFrom: preferredAvailableFromField,
  })
  .strict('Unexpected fields detected. Fields like user, _id, or timestamps are not allowed.')
  .superRefine((data, ctx) => {
    // 1. Cross-validate ranges explicitly
    crossFieldValidation(data, ctx);
    
    // 2. Ensure the payload isn't empty on update
    if (Object.keys(data).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one field must be provided for update',
        path: [],
      });
    }
  });
