import { z } from 'zod';

const validLookingFor = [
  'ROOMMATE_FOR_MY_PROPERTY',
  'PROPERTY_TO_LIVE_IN',
  'ROOMMATE_FOR_EXISTING_PROPERTY',
];

export const onboardingSchema = z.object({
  hasPropertyToList: z.boolean({
    required_error: 'hasPropertyToList is required',
    invalid_type_error: 'hasPropertyToList must be a boolean',
  }),
  lookingFor: z
    .array(
      z.enum(validLookingFor, {
        errorMap: () => ({
          message: `lookingFor values must be one of: ${validLookingFor.join(', ')}`,
        }),
      })
    )
    .min(1, 'At least one lookingFor option is required')
    .refine(
      (arr) => new Set(arr).size === arr.length,
      { message: 'lookingFor must not contain duplicate values' }
    ),
});
