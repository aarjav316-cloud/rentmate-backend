import { z } from 'zod';
import * as rentalRequestService from '../services/rentalRequest.service.js';
import {
  createRentalRequestSchema,
  updateRentalRequestStatusSchema,
  rentalRequestParamsSchema,
  rentalRequestQuerySchema,
} from '../validators/rentalRequest.validator.js';

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
// 1. CREATE RENTAL REQUEST
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Submit a new rental application for a property
 * @route   POST /api/v1/rental-requests
 * @access  Private (Tenants only)
 */
export const createRentalRequest = async (req, res, next) => {
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
    const validatedBody = await createRentalRequestSchema.parseAsync(req.body);

    const rentalRequest = await rentalRequestService.createRentalRequest(userId, validatedBody);

    return res.status(201).json({
      success: true,
      message: 'Rental request submitted successfully',
      data: rentalRequest,
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
// 2. GET MY RENTAL REQUESTS (TENANT)
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Get all rental requests submitted by the authenticated tenant
 * @route   GET /api/v1/rental-requests/my
 * @access  Private (Tenants only)
 */
export const getMyRentalRequests = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.',
        code: 'UNAUTHORIZED',
      });
    }

    // Validate query params (page, limit, status)
    const rawQuery = req.validatedQuery || req.query || {};
    const validatedQuery = await rentalRequestQuerySchema.parseAsync(rawQuery);

    const { rentalRequests, pagination } = await rentalRequestService.getMyRentalRequests(
      userId,
      validatedQuery
    );

    return res.status(200).json({
      success: true,
      count: rentalRequests.length,
      data: rentalRequests,
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
// 3. GET RECEIVED RENTAL REQUESTS (OWNER)
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Get all rental requests received by the authenticated property owner
 * @route   GET /api/v1/rental-requests/received
 * @access  Private (Landlords/Owners only)
 */
export const getReceivedRentalRequests = async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in.',
        code: 'UNAUTHORIZED',
      });
    }

    // Validate query params (page, limit, status)
    const rawQuery = req.validatedQuery || req.query || {};
    const validatedQuery = await rentalRequestQuerySchema.parseAsync(rawQuery);

    const { rentalRequests, pagination } = await rentalRequestService.getReceivedRentalRequests(
      userId,
      validatedQuery
    );

    return res.status(200).json({
      success: true,
      count: rentalRequests.length,
      data: rentalRequests,
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
// 4. GET RENTAL REQUEST BY ID
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Get a single rental request by ID
 * @route   GET /api/v1/rental-requests/:id
 * @access  Private (Associated Tenant or Owner only)
 */
export const getRentalRequestById = async (req, res, next) => {
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
    const { id } = await rentalRequestParamsSchema.parseAsync(req.params);

    const rentalRequest = await rentalRequestService.getRentalRequestById(id, userId);

    return res.status(200).json({
      success: true,
      data: rentalRequest,
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
// 5. UPDATE RENTAL REQUEST STATUS
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Update the lifecycle status of a rental request
 *          (Owner: ACCEPTED, REJECTED; Tenant: CANCELLED)
 * @route   PATCH /api/v1/rental-requests/:id/status
 * @access  Private (Associated Tenant or Owner only)
 */
export const updateRentalRequestStatus = async (req, res, next) => {
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
    const { id } = await rentalRequestParamsSchema.parseAsync(req.params);

    // Validate body payload (status, ownerNotes)
    const validatedBody = await updateRentalRequestStatusSchema.parseAsync(req.body);

    const updatedRequest = await rentalRequestService.updateRentalRequestStatus(
      id,
      userId,
      validatedBody
    );

    return res.status(200).json({
      success: true,
      message: `Rental request ${validatedBody.status.toLowerCase()} successfully`,
      data: updatedRequest,
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
