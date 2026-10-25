import mongoose from 'mongoose';

/**
 * Valid action enums for Roommate Interactions.
 * A user can either LIKE or PASS on a potential roommate candidate.
 */
export const INTERACTION_ACTION_ENUM = ['LIKE', 'PASS'];

const roommateInteractionSchema = new mongoose.Schema(
  {
    fromUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'fromUser is required'],
      index: true,
    },
    toUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'toUser is required'],
      index: true,
      validate: {
        validator: function (val) {
          if (!val || !this.fromUser) return true;
          return val.toString() !== this.fromUser.toString();
        },
        message: 'A user cannot interact with themselves (fromUser and toUser must be different)',
      },
    },
    action: {
      type: String,
      required: [true, 'Interaction action is required'],
      enum: {
        values: INTERACTION_ACTION_ENUM,
        message: '{VALUE} is not a valid interaction action',
      },
    },
  },
  {
    timestamps: true,
  }
);

// Schema-level validation hook to guarantee fromUser !== toUser
roommateInteractionSchema.pre('validate', function (next) {
  if (
    this.fromUser &&
    this.toUser &&
    this.fromUser.toString() === this.toUser.toString()
  ) {
    this.invalidate('toUser', 'fromUser and toUser cannot be the same user');
  }
  next();
});

// ── Indexes ──────────────────────────────────────────────────────────
// 1. Unique compound index preventing duplicate interactions between the same directed pair
roommateInteractionSchema.index({ fromUser: 1, toUser: 1 }, { unique: true });

// 2. Lookup index for reciprocal interaction queries (e.g., did toUser like fromUser?)
roommateInteractionSchema.index({ toUser: 1, fromUser: 1, action: 1 });

const RoommateInteraction = mongoose.model('RoommateInteraction', roommateInteractionSchema);

export default RoommateInteraction;
