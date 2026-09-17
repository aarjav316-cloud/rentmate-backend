import mongoose from 'mongoose';

const propertySchema = new mongoose.Schema(
  {
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Property must have an owner'],
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      maxLength: [150, 'Title cannot exceed 150 characters'],
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxLength: [3000, 'Description cannot exceed 3000 characters'],
    },
    propertyType: {
      type: String,
      required: [true, 'Property type is required'],
      enum: {
        values: ['APARTMENT', 'HOUSE', 'PG', 'STUDIO', 'VILLA'],
        message: '{VALUE} is not a valid property type',
      },
    },
    location: {
      address: {
        type: String,
        required: [true, 'Address is required'],
        trim: true,
        maxLength: [300, 'Address cannot exceed 300 characters'],
      },
      city: {
        type: String,
        required: [true, 'City is required'],
        trim: true,
        maxLength: [100, 'City cannot exceed 100 characters'],
      },
      state: {
        type: String,
        required: [true, 'State is required'],
        trim: true,
        maxLength: [100, 'State cannot exceed 100 characters'],
      },
      pincode: {
        type: String,
        required: [true, 'Pincode is required'],
        trim: true,
        maxLength: [10, 'Pincode cannot exceed 10 characters'],
      },
    },
    rent: {
      type: Number,
      required: [true, 'Rent is required'],
      min: [1, 'Rent must be greater than 0'],
    },
    deposit: {
      type: Number,
      required: [true, 'Deposit is required'],
      min: [0, 'Deposit cannot be negative'],
    },
    bedrooms: {
      type: Number,
      required: [true, 'Number of bedrooms is required'],
      min: [0, 'Bedrooms cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Bedrooms must be a whole number',
      },
    },
    bathrooms: {
      type: Number,
      required: [true, 'Number of bathrooms is required'],
      min: [0, 'Bathrooms cannot be negative'],
    },
    amenities: {
      type: [{ type: String, trim: true }],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 30,
        message: 'Cannot have more than 30 amenities',
      },
    },
    images: {
      type: [{ type: String, trim: true }],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 15,
        message: 'Cannot have more than 15 images',
      },
    },
    availableFrom: {
      type: Date,
      required: [true, 'Available from date is required'],
    },
    availableRooms: {
      type: Number,
      required: [true, 'Number of available rooms is required'],
      min: [0, 'Available rooms cannot be negative'],
      validate: {
        validator: Number.isInteger,
        message: 'Available rooms must be a whole number',
      },
    },
    status: {
      type: String,
      enum: {
        values: ['AVAILABLE', 'UNAVAILABLE', 'RENTED'],
        message: '{VALUE} is not a valid status',
      },
      default: 'AVAILABLE',
    },
  },
  {
    timestamps: true,
  }
);

// ── Indexes ──────────────────────────────────────────────────────────

// 1. For "My Listings" queries
propertySchema.index({ createdBy: 1 });

// 2. For retrieving only AVAILABLE properties
propertySchema.index({ status: 1 });

// 3. For filtering by property type
propertySchema.index({ propertyType: 1 });

// 4. For location-based filtering
propertySchema.index({ 'location.city': 1 });

// 5. For rent range filtering
propertySchema.index({ rent: 1 });

// 6. Compound index to support common queries such as:
// available properties in a city within a rent range.
propertySchema.index({ status: 1, 'location.city': 1, rent: 1 });

const Property = mongoose.model('Property', propertySchema);

export default Property;
