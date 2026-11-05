import mongoose from 'mongoose';
import RentalRequest, { RENTAL_REQUEST_STATUS_ENUM } from '../models/rentalRequest.model.js';
import Property from '../models/property.model.js';

// ── Projection Constants ──────────────────────────────────────────────

/**
 * Safe public user fields to populate for applicants or property owners.
 * Prevents exposure of sensitive auth or internal properties.
 */
const SAFE_USER_FIELDS = 'name email avatar phone';

/**
 * Relevant property fields to populate for rental request responses.
 */
const RELEVANT_PROPERTY_FIELDS =
  'title description propertyType location rent deposit bedrooms bathrooms images status availableFrom availableRooms';

// ──────────────────────────────────────────────────────────────────────
// 1. CREATE RENTAL REQUEST
// ──────────────────────────────────────────────────────────────────────

/**
 * Creates a new rental request for a property by the authenticated tenant.
 *
 * Business Rules:
 * - Property must exist in the database.
 * - Property status must be 'AVAILABLE'.
 * - Tenant cannot apply for their own property listing.
 * - Owner is derived directly from property.createdBy (never trusted from client).
 * - Checks property room availability if capacity is tracked.
 * - Duplicate active requests (PENDING or ACCEPTED) are blocked.
 * - Reapplication is allowed if prior requests were REJECTED or CANCELLED.
 *
 * @param {string} tenantId - Authenticated tenant user ID
 * @param {Object} input - Validated request payload from Zod
 * @returns {Promise<Object>} Created and populated rental request document
 */
export const createRentalRequest = async (tenantId, input) => {
  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    const error = new Error('Invalid tenant user ID');
    error.statusCode = 400;
    error.code = 'INVALID_TENANT_ID';
    throw error;
  }

  const { propertyId, moveInDate, leaseDurationMonths, occupantsCount, proposedRent, message } =
    input;

  if (!propertyId || !mongoose.Types.ObjectId.isValid(propertyId)) {
    const error = new Error('Invalid property ID format');
    error.statusCode = 400;
    error.code = 'INVALID_PROPERTY_ID';
    throw error;
  }

  // 1. Verify property existence
  const property = await Property.findById(propertyId).lean();
  if (!property) {
    const error = new Error('Property not found');
    error.statusCode = 404;
    error.code = 'PROPERTY_NOT_FOUND';
    throw error;
  }

  // 2. Business rule: Prevent requesting own property listing
  if (property.createdBy && property.createdBy.toString() === tenantId.toString()) {
    const error = new Error('You cannot submit a rental request for your own property');
    error.statusCode = 400;
    error.code = 'CANNOT_REQUEST_OWN_PROPERTY';
    throw error;
  }

  // 3. Business rule: Property must currently be AVAILABLE
  if (property.status !== 'AVAILABLE') {
    const error = new Error(
      `Property is not available for rental requests (currently ${property.status.toLowerCase()})`
    );
    error.statusCode = 400;
    error.code = 'PROPERTY_NOT_AVAILABLE';
    throw error;
  }

  // 4. Capacity validation: Verify room availability if tracked on the property
  if (property.availableRooms !== undefined && property.availableRooms !== null) {
    if (property.availableRooms === 0) {
      const error = new Error('No rooms are currently available in this property');
      error.statusCode = 400;
      error.code = 'NO_ROOMS_AVAILABLE';
      throw error;
    }
  }

  // 5. Duplicate prevention: Check for existing active (PENDING or ACCEPTED) request
  const existingActiveRequest = await RentalRequest.findOne({
    property: property._id,
    tenant: tenantId,
    status: { $in: ['PENDING', 'ACCEPTED'] },
  }).lean();

  if (existingActiveRequest) {
    const messageText =
      existingActiveRequest.status === 'PENDING'
        ? 'You already have a pending rental request for this property'
        : 'You already have an accepted rental request for this property';
    const error = new Error(messageText);
    error.statusCode = 409;
    error.code = 'ACTIVE_REQUEST_EXISTS';
    throw error;
  }

  // 6. Create the rental request document
  try {
    const newRequest = await RentalRequest.create({
      property: property._id,
      tenant: tenantId,
      owner: property.createdBy, // Securely derived from property listing
      moveInDate,
      leaseDurationMonths: leaseDurationMonths ?? 12,
      occupantsCount: occupantsCount ?? 1,
      proposedRent,
      message: message ? message.trim() : '',
      status: 'PENDING',
    });

    // Populate and return clean document
    const populated = await RentalRequest.findById(newRequest._id)
      .populate('property', RELEVANT_PROPERTY_FIELDS)
      .populate('owner', SAFE_USER_FIELDS)
      .populate('tenant', SAFE_USER_FIELDS)
      .lean();

    return populated;
  } catch (error) {
    // Handle race condition if a unique constraint or partial index fires
    if (error.code === 11000 || error.codeName === 'DuplicateKey') {
      const conflictError = new Error('An active rental request already exists for this property');
      conflictError.statusCode = 409;
      conflictError.code = 'ACTIVE_REQUEST_EXISTS';
      throw conflictError;
    }
    throw error;
  }
};

