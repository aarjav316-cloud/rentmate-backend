import mongoose from 'mongoose';
import PropertyViewing, {
  VIEWING_TIME_SLOT_ENUM,
  VIEWING_TYPE_ENUM,
  VIEWING_STATUS_ENUM,
} from '../models/propertyViewing.model.js';
import Property from '../models/property.model.js';

// ── Projection Constants ──────────────────────────────────────────────

/**
 * Safe public user fields to populate for applicants or property owners.
 * Prevents exposure of sensitive auth or internal properties.
 */
const SAFE_USER_FIELDS = 'name email avatar phone';

/**
 * Relevant property fields to populate for viewing appointment responses.
 */
const RELEVANT_PROPERTY_FIELDS =
  'title description propertyType location rent deposit bedrooms bathrooms images status availableFrom availableRooms';

// ── Time Slot Boundaries ──────────────────────────────────────────────

/**
 * Hour boundaries corresponding to each time slot for chronological validation.
 */
const TIME_SLOT_HOURS = {
  MORNING_10_12: { startHour: 10, endHour: 12 },
  AFTERNOON_12_3: { startHour: 12, endHour: 15 },
  EVENING_3_6: { startHour: 15, endHour: 18 },
  EVENING_6_8: { startHour: 18, endHour: 20 },
};

/**
 * Helper to compute appointment start datetime.
 */
const getAppointmentStartTime = (date, timeSlot) => {
  const start = new Date(date);
  const hours = TIME_SLOT_HOURS[timeSlot] || { startHour: 10 };
  start.setHours(hours.startHour, 0, 0, 0);
  return start;
};

/**
 * Helper to compute appointment end datetime.
 */
const getAppointmentEndTime = (date, timeSlot) => {
  const end = new Date(date);
  const hours = TIME_SLOT_HOURS[timeSlot] || { endHour: 20 };
  end.setHours(hours.endHour, 0, 0, 0);
  return end;
};

// ── Slot Conflict Helpers ─────────────────────────────────────────────

/**
 * Checks if a property already has a CONFIRMED or RESCHEDULED appointment
 * occupying the given calendar date and time slot.
 *
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} params.propertyId
 * @param {Date|string} params.date
 * @param {string} params.timeSlot
 * @param {string|mongoose.Types.ObjectId} [params.excludeViewingId] - Optional viewing ID to exclude
 * @param {mongoose.ClientSession} [params.session]
 * @returns {Promise<Object|null>} Conflicting viewing document or null
 */
export const checkPropertySlotConflict = async ({
  propertyId,
  date,
  timeSlot,
  excludeViewingId = null,
  session = null,
}) => {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const conflictQuery = {
    property: propertyId,
    $or: [
      // 1. Confirmed viewing occupying this date and slot
      {
        status: 'CONFIRMED',
        viewingDate: { $gte: startOfDay, $lte: endOfDay },
        timeSlot,
      },
      // 2. Rescheduled viewing with proposed slot on this date and slot
      {
        status: 'RESCHEDULED',
        rescheduledDate: { $gte: startOfDay, $lte: endOfDay },
        rescheduledTimeSlot: timeSlot,
      },
    ],
  };

  if (excludeViewingId) {
    conflictQuery._id = { $ne: excludeViewingId };
  }

  const query = PropertyViewing.findOne(conflictQuery);
  if (session) query.session(session);

  return query.lean();
};

/**
 * Checks if a tenant already has another CONFIRMED viewing scheduled on the same date and slot.
 *
 * @param {Object} params
 * @param {string|mongoose.Types.ObjectId} params.tenantId
 * @param {Date|string} params.date
 * @param {string} params.timeSlot
 * @param {string|mongoose.Types.ObjectId} [params.excludeViewingId]
 * @param {mongoose.ClientSession} [params.session]
 * @returns {Promise<Object|null>} Conflicting viewing document or null
 */
export const checkTenantSlotConflict = async ({
  tenantId,
  date,
  timeSlot,
  excludeViewingId = null,
  session = null,
}) => {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const tenantConflictQuery = {
    tenant: tenantId,
    status: 'CONFIRMED',
    viewingDate: { $gte: startOfDay, $lte: endOfDay },
    timeSlot,
  };

  if (excludeViewingId) {
    tenantConflictQuery._id = { $ne: excludeViewingId };
  }

  const query = PropertyViewing.findOne(tenantConflictQuery);
  if (session) query.session(session);

  return query.lean();
};

