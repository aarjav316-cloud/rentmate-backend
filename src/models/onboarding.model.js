import mongoose from 'mongoose';

/**
 * Valid enum values for the "lookingFor" field.
 * These represent user intents — NOT authorization roles.
 */
export const LOOKING_FOR_ENUM = [
  'ROOMMATE_FOR_MY_PROPERTY',
  'PROPERTY_TO_LIVE_IN',
  'ROOMMATE_FOR_EXISTING_PROPERTY',
];

const onboardingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    hasPropertyToList: {
      type: Boolean,
      required: [true, 'hasPropertyToList is required'],
    },
    lookingFor: {
      type: [
        {
          type: String,
          enum: {
            values: LOOKING_FOR_ENUM,
            message: '{VALUE} is not a valid lookingFor option',
          },
        },
      ],
      validate: {
        validator: (arr) => arr.length >= 1,
        message: 'At least one lookingFor option is required',
      },
    },
    onboardingCompleted: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const Onboarding = mongoose.model('Onboarding', onboardingSchema);

export default Onboarding;
