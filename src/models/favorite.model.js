import mongoose from 'mongoose';

const favoriteSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: [true, 'Property reference is required'],
    },
  },
  {
    timestamps: true,
  }
);

// ── Indexes ──────────────────────────────────────────────────────────

// 1. Compound unique index: prevents a user from favoriting the same property multiple times
//    and resolves concurrent duplicate requests at the database layer.
favoriteSchema.index({ user: 1, property: 1 }, { unique: true });

// 2. User favorites sorting index: optimizes fetching a user's saved properties ordered by newest first
//    (satisfies { user: userId } sorted by { createdAt: -1 } without requiring an in-memory sort).
favoriteSchema.index({ user: 1, createdAt: -1 });

// 3. Property lookup index: supports reverse lookups by property
//    (e.g., aggregate save counts, property popularity analytics, or cascade cleanups).
favoriteSchema.index({ property: 1 });

const Favorite = mongoose.model('Favorite', favoriteSchema);

export default Favorite;
