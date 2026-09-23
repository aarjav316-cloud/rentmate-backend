// ── Load .env FIRST via side-effect import (ESM hoists all imports, so this must be an import) ──
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import connectDB from './src/config/db.js';
import { connectRedis, redisClient } from './src/config/redis.js';
import passport from 'passport';
import './src/config/passport.js';
import mongoose from 'mongoose';
import authRoutes from './src/routes/auth.routes.js';
import onboardingRoutes from './src/routes/onboarding.routes.js';
import userRoutes from './src/routes/user.routes.js';
import propertyRoutes from './src/routes/property.routes.js';
import propertyPreferenceRoutes from './src/routes/propertyPreference.routes.js';
import rateLimit from './src/middlewares/rateLimit.middleware.js';

// Connect to MongoDB + Redis
connectDB();
connectRedis();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(passport.initialize());

// Mount API Routes
app.use('/api/auth', authRoutes);

// ── General API Rate Limiter (v1 routes) ─────────────────────────────
const generalApiLimiter = rateLimit({
  windowSeconds: 900,    // 15 minutes
  maxRequests: 100,
  keyPrefix: 'general',
});
app.use('/api/v1', generalApiLimiter);

app.use('/api/v1/onboarding', onboardingRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/properties', propertyRoutes);
app.use('/api/v1/preferences/property', propertyPreferenceRoutes);

// ── Root ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('Rent-Mate Backend API Running');
});

// ── Health Endpoint ──────────────────────────────────────────────────
app.get('/api/v1/health', async (req, res) => {
  const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

  let redisStatus = 'disconnected';
  try {
    await redisClient.ping();
    redisStatus = 'connected';
  } catch {
    redisStatus = 'disconnected';
  }

  res.status(200).json({
    success: true,
    message: 'RentMate API is running',
    services: {
      mongodb: mongoStatus,
      redis: redisStatus,
    },
  });
});

// ── Global Error Handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    code: err.code || undefined,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
