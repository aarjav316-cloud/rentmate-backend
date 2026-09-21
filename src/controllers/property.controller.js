import mongoose from 'mongoose';
import Property from '../models/property.model.js';
import {
  generateDiscoveryCacheKey,
  getCachedData,
  setCachedData,
  invalidatePropertyDiscoveryCaches,
} from '../utils/cache.utils.js';

/**
 * Validate a string as a valid MongoDB ObjectId.
 * Returns a clean 400 error instead of letting Mongoose throw a raw CastError.
 */
const assertValidId = (id, res) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({
      success: false,
      message: 'Invalid property ID format',
    });
    return false;
  }
  return true;
};

/**
 * Safe owner fields to populate when exposing property creator info.
 * Never expose password, tokens, or internal auth fields.
 */
const OWNER_PUBLIC_FIELDS = 'name email avatar phone';

// ──────────────────────────────────────────────────────────────────────
// 1. CREATE PROPERTY
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Create a new property listing
 * @route   POST /api/v1/properties
 * @access  Private
 */
export const createProperty = async (req, res, next) => {
  try {
    // Ownership is ALWAYS derived from the authenticated user — never from the client
    const propertyData = {
      ...req.body,
      createdBy: req.user.id,
    };

    const property = await Property.create(propertyData);

    // Invalidate discovery caches since a new property is available
    await invalidatePropertyDiscoveryCaches();

    return res.status(201).json({
      success: true,
      message: 'Property created successfully',
      data: property,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 2. GET ALL PROPERTIES (public discovery with search/filter/pagination)
// ──────────────────────────────────────────────────────────────────────

/**
 * Escape special regex characters to prevent regex injection from user input
 */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @desc    Discover properties with search, filters, pagination, sorting
 * @route   GET /api/v1/properties
 * @access  Public
 */
export const getProperties = async (req, res, next) => {
  try {
    // ── 0. Check Redis Cache First ─────────────────────────────────
    const cacheKey = generateDiscoveryCacheKey(req.query);
    const cachedResponse = await getCachedData(cacheKey);

    if (cachedResponse) {
      return res.status(200).json(cachedResponse);
    }
    const {
      search,
      city,
      state,
      minRent,
      maxRent,
      propertyType,
      minBedrooms,
      maxBedrooms,
      amenities,
      availableFrom,
      status,
      page,
      limit,
      sortBy,
      sortOrder,
    } = req.query;

    // ── 1. Build the MongoDB filter ────────────────────────────────

    const filter = {};

    // Default to AVAILABLE if status not explicitly provided
    filter.status = status || 'AVAILABLE';

    // Keyword search across meaningful fields
    if (search) {
      const escaped = escapeRegex(search);
      const searchRegex = new RegExp(escaped, 'i');
      filter.$or = [
        { title: searchRegex },
        { description: searchRegex },
        { 'location.address': searchRegex },
        { 'location.city': searchRegex },
        { 'location.state': searchRegex },
        { 'location.pincode': searchRegex },
      ];
    }

    // Location filters (case-insensitive exact match)
    if (city) {
      filter['location.city'] = new RegExp(`^${escapeRegex(city)}$`, 'i');
    }
    if (state) {
      filter['location.state'] = new RegExp(`^${escapeRegex(state)}$`, 'i');
    }

    // Rent range
    if (minRent !== undefined || maxRent !== undefined) {
      filter.rent = {};
      if (minRent !== undefined) filter.rent.$gte = minRent;
      if (maxRent !== undefined) filter.rent.$lte = maxRent;
    }

    // Property type
    if (propertyType) {
      filter.propertyType = propertyType;
    }

    // Bedroom range
    if (minBedrooms !== undefined || maxBedrooms !== undefined) {
      filter.bedrooms = {};
      if (minBedrooms !== undefined) filter.bedrooms.$gte = minBedrooms;
      if (maxBedrooms !== undefined) filter.bedrooms.$lte = maxBedrooms;
    }

    // Amenities — match properties that contain ALL requested amenities
    if (amenities) {
      const amenityList = amenities
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      if (amenityList.length > 0) {
        filter.amenities = { $all: amenityList };
      }
    }

    // Available from — find properties available on or before the requested date
    if (availableFrom) {
      filter.availableFrom = { $lte: availableFrom };
    }

    // ── 2. Sorting ─────────────────────────────────────────────────

    const sortObj = {};
    sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // ── 3. Pagination ──────────────────────────────────────────────

    const skip = (page - 1) * limit;

    // ── 4. Execute query + count in parallel ───────────────────────

    const [properties, total] = await Promise.all([
      Property.find(filter)
        .populate('createdBy', OWNER_PUBLIC_FIELDS)
        .sort(sortObj)
        .skip(skip)
        .limit(limit)
        .lean(),
      Property.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit);

    const responsePayload = {
      success: true,
      count: properties.length,
      data: properties,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };

    // ── Store in Redis before sending to client ───────────────────────
    await setCachedData(cacheKey, responsePayload);

    return res.status(200).json(responsePayload);
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 3. GET DISCOVERY SUMMARY (Aggregation)
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Get aggregated discovery statistics (count, by type, by city, rent stats)
 * @route   GET /api/v1/properties/discovery/summary
 * @access  Public
 */
export const getPropertyDiscoverySummary = async (req, res, next) => {
  try {
    // Only extract the subset of filters that make sense for the summary
    const { city, propertyType, minRent, maxRent } = req.query;

    // 1. Build the $match stage (similar to getProperties but strictly for discovery summary)
    const matchStage = { status: 'AVAILABLE' };

    if (city) {
      matchStage['location.city'] = new RegExp(`^${escapeRegex(city)}$`, 'i');
    }
    
    if (propertyType) {
      matchStage.propertyType = propertyType;
    }
    
    if (minRent !== undefined || maxRent !== undefined) {
      matchStage.rent = {};
      if (minRent !== undefined) matchStage.rent.$gte = minRent;
      if (maxRent !== undefined) matchStage.rent.$lte = maxRent;
    }

    // 2. Execute the aggregation pipeline
    // Uses $facet to run multiple independent aggregations on the same set of matched properties.
    const result = await Property.aggregate([
      { $match: matchStage }, // Filter documents first to reduce the dataset size
      {
        $facet: {
          // Total matching distinct properties
          totalProperties: [{ $count: 'count' }],
          
          // Group by property type (e.g., APARTMENT -> 25)
          byPropertyType: [
            { $group: { _id: '$propertyType', count: { $sum: 1 } } },
            { $project: { _id: 0, propertyType: '$_id', count: 1 } },
            { $sort: { count: -1 } }
          ],
          
          // Group by city
          byCity: [
            { $group: { _id: '$location.city', count: { $sum: 1 } } },
            { $project: { _id: 0, city: '$_id', count: 1 } },
            { $sort: { count: -1 } } // Highest count first
          ],
          
          // Overall rent statistics for the matched properties
          rentStatistics: [
            {
              $group: {
                _id: null,
                averageRent: { $avg: '$rent' },
                minRent: { $min: '$rent' },
                maxRent: { $max: '$rent' }
              }
            },
            {
              $project: {
                _id: 0,
                // Round average to nearest int if needed, but let's keep it raw (or Math.round in app logic)
                averageRent: { $round: ['$averageRent', 0] },
                minRent: 1,
                maxRent: 1
              }
            }
          ]
        }
      }
    ]);

    // 3. Format result (MongoDB returns an array of one element for $facet)
    const aggregatedData = result[0];

    return res.status(200).json({
      success: true,
      data: {
        totalProperties: aggregatedData.totalProperties[0]?.count || 0,
        byPropertyType: aggregatedData.byPropertyType,
        byCity: aggregatedData.byCity,
        rentStatistics: aggregatedData.rentStatistics[0] || { averageRent: 0, minRent: 0, maxRent: 0 },
      }
    });

  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 4. GET SINGLE PROPERTY
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Get a single property by ID
 * @route   GET /api/v1/properties/:id
 * @access  Public
 */
export const getPropertyById = async (req, res, next) => {
  try {
    if (!assertValidId(req.params.id, res)) return;

    const property = await Property.findById(req.params.id)
      .populate('createdBy', OWNER_PUBLIC_FIELDS);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: property,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 4. UPDATE PROPERTY
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Update a property (owner only)
 * @route   PATCH /api/v1/properties/:id
 * @access  Private
 */
export const updateProperty = async (req, res, next) => {
  try {
    if (!assertValidId(req.params.id, res)) return;

    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    // Ownership check — only the creator can update
    if (property.createdBy.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to update this property',
      });
    }

    const updatedProperty = await Property.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      {
        new: true,            // Return the updated document
        runValidators: true,  // Enforce Mongoose schema validators
      }
    ).populate('createdBy', OWNER_PUBLIC_FIELDS);

    // Invalidate discovery caches since this property was updated
    await invalidatePropertyDiscoveryCaches();

    return res.status(200).json({
      success: true,
      message: 'Property updated successfully',
      data: updatedProperty,
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 5. DELETE PROPERTY
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Delete a property (owner only)
 * @route   DELETE /api/v1/properties/:id
 * @access  Private
 */
export const deleteProperty = async (req, res, next) => {
  try {
    if (!assertValidId(req.params.id, res)) return;

    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    // Ownership check — only the creator can delete
    if (property.createdBy.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to delete this property',
      });
    }

    await Property.findByIdAndDelete(req.params.id);

    // Invalidate discovery caches since this property was removed
    await invalidatePropertyDiscoveryCaches();

    return res.status(200).json({
      success: true,
      message: 'Property deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// ──────────────────────────────────────────────────────────────────────
// 6. GET MY PROPERTIES
// ──────────────────────────────────────────────────────────────────────

/**
 * @desc    Get all properties created by the authenticated user
 * @route   GET /api/v1/properties/my
 * @access  Private
 */
export const getMyProperties = async (req, res, next) => {
  try {
    const properties = await Property.find({ createdBy: req.user.id })
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: properties.length,
      data: properties,
    });
  } catch (error) {
    next(error);
  }
};
