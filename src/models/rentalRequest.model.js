import mongoose from 'mongoose';

/**
 * Valid lifecycle statuses for Rental Requests.
 */
export const RENTAL_REQUEST_STATUS_ENUM = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
];

const rentalRequestSchema = new mongoose.Schema(
  {
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: [true, 'Property reference is required'],
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Tenant reference is required'],
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner reference is required'],
    },
    moveInDate: {
      type: Date,
      required: [true, 'Move-in date is required'],
    },
    leaseDurationMonths: {
      type: Number,
      required: [true, 'Lease duration is required'],
      min: [1, 'Lease duration must be at least 1 month'],
      max: [60, 'Lease duration cannot exceed 60 months'],
      default: 12,
    },
    occupantsCount: {
      type: Number,
      required: [true, 'Number of occupants is required'],
      min: [1, 'Must have at least 1 occupant'],
      max: [20, 'Occupants count cannot exceed 20'],
      default: 1,
    },
    proposedRent: {
      type: Number,
      required: [true, 'Proposed rent is required'],
      min: [1, 'Proposed rent must be greater than 0'],
    },
    message: {
      type: String,
      trim: true,
      maxLength: [1000, 'Message cannot exceed 1000 characters'],
      default: '',
    },
    status: {
      type: String,
      enum: {
        values: RENTAL_REQUEST_STATUS_ENUM,
        message: '{VALUE} is not a valid rental request status',
      },
      default: 'PENDING',
    },
    ownerNotes: {
      type: String,
      trim: true,
      maxLength: [500, 'Owner notes cannot exceed 500 characters'],
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// ── Indexes ──────────────────────────────────────────────────────────

// 1. Compound index for querying active requests for a property/tenant pair.
//    Supports fast service-level duplicate prevention without a hard unique constraint,
//    allowing tenants to reapply after a previous application was rejected or cancelled.
rentalRequestSchema.index({ property: 1, tenant: 1, status: 1 });

// 2. Index for tenant query history ("My Applications") sorted newest first.
rentalRequestSchema.index({ tenant: 1, createdAt: -1 });

// 3. Index for landlord/owner incoming request queries ("Received Applications") sorted newest first.
rentalRequestSchema.index({ owner: 1, createdAt: -1 });

const RentalRequest = mongoose.model('RentalRequest', rentalRequestSchema);

export default RentalRequest;