// ──────────────────────────────────────────────────────────────────────
// 2. GET MY RENTAL REQUESTS (TENANT)
// ──────────────────────────────────────────────────────────────────────

/**
 * Retrieves all rental requests submitted by the authenticated tenant.
 *
 * Performance:
 * - Employs index { tenant: 1, createdAt: -1 } for fast sorted pagination.
 * - Safely handles missing/orphaned property references.
 *
 * @param {string} tenantId - Authenticated tenant's user ID
 * @param {Object} [pagination] - Query params: { page, limit, status }
 * @returns {Promise<{ rentalRequests: Array, pagination: Object }>}
 */
export const getMyRentalRequests = async (tenantId, pagination = {}) => {
  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    const error = new Error('Invalid tenant user ID');
    error.statusCode = 400;
    error.code = 'INVALID_TENANT_ID';
    throw error;
  }

  const page = Math.max(1, parseInt(pagination.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(pagination.limit, 10) || 12));
  const skip = (page - 1) * limit;

  // Build filter query
  const filter = { tenant: tenantId };
  if (pagination.status && RENTAL_REQUEST_STATUS_ENUM.includes(pagination.status)) {
    filter.status = pagination.status;
  }

  const [rentalRequests, total] = await Promise.all([
    RentalRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('property', RELEVANT_PROPERTY_FIELDS)
      .populate('owner', SAFE_USER_FIELDS)
      .lean(),
    RentalRequest.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  return {
    rentalRequests,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      hasPreviousPage: page > 1,
    },
  };
};

// ──────────────────────────────────────────────────────────────────────
// 3. GET RECEIVED RENTAL REQUESTS (OWNER)
// ──────────────────────────────────────────────────────────────────────

/**
 * Retrieves all rental requests received by the authenticated property owner.
 *
 * Performance:
 * - Employs index { owner: 1, createdAt: -1 } for fast sorted pagination.
 * - Exposes only safe public profile data for tenant applicants.
 *
 * @param {string} ownerId - Authenticated property owner's user ID
 * @param {Object} [pagination] - Query params: { page, limit, status, propertyId }
 * @returns {Promise<{ rentalRequests: Array, pagination: Object }>}
 */
