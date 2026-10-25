import mongoose from 'mongoose';

/**
 * Valid enum values for Roommate Profile fields.
 * Exported so validators, controllers, and matching algorithms can reuse them.
 */
export const GENDER_ENUM = ['MALE', 'FEMALE', 'NON_BINARY', 'OTHER', 'PREFER_NOT_TO_SAY'];

export const CLEANLINESS_ENUM = ['RELAXED', 'MODERATE', 'STRICT'];
export const SLEEP_SCHEDULE_ENUM = ['EARLY_RISER', 'NIGHT_OWL', 'FLEXIBLE'];
export const SMOKING_ENUM = ['NON_SMOKER', 'OUTSIDE_ONLY', 'SMOKER'];
export const DRINKING_ENUM = ['NON_DRINKER', 'SOCIAL', 'REGULAR'];
export const PETS_ENUM = ['NO_PETS', 'PET_FRIENDLY', 'HAS_PETS'];
export const DIET_ENUM = ['VEGETARIAN', 'NON_VEGETARIAN', 'VEGAN', 'ANY'];
export const GUESTS_ENUM = ['RARELY', 'OCCASIONALLY', 'FREQUENTLY'];

const roommateProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      unique: true, // Enforce one roommate profile per user
      index: true,
    },
    bio: {
      type: String,
      trim: true,
      maxLength: [500, 'Bio cannot exceed 500 characters'],
      default: '',
    },
    gender: {
      type: String,
      enum: {
        values: GENDER_ENUM,
        message: '{VALUE} is not a valid gender',
      },
      trim: true,
    },
    age: {
      type: Number,
      min: [18, 'Age must be at least 18'],
      max: [120, 'Age cannot exceed 120'],
      validate: {
        validator: function (v) {
          return v === undefined || v === null || Number.isInteger(v);
        },
        message: 'Age must be a whole number',
      },
    },
    occupation: {
      type: String,
      trim: true,
      maxLength: [100, 'Occupation cannot exceed 100 characters'],
      default: '',
    },
    // Individual monthly rent-share budget
    budgetMin: {
      type: Number,
      min: [0, 'Minimum budget cannot be negative'],
      validate: {
        validator: function (val) {
          if (val !== undefined && val !== null && this.budgetMax !== undefined && this.budgetMax !== null) {
            return val <= this.budgetMax;
          }
          return true;
        },
        message: 'Minimum budget cannot exceed maximum budget',
      },
    },
    budgetMax: {
      type: Number,
      min: [0, 'Maximum budget cannot be negative'],
      validate: {
        validator: function (val) {
          if (val !== undefined && val !== null && this.budgetMin !== undefined && this.budgetMin !== null) {
            return val >= this.budgetMin;
          }
          return true;
        },
        message: 'Maximum budget cannot be less than minimum budget',
      },
    },
    lifestylePreferences: {
      cleanliness: {
        type: String,
        enum: {
          values: CLEANLINESS_ENUM,
          message: '{VALUE} is not a valid cleanliness level',
        },
      },
      sleepSchedule: {
        type: String,
        enum: {
          values: SLEEP_SCHEDULE_ENUM,
          message: '{VALUE} is not a valid sleep schedule',
        },
      },
      smoking: {
        type: String,
        enum: {
          values: SMOKING_ENUM,
          message: '{VALUE} is not a valid smoking preference',
        },
      },
      drinking: {
        type: String,
        enum: {
          values: DRINKING_ENUM,
          message: '{VALUE} is not a valid drinking preference',
        },
      },
      pets: {
        type: String,
        enum: {
          values: PETS_ENUM,
          message: '{VALUE} is not a valid pet preference',
        },
      },
      diet: {
        type: String,
        enum: {
          values: DIET_ENUM,
          message: '{VALUE} is not a valid diet preference',
        },
      },
      guests: {
        type: String,
        enum: {
          values: GUESTS_ENUM,
          message: '{VALUE} is not a valid guests preference',
        },
      },
      interests: {
        type: [{ type: String, trim: true }],
        default: [],
        validate: {
          validator: (arr) => arr.length <= 20,
          message: 'Cannot have more than 20 interests',
        },
      },
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual alias allowing access via `lifestyle` or `lifestylePreferences`
roommateProfileSchema.virtual('lifestyle').get(function () {
  return this.lifestylePreferences;
}).set(function (val) {
  this.lifestylePreferences = val;
});

// Schema-level validation hook for budget range
roommateProfileSchema.pre('validate', function (next) {
  if (
    this.budgetMin !== undefined &&
    this.budgetMin !== null &&
    this.budgetMax !== undefined &&
    this.budgetMax !== null &&
    this.budgetMin > this.budgetMax
  ) {
    this.invalidate('budgetMin', 'Minimum budget (budgetMin) cannot exceed maximum budget (budgetMax)');
  }
  next();
});

// ── Indexes ──────────────────────────────────────────────────────────
// 1. Enforce one roommate profile per user
roommateProfileSchema.index({ user: 1 }, { unique: true });

// 2. Efficient matching query index for active profiles with budget range
roommateProfileSchema.index({ isActive: 1, budgetMin: 1, budgetMax: 1 });

// 3. For gender-filtered roommate queries (e.g., female-only or male-only matching)
roommateProfileSchema.index({ isActive: 1, gender: 1 });

const RoommateProfile = mongoose.model('RoommateProfile', roommateProfileSchema);

export default RoommateProfile;
