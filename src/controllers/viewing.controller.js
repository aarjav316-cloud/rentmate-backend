import { z } from 'zod';
import * as viewingService from '../services/viewing.service.js';
import {
  createViewingSchema,
  updateViewingStatusSchema,
  viewingParamsSchema,
  viewingQuerySchema,
} from '../validators/viewing.validator.js';

/**
 * Safe helper to extract the authenticated user's ID.
 * Works seamlessly whether authentication middleware mounts `req.user.id` or `req.user._id`.
 *
 * @param {Object} req - Express request object
 * @returns {string|null} User ID string or null
 */
const getUserId = (req) => req.user?.id || req.user?._id || null;

/**
 * Formats Zod validation issues into clean error response array.
 */
const formatZodIssues = (error) => {
  const issues = error.issues || error.errors || [];
  return issues.map((err) => ({
    field: err.path.join('.'),
    message: err.message,
  }));
};

// ──────────────────────────────────────────────────────────────────────
// 1. CREATE VIEWING
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Submit a new property viewing request
 * @route   POST /api/v1/viewings
 * @access  Private (Tenants only)
 */
export const createViewing = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.',
        code: 'UNAUTHORIZED',
      });
    }

    // Validate body using Zod schema
    const validatedBody = await createViewingSchema.parseAsync(req.body);

    const viewing = await viewingService.createViewing(userId, validatedBody);

    return res.status(201).json({
      success: true,
      message: 'Viewing request submitted successfully',
      data: viewing,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: formatZodIssues(error),
      });
    }
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 2. GET MY VIEWINGS (TENANT)
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Get all viewing appointments requested by the authenticated tenant
 * @route   GET /api/v1/viewings/my
 * @access  Private (Tenants only)
 */
export const getMyViewings = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.',
        code: 'UNAUTHORIZED',
      });
    }

    // Validate query parameters (page, limit, status)
    const rawQuery = req.validatedQuery || req.query || {};
    const validatedQuery = await viewingQuerySchema.parseAsync(rawQuery);

    const { viewings, pagination } = await viewingService.getMyViewings(userId, validatedQuery);

    return res.status(200).json({
      success: true,
      count: viewings.length,
      data: viewings,
      pagination,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: formatZodIssues(error),
      });
    }
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 3. GET RECEIVED VIEWINGS (OWNER)
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Get all viewing appointments received by the authenticated property owner
 * @route   GET /api/v1/viewings/received
 * @access  Private (Landlords/Owners only)
 */
export const getReceivedViewings = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.',
        code: 'UNAUTHORIZED',
      });
    }

    // Validate query parameters (page, limit, status, propertyId)
    const rawQuery = req.validatedQuery || req.query || {};
    const validatedQuery = await viewingQuerySchema.parseAsync(rawQuery);

    const { viewings, pagination } = await viewingService.getReceivedViewings(
      userId,
      validatedQuery
    );

    return res.status(200).json({
      success: true,
      count: viewings.length,
      data: viewings,
      pagination,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: formatZodIssues(error),
      });
    }
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 4. GET VIEWING BY ID
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Get a single viewing appointment by ID
 * @route   GET /api/v1/viewings/:id
 * @access  Private (Associated Tenant or Owner only)
 */
export const getViewingById = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.',
        code: 'UNAUTHORIZED',
      });
    }

    // Validate :id route param format
    const { id } = await viewingParamsSchema.parseAsync(req.params);

    const viewing = await viewingService.getViewingById(id, userId);

    return res.status(200).json({
      success: true,
      data: viewing,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: formatZodIssues(error),
      });
    }
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 5. UPDATE VIEWING STATUS
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Update viewing appointment status
 *          (Owner: CONFIRMED, REJECTED, RESCHEDULED, CANCELLED, COMPLETED;
 *           Tenant: CANCELLED, CONFIRMED for rescheduled, COMPLETED)
 * @route   PATCH /api/v1/viewings/:id/status
 * @access  Private (Associated Tenant or Owner only)
 */
export const updateViewingStatus = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.',
        code: 'UNAUTHORIZED',
      });
    }

    // Validate :id route param format
    const { id } = await viewingParamsSchema.parseAsync(req.params);

    // Validate body payload (status, rescheduledDate, rescheduledTimeSlot, ownerNotes)
    const validatedBody = await updateViewingStatusSchema.parseAsync(req.body);

    const updatedViewing = await viewingService.updateViewingStatus(id, userId, validatedBody);

    return res.status(200).json({
      success: true,
      message: `Viewing appointment ${validatedBody.status.toLowerCase()} successfully`,
      data: updatedViewing,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: formatZodIssues(error),
      });
    }
    next(error);
  }
};