export const getReceivedRentalRequests = async (ownerId, pagination = {}) => {
  if (!ownerId || !mongoose.Types.ObjectId.isValid(ownerId)) {
    const error = new Error('Invalid owner user ID');
    error.statusCode = 400;
    error.code = 'INVALID_OWNER_ID';
    throw error;
  }

  const page = Math.max(1, parseInt(pagination.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(pagination.limit, 10) || 12));
  const skip = (page - 1) * limit;

  // Build filter query
  const filter = { owner: ownerId };
  if (pagination.status && RENTAL_REQUEST_STATUS_ENUM.includes(pagination.status)) {
    filter.status = pagination.status;
  }
  if (pagination.propertyId && mongoose.Types.ObjectId.isValid(pagination.propertyId)) {
    filter.property = pagination.propertyId;
  }

  const [rentalRequests, total] = await Promise.all([
    RentalRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('property', RELEVANT_PROPERTY_FIELDS)
      .populate('tenant', SAFE_USER_FIELDS)
      .lean(),
    RentalRequest.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  return {
    rentalRequests,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      hasPreviousPage: page > 1,
    },
  };
};

// ──────────────────────────────────────────────────────────────────────
// 4. GET RENTAL REQUEST BY ID
// ──────────────────────────────────────────────────────────────────────

/**
 * Retrieves a single rental request by ID.
 * Access is restricted to either the applicant tenant or the property owner.
 *
 * @param {string} requestId - Rental request document ID
 * @param {string} userId - Authenticated user ID (must be tenant or owner)
 * @returns {Promise<Object>} Populated rental request document
 */
export const getRentalRequestById = async (requestId, userId) => {
  if (!requestId || !mongoose.Types.ObjectId.isValid(requestId)) {
    const error = new Error('Invalid rental request ID format');
    error.statusCode = 400;
    error.code = 'INVALID_REQUEST_ID';
    throw error;
  }

  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    const error = new Error('Invalid user ID');
    error.statusCode = 401;
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  const request = await RentalRequest.findById(requestId)
    .populate('property', RELEVANT_PROPERTY_FIELDS)
    .populate('owner', SAFE_USER_FIELDS)
    .populate('tenant', SAFE_USER_FIELDS)
    .lean();

  if (!request) {
    const error = new Error('Rental request not found');
    error.statusCode = 404;
    error.code = 'RENTAL_REQUEST_NOT_FOUND';
    throw error;
  }

  // Authorization check: User must be either the tenant or the owner
  const tenantIdStr = request.tenant?._id
    ? request.tenant._id.toString()
    : request.tenant?.toString();
  const ownerIdStr = request.owner?._id
    ? request.owner._id.toString()
    : request.owner?.toString();

  if (tenantIdStr !== userId.toString() && ownerIdStr !== userId.toString()) {
    const error = new Error('You are not authorized to view this rental request');
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }

  return request;
};

// ──────────────────────────────────────────────────────────────────────
// 5. UPDATE RENTAL REQUEST STATUS
// ──────────────────────────────────────────────────────────────────────

/**
 * Updates the lifecycle status of a rental request.
 *
 * Permitted Status Transitions:
 * - Owner: PENDING -> ACCEPTED (atomic multi-document transaction)
 * - Owner: PENDING -> REJECTED
 * - Tenant: PENDING -> CANCELLED
 *
 * @param {string} requestId - Rental request ID
 * @param {string} userId - Authenticated user ID
 * @param {Object} input - { status, ownerNotes }
 * @returns {Promise<Object>} Updated, populated rental request document
 */
export const updateRentalRequestStatus = async (requestId, userId, input) => {
  if (!requestId || !mongoose.Types.ObjectId.isValid(requestId)) {
    const error = new Error('Invalid rental request ID format');
    error.statusCode = 400;
    error.code = 'INVALID_REQUEST_ID';
    throw error;
  }

  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    const error = new Error('Invalid user ID');
    error.statusCode = 401;
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  const { status: targetStatus, ownerNotes } = input;

  // 1. Initial read to identify role and check current status
  const existingRequest = await RentalRequest.findById(requestId);
  if (!existingRequest) {
    const error = new Error('Rental request not found');
    error.statusCode = 404;
    error.code = 'RENTAL_REQUEST_NOT_FOUND';
    throw error;
  }

  const isOwner = existingRequest.owner.toString() === userId.toString();
  const isTenant = existingRequest.tenant.toString() === userId.toString();

  if (!isOwner && !isTenant) {
    const error = new Error('You are not authorized to update this rental request');
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }

  // 2. Business rule: Request must be in PENDING status to transition
  if (existingRequest.status !== 'PENDING') {
    const error = new Error(
      `Cannot update rental request that is already ${existingRequest.status.toLowerCase()}`
    );
    error.statusCode = 400;
    error.code = 'INVALID_STATUS_TRANSITION';
    throw error;
  }

  // 3. Role-based transition validation
  if (isTenant) {
    if (targetStatus !== 'CANCELLED') {
      const error = new Error('Tenants are only permitted to cancel pending rental requests');
      error.statusCode = 403;
      error.code = 'FORBIDDEN_TRANSITION';
      throw error;
    }

    existingRequest.status = 'CANCELLED';
    await existingRequest.save();

    const populated = await RentalRequest.findById(existingRequest._id)
      .populate('property', RELEVANT_PROPERTY_FIELDS)
      .populate('owner', SAFE_USER_FIELDS)
      .populate('tenant', SAFE_USER_FIELDS)
      .lean();

    return populated;
  }

  // If user is owner:
  if (!['ACCEPTED', 'REJECTED'].includes(targetStatus)) {
    const error = new Error('Property owners can only accept or reject pending rental requests');
    error.statusCode = 400;
    error.code = 'INVALID_STATUS_TRANSITION';
    throw error;
  }

  // ── Handling Owner REJECTED ─────────────────────────────────────────
  if (targetStatus === 'REJECTED') {
    existingRequest.status = 'REJECTED';
    if (ownerNotes !== undefined && ownerNotes !== null) {
      existingRequest.ownerNotes = ownerNotes.trim();
    }
    await existingRequest.save();

    const populated = await RentalRequest.findById(existingRequest._id)
      .populate('property', RELEVANT_PROPERTY_FIELDS)
      .populate('owner', SAFE_USER_FIELDS)
      .populate('tenant', SAFE_USER_FIELDS)
      .lean();

    return populated;
  }

  // ── Handling Owner ACCEPTED (Atomic Multi-Document Transaction) ──────
  // When an owner accepts a request:
  // 1. Confirm request is still PENDING.
  // 2. Confirm property is owned by the user and still AVAILABLE.
  // 3. Atomically mark property as RENTED.
  // 4. Accept the chosen request.
  // 5. Reject all other pending requests for that property.
  const session = await mongoose.startSession();
  let updatedRequestId = null;

  try {
    await session.withTransaction(async () => {
      // Step A: Re-fetch request inside session to guarantee snapshot consistency
      const currentRequest = await RentalRequest.findById(requestId).session(session);
      if (!currentRequest) {
        const error = new Error('Rental request not found');
        error.statusCode = 404;
        error.code = 'RENTAL_REQUEST_NOT_FOUND';
        throw error;
      }

      if (currentRequest.status !== 'PENDING') {
        const error = new Error(
          `Rental request is no longer pending (currently ${currentRequest.status.toLowerCase()})`
        );
        error.statusCode = 400;
        error.code = 'REQUEST_NOT_PENDING';
        throw error;
      }

      if (currentRequest.owner.toString() !== userId.toString()) {
        const error = new Error('Only the property owner can accept this rental request');
        error.statusCode = 403;
        error.code = 'FORBIDDEN';
        throw error;
      }

      // Step B: Atomically transition property status from AVAILABLE to RENTED.
      // If another concurrent acceptance has already rented the property, this returns null!
      const updatedProperty = await Property.findOneAndUpdate(
        {
          _id: currentRequest.property,
          createdBy: userId,
          status: 'AVAILABLE',
        },
        {
          $set: { status: 'RENTED' },
        },
        {
          new: true,
          session,
        }
      );

      if (!updatedProperty) {
        // Detailed error diagnostic
        const prop = await Property.findById(currentRequest.property).session(session);
        if (!prop) {
          const error = new Error('Associated property not found');
          error.statusCode = 404;
          error.code = 'PROPERTY_NOT_FOUND';
          throw error;
        }
        if (prop.createdBy.toString() !== userId.toString()) {
          const error = new Error('Authenticated user is not the owner of this property');
          error.statusCode = 403;
          error.code = 'FORBIDDEN';
          throw error;
        }

        const conflictError = new Error(
          `Cannot accept request: Property is already ${prop.status.toLowerCase()}`
        );
        conflictError.statusCode = 409;
        conflictError.code = 'PROPERTY_ALREADY_RENTED';
        throw conflictError;
      }

      // Step C: Accept the selected request
      currentRequest.status = 'ACCEPTED';
      if (ownerNotes !== undefined && ownerNotes !== null) {
        currentRequest.ownerNotes = ownerNotes.trim();
      }
      await currentRequest.save({ session });
      updatedRequestId = currentRequest._id;

      // Step D: Reject all competing pending requests for this property
      await RentalRequest.updateMany(
        {
          property: currentRequest.property,
          _id: { $ne: currentRequest._id },
          status: 'PENDING',
        },
        {
          $set: {
            status: 'REJECTED',
            ownerNotes: 'Property has been leased to another applicant.',
          },
        },
        { session }
      );
    });
  } catch (error) {
    // Surface transactional or conflict errors cleanly
    throw error;
  } finally {
    await session.endSession();
  }

  // Fetch and return populated updated request outside session
  const populated = await RentalRequest.findById(updatedRequestId)
    .populate('property', RELEVANT_PROPERTY_FIELDS)
    .populate('owner', SAFE_USER_FIELDS)
    .populate('tenant', SAFE_USER_FIELDS)
    .lean();

  return populated;
};
