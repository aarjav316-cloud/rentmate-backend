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
// Optimized based on explain("executionStats") analysis of actual query patterns.
//
// MongoDB automatically creates an index on _id — no manual index needed.
//
// REMOVED (redundant/low-value):
//   { status: 1 }         — subsumed by the compound { status, location.city, rent }
//   { propertyType: 1 }   — always queried with status; low standalone selectivity
//   { location.city: 1 }  — fully covered by the compound index for status + city queries
//
// KEPT:
//   { createdBy: 1 }                          — essential for GET /my (high selectivity)
//   { rent: 1 }                               — enables sort-by-rent without in-memory SORT
//   { status, location.city, rent }           — primary compound for discovery filters
//
// ADDED:
//   { status: 1, rent: 1 }                    — covers status + rent range (without city)
//     explain showed this common query was falling back to the single status_1 index
//     which requires in-memory filtering of rent range after FETCH

// 1. For "My Listings" queries — { createdBy: userId }
propertySchema.index({ createdBy: 1 });

// 2. For sort-by-rent queries — sort: { rent: 1 } or sort: { rent: -1 }
propertySchema.index({ rent: 1 });

// 3. For status + rent range — { status: AVAILABLE, rent: { $gte, $lte } }
propertySchema.index({ status: 1, rent: 1 });

// 4. Primary compound for discovery — { status: AVAILABLE, location.city: X, rent: range }
//    Follows Equality-Sort-Range (ESR) ordering.
propertySchema.index({ status: 1, 'location.city': 1, rent: 1 });

const Property = mongoose.model('Property', propertySchema);

export default Property;