// ──────────────────────────────────────────────────────────────────────
// 1. CREATE VIEWING
// ──────────────────────────────────────────────────────────────────────

/**
 * Creates a new property viewing request by the authenticated tenant.
 *
 * Business Rules:
 * - Property must exist in the database.
 * - Property status must be 'AVAILABLE'.
 * - Tenant cannot book viewings for their own property listings.
 * - Owner is derived directly from property.createdBy.
 * - Requested date and time slot must be valid and in the future.
 * - Checks for duplicate active requests (REQUESTED, CONFIRMED, RESCHEDULED).
 * - Checks property slot availability and tenant schedule conflicts.
 *
 * @param {string} tenantId - Authenticated tenant user ID
 * @param {Object} input - Validated payload from Zod
 * @returns {Promise<Object>} Created and populated viewing document
 */
export const createViewing = async (tenantId, input) => {
  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    const error = new Error('Invalid tenant user ID');
    error.statusCode = 400;
    error.code = 'INVALID_TENANT_ID';
    throw error;
  }

  const { propertyId, viewingDate, timeSlot, viewingType, tenantNotes } = input;

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

  // 2. Prevent booking viewing on own property
  if (property.createdBy && property.createdBy.toString() === tenantId.toString()) {
    const error = new Error('You cannot book a viewing for your own property');
    error.statusCode = 400;
    error.code = 'CANNOT_BOOK_OWN_PROPERTY';
    throw error;
  }

  // 3. Property must be AVAILABLE
  if (property.status !== 'AVAILABLE') {
    const error = new Error(
      `Property is not available for viewings (currently ${property.status.toLowerCase()})`
    );
    error.statusCode = 400;
    error.code = 'PROPERTY_NOT_AVAILABLE';
    throw error;
  }

  // 4. Validate timeSlot
  if (!VIEWING_TIME_SLOT_ENUM.includes(timeSlot)) {
    const error = new Error(
      `Invalid time slot. Must be one of: ${VIEWING_TIME_SLOT_ENUM.join(', ')}`
    );
    error.statusCode = 400;
    error.code = 'INVALID_TIME_SLOT';
    throw error;
  }

  // 5. Validate appointment date is in the future
  const appointmentStart = getAppointmentStartTime(viewingDate, timeSlot);
  if (appointmentStart <= new Date()) {
    const error = new Error('Viewing appointment date and time must be in the future');
    error.statusCode = 400;
    error.code = 'INVALID_VIEWING_DATE';
    throw error;
  }

  // 6. Prevent duplicate active viewing requests (REQUESTED, CONFIRMED, RESCHEDULED)
  const existingActiveViewing = await PropertyViewing.findOne({
    property: property._id,
    tenant: tenantId,
    status: { $in: ['REQUESTED', 'CONFIRMED', 'RESCHEDULED'] },
  }).lean();

  if (existingActiveViewing) {
    const error = new Error(
      `You already have an active viewing appointment or request for this property (status: ${existingActiveViewing.status.toLowerCase()})`
    );
    error.statusCode = 409;
    error.code = 'ACTIVE_VIEWING_EXISTS';
    throw error;
  }

  // 7. Check for existing CONFIRMED or RESCHEDULED appointments on the property at that slot
  const propertyConflict = await checkPropertySlotConflict({
    propertyId: property._id,
    date: viewingDate,
    timeSlot,
  });

  if (propertyConflict) {
    const error = new Error(
      'The selected viewing time slot is already booked for this property. Please choose another slot.'
    );
    error.statusCode = 409;
    error.code = 'VIEWING_SLOT_CONFLICT';
    throw error;
  }

  // 8. Check for tenant schedule conflict
  const tenantConflict = await checkTenantSlotConflict({
    tenantId,
    date: viewingDate,
    timeSlot,
  });

  if (tenantConflict) {
    const error = new Error(
      'You already have another confirmed viewing scheduled at this date and time slot.'
    );
    error.statusCode = 409;
    error.code = 'TENANT_SCHEDULE_CONFLICT';
    throw error;
  }

  // 9. Create viewing request document
  try {
    const newViewing = await PropertyViewing.create({
      property: property._id,
      tenant: tenantId,
      owner: property.createdBy, // Securely derived from property listing
      viewingDate,
      timeSlot,
      viewingType: viewingType || 'IN_PERSON',
      tenantNotes: tenantNotes ? tenantNotes.trim() : '',
      status: 'REQUESTED',
    });

    const populated = await PropertyViewing.findById(newViewing._id)
      .populate('property', RELEVANT_PROPERTY_FIELDS)
      .populate('owner', SAFE_USER_FIELDS)
      .populate('tenant', SAFE_USER_FIELDS)
      .lean();

    return populated;
  } catch (error) {
    // Graceful duplicate-key handling for concurrent race conditions
    if (error.code === 11000 || error.codeName === 'DuplicateKey') {
      const conflictError = new Error(
        'An active viewing appointment already exists for this property'
      );
      conflictError.statusCode = 409;
      conflictError.code = 'ACTIVE_VIEWING_EXISTS';
      throw conflictError;
    }
    throw error;
  }
};

