import mongoose from 'mongoose';

/**
 * Valid allowed time slots for property viewings.
 */
export const VIEWING_TIME_SLOT_ENUM = [
  'MORNING_10_12',
  'AFTERNOON_12_3',
  'EVENING_3_6',
  'EVENING_6_8',
];

/**
 * Valid viewing modality types.
 */
export const VIEWING_TYPE_ENUM = ['IN_PERSON', 'VIRTUAL'];

/**
 * Valid lifecycle statuses for property viewings.
 */
export const VIEWING_STATUS_ENUM = [
  'REQUESTED',
  'CONFIRMED',
  'RESCHEDULED',
  'REJECTED',
  'CANCELLED',
  'COMPLETED',
];

const propertyViewingSchema = new mongoose.Schema(
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
    viewingDate: {
      type: Date,
      required: [true, 'Viewing date is required'],
    },
    timeSlot: {
      type: String,
      required: [true, 'Time slot is required'],
      enum: {
        values: VIEWING_TIME_SLOT_ENUM,
        message: '{VALUE} is not a valid viewing time slot',
      },
    },
    viewingType: {
      type: String,
      enum: {
        values: VIEWING_TYPE_ENUM,
        message: '{VALUE} is not a valid viewing type',
      },
      default: 'IN_PERSON',
    },
    status: {
      type: String,
      enum: {
        values: VIEWING_STATUS_ENUM,
        message: '{VALUE} is not a valid viewing status',
      },
      default: 'REQUESTED',
    },
    rescheduledDate: {
      type: Date,
      default: null,
    },
    rescheduledTimeSlot: {
      type: String,
      enum: {
        values: [...VIEWING_TIME_SLOT_ENUM, null],
        message: '{VALUE} is not a valid rescheduled time slot',
      },
      default: null,
    },
    tenantNotes: {
      type: String,
      trim: true,
      maxLength: [500, 'Tenant notes cannot exceed 500 characters'],
      default: '',
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

// 1. Compound index for querying active viewing requests for a property/tenant pair.
//    Supports fast service-level duplicate prevention without a permanent unique constraint.
propertyViewingSchema.index({ property: 1, tenant: 1, status: 1 });

// 2. Index for checking scheduled appointments on a specific property, date, and slot.
//    Optimizes owner schedule conflict detection in the service layer.
propertyViewingSchema.index({ property: 1, viewingDate: 1, timeSlot: 1 });

// 3. Index for tenant viewing appointments ("My Viewings") sorted chronologically.
propertyViewingSchema.index({ tenant: 1, viewingDate: 1 });

// 4. Index for landlord/owner viewing schedule management across their properties.
propertyViewingSchema.index({ owner: 1, viewingDate: 1 });

const PropertyViewing = mongoose.model('PropertyViewing', propertyViewingSchema);

export default PropertyViewing;
