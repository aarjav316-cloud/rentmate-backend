import mongoose from 'mongoose';

const propertyPreferenceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'PropertyPreference must be associated with a user'],
      unique: true, // Each user should have only ONE preference profile
    },
    preferredLocations: {
      type: [{ type: String, trim: true }],
      default: [],
    },
    minRent: {
      type: Number,
      min: [0, 'Minimum rent cannot be negative'],
    },
    maxRent: {
      type: Number,
      min: [0, 'Maximum rent cannot be negative'],
    },
    propertyTypes: {
      type: [{ 
        type: String,
        enum: {
          values: ['APARTMENT', 'HOUSE', 'PG', 'STUDIO', 'VILLA'],
          message: '{VALUE} is not a valid property type',
        }
      }],
      default: [],
    },
    minBedrooms: {
      type: Number,
      min: [0, 'Minimum bedrooms cannot be negative'],
      validate: {
        validator: function(v) {
          return v === undefined || v === null || Number.isInteger(v);
        },
        message: 'Minimum bedrooms must be a whole number',
      },
    },
    maxBedrooms: {
      type: Number,
      min: [0, 'Maximum bedrooms cannot be negative'],
      validate: {
        validator: function(v) {
          return v === undefined || v === null || Number.isInteger(v);
        },
        message: 'Maximum bedrooms must be a whole number',
      },
    },
    requiredAmenities: {
      type: [{ type: String, trim: true }],
      default: [],
    },
    preferredAvailableFrom: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// We will add complex matching indexes in later steps once query patterns are established.

const PropertyPreference = mongoose.model('PropertyPreference', propertyPreferenceSchema);

export default PropertyPreference;