// ──────────────────────────────────────────────────────────────────────
// 2. GET MY VIEWINGS (TENANT)
// ──────────────────────────────────────────────────────────────────────

/**
 * Retrieves all viewing appointments requested by the authenticated tenant.
 *
 * Performance:
 * - Employs index { tenant: 1, viewingDate: 1 } for chronological ordering.
 * - Supports pagination and status filtering.
 *
 * @param {string} tenantId - Authenticated tenant user ID
 * @param {Object} [pagination] - Query params: { page, limit, status }
 * @returns {Promise<{ viewings: Array, pagination: Object }>}
 */
export const getMyViewings = async (tenantId, pagination = {}) => {
  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    const error = new Error('Invalid tenant user ID');
    error.statusCode = 400;
    error.code = 'INVALID_TENANT_ID';
    throw error;
  }

  const page = Math.max(1, parseInt(pagination.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(pagination.limit, 10) || 12));
  const skip = (page - 1) * limit;

  const filter = { tenant: tenantId };
  if (pagination.status && VIEWING_STATUS_ENUM.includes(pagination.status)) {
    filter.status = pagination.status;
  }

  const [viewings, total] = await Promise.all([
    PropertyViewing.find(filter)
      .sort({ viewingDate: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('property', RELEVANT_PROPERTY_FIELDS)
      .populate('owner', SAFE_USER_FIELDS)
      .lean(),
    PropertyViewing.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  return {
    viewings,
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
// 3. GET RECEIVED VIEWINGS (OWNER)
// ──────────────────────────────────────────────────────────────────────

/**
 * Retrieves all viewing appointments received by the authenticated property owner.
 *
 * Performance:
 * - Employs index { owner: 1, viewingDate: 1 } for chronological ordering.
 * - Supports pagination, propertyId filtering, and status filtering.
 *
 * @param {string} ownerId - Authenticated owner user ID
 * @param {Object} [pagination] - Query params: { page, limit, status, propertyId }
 * @returns {Promise<{ viewings: Array, pagination: Object }>}
 */
export const getReceivedViewings = async (ownerId, pagination = {}) => {
  if (!ownerId || !mongoose.Types.ObjectId.isValid(ownerId)) {
    const error = new Error('Invalid owner user ID');
    error.statusCode = 400;
    error.code = 'INVALID_OWNER_ID';
    throw error;
  }

  const page = Math.max(1, parseInt(pagination.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(pagination.limit, 10) || 12));
  const skip = (page - 1) * limit;

  const filter = { owner: ownerId };
  if (pagination.status && VIEWING_STATUS_ENUM.includes(pagination.status)) {
    filter.status = pagination.status;
  }
  if (pagination.propertyId && mongoose.Types.ObjectId.isValid(pagination.propertyId)) {
    filter.property = pagination.propertyId;
  }

  const [viewings, total] = await Promise.all([
    PropertyViewing.find(filter)
      .sort({ viewingDate: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('property', RELEVANT_PROPERTY_FIELDS)
      .populate('tenant', SAFE_USER_FIELDS)
      .lean(),
    PropertyViewing.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  return {
    viewings,
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
// 4. GET VIEWING BY ID
// ──────────────────────────────────────────────────────────────────────

/**
 * Retrieves a single viewing appointment by ID.
 * Access is authorized strictly for the tenant applicant or property owner.
 *
 * @param {string} viewingId - Viewing document ID
 * @param {string} userId - Authenticated user ID
 * @returns {Promise<Object>} Populated viewing document
 */
export const getViewingById = async (viewingId, userId) => {
  if (!viewingId || !mongoose.Types.ObjectId.isValid(viewingId)) {
    const error = new Error('Invalid viewing ID format');
    error.statusCode = 400;
    error.code = 'INVALID_VIEWING_ID';
    throw error;
  }

  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    const error = new Error('Invalid user ID');
    error.statusCode = 401;
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  const viewing = await PropertyViewing.findById(viewingId)
    .populate('property', RELEVANT_PROPERTY_FIELDS)
    .populate('owner', SAFE_USER_FIELDS)
    .populate('tenant', SAFE_USER_FIELDS)
    .lean();

  if (!viewing) {
    const error = new Error('Viewing appointment not found');
    error.statusCode = 404;
    error.code = 'VIEWING_NOT_FOUND';
    throw error;
  }

  const tenantIdStr = viewing.tenant?._id
    ? viewing.tenant._id.toString()
    : viewing.tenant?.toString();
  const ownerIdStr = viewing.owner?._id
    ? viewing.owner._id.toString()
    : viewing.owner?.toString();

  if (tenantIdStr !== userId.toString() && ownerIdStr !== userId.toString()) {
    const error = new Error('You are not authorized to view this property viewing');
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }

  return viewing;
};

// ──────────────────────────────────────────────────────────────────────
// 5. UPDATE VIEWING STATUS
// ──────────────────────────────────────────────────────────────────────

/**
 * Updates the lifecycle status of a viewing appointment.
 *
 * Permitted Status Transitions:
 * - Owner:
 *   - REQUESTED -> CONFIRMED (verifies slot availability)
 *   - REQUESTED -> REJECTED
 *   - REQUESTED -> RESCHEDULED (stores proposed date & time slot)
 *   - CONFIRMED -> CANCELLED (prior to appointment)
 *   - CONFIRMED -> COMPLETED (after appointment time)
 * - Tenant:
 *   - REQUESTED -> CANCELLED
 *   - CONFIRMED -> CANCELLED (prior to appointment)
 *   - RESCHEDULED -> CONFIRMED (promotes rescheduled date & clears proposal)
 *   - RESCHEDULED -> CANCELLED (declines proposed reschedule)
 *   - CONFIRMED -> COMPLETED (after appointment time)
 *
 * @param {string} viewingId - Viewing document ID
 * @param {string} userId - Authenticated user ID
 * @param {Object} input - Validated update fields { status, rescheduledDate, rescheduledTimeSlot, ownerNotes }
 * @returns {Promise<Object>} Updated, populated viewing document
 */
export const updateViewingStatus = async (viewingId, userId, input) => {
  if (!viewingId || !mongoose.Types.ObjectId.isValid(viewingId)) {
    const error = new Error('Invalid viewing ID format');
    error.statusCode = 400;
    error.code = 'INVALID_VIEWING_ID';
    throw error;
  }

  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    const error = new Error('Invalid user ID');
    error.statusCode = 401;
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  const { status: targetStatus, rescheduledDate, rescheduledTimeSlot, ownerNotes } = input;

  const existingViewing = await PropertyViewing.findById(viewingId);
  if (!existingViewing) {
    const error = new Error('Viewing appointment not found');
    error.statusCode = 404;
    error.code = 'VIEWING_NOT_FOUND';
    throw error;
  }

  const isOwner = existingViewing.owner.toString() === userId.toString();
  const isTenant = existingViewing.tenant.toString() === userId.toString();

  if (!isOwner && !isTenant) {
    const error = new Error('You are not authorized to update this viewing appointment');
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }

  const currentStatus = existingViewing.status;

  // Terminal states cannot be altered
  if (['REJECTED', 'CANCELLED', 'COMPLETED'].includes(currentStatus)) {
    const error = new Error(
      `Cannot update viewing appointment that is already ${currentStatus.toLowerCase()}`
    );
    error.statusCode = 400;
    error.code = 'INVALID_STATUS_TRANSITION';
    throw error;
  }

  // ──────────────────────────────────────────────────────────────────
  // Transition: CANCELLED (Both Tenant and Owner before scheduled time)
  // ──────────────────────────────────────────────────────────────────
  if (targetStatus === 'CANCELLED') {
    // Effective appointment end time depends on whether viewing was in normal or rescheduled state
    const effectiveDate =
      currentStatus === 'RESCHEDULED' && existingViewing.rescheduledDate
        ? existingViewing.rescheduledDate
        : existingViewing.viewingDate;
    const effectiveSlot =
      currentStatus === 'RESCHEDULED' && existingViewing.rescheduledTimeSlot
        ? existingViewing.rescheduledTimeSlot
        : existingViewing.timeSlot;

    const appointmentEnd = getAppointmentEndTime(effectiveDate, effectiveSlot);

    if (new Date() > appointmentEnd) {
      const error = new Error('Cannot cancel an appointment that has already passed');
      error.statusCode = 400;
      error.code = 'APPOINTMENT_ALREADY_PASSED';
      throw error;
    }

    existingViewing.status = 'CANCELLED';
    if (isOwner && ownerNotes !== undefined && ownerNotes !== null) {
      existingViewing.ownerNotes = ownerNotes.trim();
    }
    await existingViewing.save();

    const populated = await PropertyViewing.findById(existingViewing._id)
      .populate('property', RELEVANT_PROPERTY_FIELDS)
      .populate('owner', SAFE_USER_FIELDS)
      .populate('tenant', SAFE_USER_FIELDS)
      .lean();

    return populated;
  }

  // ──────────────────────────────────────────────────────────────────
  // Transition: COMPLETED (After scheduled appointment time)
  // ──────────────────────────────────────────────────────────────────
  if (targetStatus === 'COMPLETED') {
    if (currentStatus !== 'CONFIRMED') {
      const error = new Error(
        `Only confirmed viewings can be marked as completed (current status: ${currentStatus.toLowerCase()})`
      );
      error.statusCode = 400;
      error.code = 'INVALID_STATUS_TRANSITION';
      throw error;
    }

    const appointmentStart = getAppointmentStartTime(
      existingViewing.viewingDate,
      existingViewing.timeSlot
    );

    if (new Date() < appointmentStart) {
      const error = new Error('Cannot mark a viewing as completed before its scheduled start time');
      error.statusCode = 400;
      error.code = 'APPOINTMENT_NOT_YET_OCCURRED';
      throw error;
    }

    existingViewing.status = 'COMPLETED';
    if (isOwner && ownerNotes !== undefined && ownerNotes !== null) {
      existingViewing.ownerNotes = ownerNotes.trim();
    }
    await existingViewing.save();

    const populated = await PropertyViewing.findById(existingViewing._id)
      .populate('property', RELEVANT_PROPERTY_FIELDS)
      .populate('owner', SAFE_USER_FIELDS)
      .populate('tenant', SAFE_USER_FIELDS)
      .lean();

    return populated;
  }

  // ──────────────────────────────────────────────────────────────────
  // Transition: REJECTED (Owner only from REQUESTED)
  // ──────────────────────────────────────────────────────────────────
  if (targetStatus === 'REJECTED') {
    if (!isOwner) {
      const error = new Error('Only the property owner can reject a viewing request');
      error.statusCode = 403;
      error.code = 'FORBIDDEN_TRANSITION';
      throw error;
    }

    if (currentStatus !== 'REQUESTED') {
      const error = new Error(
        `Cannot reject viewing with status ${currentStatus.toLowerCase()}. Only requested viewings can be rejected.`
      );
      error.statusCode = 400;
      error.code = 'INVALID_STATUS_TRANSITION';
      throw error;
    }

    existingViewing.status = 'REJECTED';
    if (ownerNotes !== undefined && ownerNotes !== null) {
      existingViewing.ownerNotes = ownerNotes.trim();
    }
    await existingViewing.save();

    const populated = await PropertyViewing.findById(existingViewing._id)
      .populate('property', RELEVANT_PROPERTY_FIELDS)
      .populate('owner', SAFE_USER_FIELDS)
      .populate('tenant', SAFE_USER_FIELDS)
      .lean();

    return populated;
  }

  // ──────────────────────────────────────────────────────────────────
  // Transition: RESCHEDULED (Owner proposing new date & timeSlot)
  // ──────────────────────────────────────────────────────────────────
  if (targetStatus === 'RESCHEDULED') {
    if (!isOwner) {
      const error = new Error('Only the property owner can reschedule a viewing');
      error.statusCode = 403;
      error.code = 'FORBIDDEN_TRANSITION';
      throw error;
    }

    if (!['REQUESTED', 'CONFIRMED'].includes(currentStatus)) {
      const error = new Error(
        `Cannot reschedule viewing with status ${currentStatus.toLowerCase()}`
      );
      error.statusCode = 400;
      error.code = 'INVALID_STATUS_TRANSITION';
      throw error;
    }

    if (!rescheduledDate || !rescheduledTimeSlot) {
      const error = new Error(
        'Both rescheduledDate and rescheduledTimeSlot are required when rescheduling'
      );
      error.statusCode = 400;
      error.code = 'RESCHEDULE_DETAILS_REQUIRED';
      throw error;
    }

    if (!VIEWING_TIME_SLOT_ENUM.includes(rescheduledTimeSlot)) {
      const error = new Error(
        `Invalid rescheduled time slot. Must be one of: ${VIEWING_TIME_SLOT_ENUM.join(', ')}`
      );
      error.statusCode = 400;
      error.code = 'INVALID_TIME_SLOT';
      throw error;
    }

    const proposedStart = getAppointmentStartTime(rescheduledDate, rescheduledTimeSlot);
    if (proposedStart <= new Date()) {
      const error = new Error('Rescheduled viewing date and time must be in the future');
      error.statusCode = 400;
      error.code = 'INVALID_VIEWING_DATE';
      throw error;
    }

    // Check slot conflict for proposed new slot on property
    const conflict = await checkPropertySlotConflict({
      propertyId: existingViewing.property,
      date: rescheduledDate,
      timeSlot: rescheduledTimeSlot,
      excludeViewingId: existingViewing._id,
    });

    if (conflict) {
      const error = new Error(
        'The proposed rescheduled time slot conflicts with an existing confirmed appointment on this property'
      );
      error.statusCode = 409;
      error.code = 'VIEWING_SLOT_CONFLICT';
      throw error;
    }

    existingViewing.status = 'RESCHEDULED';
    existingViewing.rescheduledDate = rescheduledDate;
    existingViewing.rescheduledTimeSlot = rescheduledTimeSlot;
    if (ownerNotes !== undefined && ownerNotes !== null) {
      existingViewing.ownerNotes = ownerNotes.trim();
    }
    await existingViewing.save();

    const populated = await PropertyViewing.findById(existingViewing._id)
      .populate('property', RELEVANT_PROPERTY_FIELDS)
      .populate('owner', SAFE_USER_FIELDS)
      .populate('tenant', SAFE_USER_FIELDS)
      .lean();

    return populated;
  }

  // ──────────────────────────────────────────────────────────────────
  // Transition: CONFIRMED
  // - Owner: REQUESTED -> CONFIRMED
  // - Tenant: RESCHEDULED -> CONFIRMED (Accepting owner's reschedule)
  // ──────────────────────────────────────────────────────────────────
  if (targetStatus === 'CONFIRMED') {
    // Case A: Owner confirming original REQUESTED slot
    if (isOwner) {
      if (currentStatus !== 'REQUESTED') {
        const error = new Error(
          `Owner can only confirm viewings in REQUESTED status (currently ${currentStatus.toLowerCase()})`
        );
        error.statusCode = 400;
        error.code = 'INVALID_STATUS_TRANSITION';
        throw error;
      }

      // Check slot conflict inside session transaction for concurrency safety
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const propertyConflict = await checkPropertySlotConflict({
            propertyId: existingViewing.property,
            date: existingViewing.viewingDate,
            timeSlot: existingViewing.timeSlot,
            excludeViewingId: existingViewing._id,
            session,
          });

          if (propertyConflict) {
            const conflictError = new Error(
              'The requested time slot has already been confirmed for another appointment on this property'
            );
            conflictError.statusCode = 409;
            conflictError.code = 'VIEWING_SLOT_CONFLICT';
            throw conflictError;
          }

          const tenantConflict = await checkTenantSlotConflict({
            tenantId: existingViewing.tenant,
            date: existingViewing.viewingDate,
            timeSlot: existingViewing.timeSlot,
            excludeViewingId: existingViewing._id,
            session,
          });

          if (tenantConflict) {
            const conflictError = new Error(
              'The tenant already has another confirmed viewing scheduled at this date and time slot'
            );
            conflictError.statusCode = 409;
            conflictError.code = 'TENANT_SCHEDULE_CONFLICT';
            throw conflictError;
          }

          existingViewing.status = 'CONFIRMED';
          if (ownerNotes !== undefined && ownerNotes !== null) {
            existingViewing.ownerNotes = ownerNotes.trim();
          }
          await existingViewing.save({ session });
        });
      } finally {
        await session.endSession();
      }

      const populated = await PropertyViewing.findById(existingViewing._id)
        .populate('property', RELEVANT_PROPERTY_FIELDS)
        .populate('owner', SAFE_USER_FIELDS)
        .populate('tenant', SAFE_USER_FIELDS)
        .lean();

      return populated;
    }

    // Case B: Tenant confirming a RESCHEDULED appointment proposed by owner
    if (isTenant) {
      if (currentStatus !== 'RESCHEDULED') {
        const error = new Error(
          `Tenant can only confirm viewings in RESCHEDULED status (currently ${currentStatus.toLowerCase()})`
        );
        error.statusCode = 400;
        error.code = 'INVALID_STATUS_TRANSITION';
        throw error;
      }

      if (!existingViewing.rescheduledDate || !existingViewing.rescheduledTimeSlot) {
        const error = new Error('No rescheduled date and time slot found on this appointment');
        error.statusCode = 400;
        error.code = 'RESCHEDULE_DETAILS_REQUIRED';
        throw error;
      }

      // Check slot conflict inside session transaction for concurrency safety
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const propertyConflict = await checkPropertySlotConflict({
            propertyId: existingViewing.property,
            date: existingViewing.rescheduledDate,
            timeSlot: existingViewing.rescheduledTimeSlot,
            excludeViewingId: existingViewing._id,
            session,
          });

          if (propertyConflict) {
            const conflictError = new Error(
              'The rescheduled time slot has already been confirmed for another appointment on this property'
            );
            conflictError.statusCode = 409;
            conflictError.code = 'VIEWING_SLOT_CONFLICT';
            throw conflictError;
          }

          const tenantConflict = await checkTenantSlotConflict({
            tenantId: existingViewing.tenant,
            date: existingViewing.rescheduledDate,
            timeSlot: existingViewing.rescheduledTimeSlot,
            excludeViewingId: existingViewing._id,
            session,
          });

          if (tenantConflict) {
            const conflictError = new Error(
              'You already have another confirmed viewing scheduled at this proposed date and time slot'
            );
            conflictError.statusCode = 409;
            conflictError.code = 'TENANT_SCHEDULE_CONFLICT';
            throw conflictError;
          }

          // Promote proposed reschedule to effective date & time slot
          existingViewing.viewingDate = existingViewing.rescheduledDate;
          existingViewing.timeSlot = existingViewing.rescheduledTimeSlot;
          existingViewing.rescheduledDate = null;
          existingViewing.rescheduledTimeSlot = null;
          existingViewing.status = 'CONFIRMED';

          await existingViewing.save({ session });
        });
      } finally {
        await session.endSession();
      }

      const populated = await PropertyViewing.findById(existingViewing._id)
        .populate('property', RELEVANT_PROPERTY_FIELDS)
        .populate('owner', SAFE_USER_FIELDS)
        .populate('tenant', SAFE_USER_FIELDS)
        .lean();

      return populated;
    }
  }

  // Any other unexpected combination
  const error = new Error(`Unsupported status transition from ${currentStatus} to ${targetStatus}`);
  error.statusCode = 400;
  error.code = 'INVALID_STATUS_TRANSITION';
  throw error;
};
