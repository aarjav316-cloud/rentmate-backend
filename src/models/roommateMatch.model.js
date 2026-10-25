import mongoose from 'mongoose';

/**
 * Valid match status enums.
 */
export const MATCH_STATUS_ENUM = ['ACTIVE', 'CLOSED'];

const roommateMatchSchema = new mongoose.Schema(
  {
    userA: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userA is required'],
      index: true,
    },
    userB: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userB is required'],
      index: true,
      validate: {
        validator: function (val) {
          if (!val || !this.userA) return true;
          return val.toString() !== this.userA.toString();
        },
        message: 'userA and userB must be different users',
      },
    },
    status: {
      type: String,
      enum: {
        values: MATCH_STATUS_ENUM,
        message: '{VALUE} is not a valid match status',
      },
      default: 'ACTIVE',
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Enforce consistent canonical ordering (userA < userB) before validation.
 * Regardless of which user initiated the match, the two IDs are always stored
 * in deterministic lexicographical order. This, combined with the unique compound
 * index on { userA, userB }, genuinely guarantees uniqueness of the user pair.
 */
roommateMatchSchema.pre('validate', function (next) {
  if (this.userA && this.userB) {
    const idA = this.userA.toString();
    const idB = this.userB.toString();

    if (idA === idB) {
      this.invalidate('userB', 'userA and userB cannot be the same user');
    } else if (idA > idB) {
      // Deterministically sort into canonical order
      const temp = this.userA;
      this.userA = this.userB;
      this.userB = temp;
    }
  }
  next();
});

/**
 * Static helper to query a match between two users regardless of parameter order.
 */
roommateMatchSchema.statics.findBetweenUsers = function (userId1, userId2) {
  if (!userId1 || !userId2) return null;
  const id1 = userId1.toString();
  const id2 = userId2.toString();
  const [userA, userB] = id1 < id2 ? [userId1, userId2] : [userId2, userId1];
  return this.findOne({ userA, userB });
};

// ── Indexes ──────────────────────────────────────────────────────────
// 1. Genuinely guarantees pair uniqueness due to canonical ordering (userA < userB)
roommateMatchSchema.index({ userA: 1, userB: 1 }, { unique: true });

// 2. Fast retrieval for matches involving userA
roommateMatchSchema.index({ userA: 1, status: 1 });

// 3. Fast retrieval for matches involving userB
roommateMatchSchema.index({ userB: 1, status: 1 });

const RoommateMatch = mongoose.model('RoommateMatch', roommateMatchSchema);

export default RoommateMatch;
