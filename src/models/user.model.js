import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxLength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true, // Fast lookups during login & auth checks
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      select: false, // Prevents sending password hash by default
    },
    phone: {
      type: String,
      trim: true,
      sparse: true, // Sparse index allows optional phone numbers without duplicate key errors on null
      index: true,
    },
    role: {
      type: String,
      enum: ['tenant', 'landlord', 'admin'],
      default: 'tenant',
      index: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended'],
      default: 'active',
      index: true,
    },
    avatar: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Compound Index for admin queries filtering users by role and status ordered by creation time
userSchema.index({ role: 1, status: 1, createdAt: -1 });

// Text Index for full-text search across name and email
userSchema.index({ name: 'text', email: 'text' });

const User = mongoose.model('User', userSchema);

export default User;
