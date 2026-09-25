/**
 * Recommendation Hard-Filter Candidate Selection — Unit Tests
 *
 * Tests the buildHardFilterQuery and getCandidateProperties functions
 * against all 10 required cases WITHOUT needing a running MongoDB instance.
 *
 * Run: node scripts/test-recommendation-filters.js
 */

import mongoose from 'mongoose';
import {
  buildHardFilterQuery,
} from '../src/utils/recommendation.utils.js';

// ── Helpers ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

const assert = (condition, testName) => {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    failed++;
  }
};

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Simulates Property.find(filter) against an in-memory array.
 * Supports: $ne, $lte, $in (strings and RegExp), exact match.
 */
const matchesFilter = (property, filter) => {
  for (const [key, condition] of Object.entries(filter)) {
    const value = getNestedValue(property, key);

    if (condition !== null && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof RegExp)) {
      // Operator object
      if (condition.$ne !== undefined) {
        if (String(value) === String(condition.$ne)) return false;
      }
      if (condition.$lte !== undefined) {
        if (value > condition.$lte) return false;
      }
      if (condition.$in !== undefined) {
        const matched = condition.$in.some((item) => {
          if (item instanceof RegExp) return item.test(value);
          return item === value;
        });
        if (!matched) return false;
      }
    } else {
      // Exact match
      if (value !== condition) return false;
    }
  }
  return true;
};

const getNestedValue = (obj, path) => {
  return path.split('.').reduce((current, key) => current?.[key], obj);
};

const findCandidates = (properties, filter) => {
  return properties.filter((p) => matchesFilter(p, filter));
};

// ── Test Data ────────────────────────────────────────────────────────

const USER_ID = '507f1f77bcf86cd799439011';
const OTHER_USER_ID = '507f1f77bcf86cd799439022';

const PROPERTIES = [
  {
    _id: '1',
    title: 'Sunny 2BHK in Indore',
    createdBy: OTHER_USER_ID,
    status: 'AVAILABLE',
    location: { city: 'Indore', state: 'MP', address: '123 Main St', pincode: '452001' },
    rent: 9000,
    propertyType: 'APARTMENT',
    bedrooms: 2,
    amenities: ['WiFi', 'Parking'],
    availableFrom: new Date('2026-10-01'),
  },
  {
    _id: '2',
    title: 'Villa in Mumbai',
    createdBy: OTHER_USER_ID,
    status: 'AVAILABLE',
    location: { city: 'Mumbai', state: 'MH', address: '456 Sea Rd', pincode: '400001' },
    rent: 25000,
    propertyType: 'VILLA',
    bedrooms: 4,
    amenities: ['WiFi', 'Pool', 'Gym'],
    availableFrom: new Date('2026-09-15'),
  },
  {
    _id: '3',
    title: 'PG in Indore',
    createdBy: OTHER_USER_ID,
    status: 'AVAILABLE',
    location: { city: 'Indore', state: 'MP', address: '789 College Rd', pincode: '452010' },
    rent: 5000,
    propertyType: 'PG',
    bedrooms: 1,
    amenities: [],
    availableFrom: new Date('2026-10-20'),
  },
  {
    _id: '4',
    title: 'Apartment in Bhopal',
    createdBy: OTHER_USER_ID,
    status: 'AVAILABLE',
    location: { city: 'Bhopal', state: 'MP', address: '321 Lake Rd', pincode: '462001' },
    rent: 12000,
    propertyType: 'APARTMENT',
    bedrooms: 3,
    amenities: ['WiFi', 'Parking', 'Gym'],
    availableFrom: new Date('2026-10-05'),
  },
  {
    _id: '5',
    title: 'My Own Property',
    createdBy: USER_ID, // owned by the requesting user
    status: 'AVAILABLE',
    location: { city: 'Indore', state: 'MP', address: '999 Owner St', pincode: '452001' },
    rent: 10000,
    propertyType: 'APARTMENT',
    bedrooms: 2,
    amenities: ['WiFi'],
    availableFrom: new Date('2026-10-01'),
  },
  {
    _id: '6',
    title: 'Rented House',
    createdBy: OTHER_USER_ID,
    status: 'RENTED', // not available
    location: { city: 'Indore', state: 'MP', address: '555 Old Rd', pincode: '452001' },
    rent: 8000,
    propertyType: 'HOUSE',
    bedrooms: 2,
    amenities: ['WiFi', 'Parking'],
    availableFrom: new Date('2026-09-01'),
  },
  {
    _id: '7',
    title: 'Expensive Apartment',
    createdBy: OTHER_USER_ID,
    status: 'AVAILABLE',
    location: { city: 'Indore', state: 'MP', address: '111 Posh Rd', pincode: '452001' },
    rent: 20000,
    propertyType: 'APARTMENT',
    bedrooms: 3,
    amenities: ['WiFi', 'Parking', 'Gym', 'Security', 'Pool'],
    availableFrom: new Date('2026-10-01'),
  },
  {
    _id: '8',
    title: 'Studio in Delhi',
    createdBy: OTHER_USER_ID,
    status: 'AVAILABLE',
    location: { city: 'Delhi', state: 'DL', address: '222 Metro Rd', pincode: '110001' },
    rent: 14000,
    propertyType: 'STUDIO',
    bedrooms: 0,
    amenities: ['WiFi', 'Security'],
    availableFrom: new Date('2026-11-01'),
  },
  {
    _id: '9',
    title: 'Unavailable PG',
    createdBy: OTHER_USER_ID,
    status: 'UNAVAILABLE',
    location: { city: 'Indore', state: 'MP', address: '333 Closed Rd', pincode: '452001' },
    rent: 4000,
    propertyType: 'PG',
    bedrooms: 1,
    amenities: [],
    availableFrom: new Date('2026-10-01'),
  },
  {
    _id: '10',
    title: 'Apartment in indore (lowercase)',
    createdBy: OTHER_USER_ID,
    status: 'AVAILABLE',
    location: { city: 'indore', state: 'MP', address: '444 Low St', pincode: '452002' }, // lowercase city
    rent: 11000,
    propertyType: 'APARTMENT',
    bedrooms: 2,
    amenities: ['Parking'],
    availableFrom: new Date('2026-10-10'),
  },
];

// ── Test Cases ───────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  RECOMMENDATION HARD-FILTER TESTS');
console.log('═══════════════════════════════════════════════════════════\n');

// ── CASE 1: Location filter — only Indore ────────────────────────────
console.log('CASE 1: preferredLocations = ["Indore"]');
{
  const prefs = { preferredLocations: ['Indore'], propertyTypes: [], requiredAmenities: [] };
  const filter = buildHardFilterQuery(USER_ID, prefs);
  const candidates = findCandidates(PROPERTIES, filter);

  // Should include: #1 (Indore), #3 (Indore PG), #7 (Indore expensive), #10 (indore lowercase)
  // Should exclude: #2 (Mumbai), #4 (Bhopal), #5 (own), #6 (rented), #8 (Delhi), #9 (unavailable)
  assert(candidates.some((p) => p._id === '1'), 'Includes Indore apartment');
  assert(candidates.some((p) => p._id === '3'), 'Includes Indore PG');
  assert(candidates.some((p) => p._id === '7'), 'Includes Indore expensive');
  assert(candidates.some((p) => p._id === '10'), 'Includes lowercase "indore" (case-insensitive)');
  assert(!candidates.some((p) => p._id === '2'), 'Excludes Mumbai property');
  assert(!candidates.some((p) => p._id === '4'), 'Excludes Bhopal property');
  assert(!candidates.some((p) => p._id === '5'), "Excludes user's own property");
  assert(!candidates.some((p) => p._id === '6'), 'Excludes RENTED property');
}

// ── CASE 2: maxRent = 15000 ──────────────────────────────────────────
console.log('\nCASE 2: maxRent = 15000');
{
  const prefs = { maxRent: 15000, preferredLocations: [], propertyTypes: [], requiredAmenities: [] };
  const filter = buildHardFilterQuery(USER_ID, prefs);
  const candidates = findCandidates(PROPERTIES, filter);

  assert(!candidates.some((p) => p._id === '2'), 'Excludes ₹25,000 Villa');
  assert(!candidates.some((p) => p._id === '7'), 'Excludes ₹20,000 Apartment');
  assert(candidates.some((p) => p._id === '1'), 'Includes ₹9,000 property');
  assert(candidates.some((p) => p._id === '3'), 'Includes ₹5,000 property');
  assert(candidates.some((p) => p._id === '4'), 'Includes ₹12,000 property');
  assert(candidates.some((p) => p._id === '8'), 'Includes ₹14,000 property');
}

// ── CASE 3: propertyTypes = ["APARTMENT"] ────────────────────────────
console.log('\nCASE 3: propertyTypes = ["APARTMENT"]');
{
  const prefs = { propertyTypes: ['APARTMENT'], preferredLocations: [], requiredAmenities: [] };
  const filter = buildHardFilterQuery(USER_ID, prefs);
  const candidates = findCandidates(PROPERTIES, filter);

  assert(!candidates.some((p) => p._id === '2'), 'Excludes VILLA');
  assert(!candidates.some((p) => p._id === '3'), 'Excludes PG');
  assert(!candidates.some((p) => p._id === '8'), 'Excludes STUDIO');
  assert(candidates.some((p) => p._id === '1'), 'Includes APARTMENT #1');
  assert(candidates.some((p) => p._id === '4'), 'Includes APARTMENT #4');
  assert(candidates.some((p) => p._id === '7'), 'Includes APARTMENT #7');
  assert(candidates.some((p) => p._id === '10'), 'Includes APARTMENT #10');
}

// ── CASE 4: Multiple preferred locations ─────────────────────────────
console.log('\nCASE 4: preferredLocations = ["Indore", "Bhopal"]');
{
  const prefs = { preferredLocations: ['Indore', 'Bhopal'], propertyTypes: [], requiredAmenities: [] };
  const filter = buildHardFilterQuery(USER_ID, prefs);
  const candidates = findCandidates(PROPERTIES, filter);

  assert(candidates.some((p) => p._id === '1'), 'Includes Indore property');
  assert(candidates.some((p) => p._id === '4'), 'Includes Bhopal property');
  assert(!candidates.some((p) => p._id === '2'), 'Excludes Mumbai property');
  assert(!candidates.some((p) => p._id === '8'), 'Excludes Delhi property');
}

// ── CASE 5: No preferred location ────────────────────────────────────
console.log('\nCASE 5: No preferred location (empty array)');
{
  const prefs = { preferredLocations: [], propertyTypes: [], requiredAmenities: [] };
  const filter = buildHardFilterQuery(USER_ID, prefs);

  assert(!filter['location.city'], 'No location filter in query');

  const candidates = findCandidates(PROPERTIES, filter);
  assert(candidates.some((p) => p._id === '1'), 'Includes Indore');
  assert(candidates.some((p) => p._id === '2'), 'Includes Mumbai');
  assert(candidates.some((p) => p._id === '4'), 'Includes Bhopal');
  assert(candidates.some((p) => p._id === '8'), 'Includes Delhi');
}

// ── CASE 6: No maxRent ───────────────────────────────────────────────
console.log('\nCASE 6: No maxRent defined');
{
  const prefs = { preferredLocations: [], propertyTypes: [], requiredAmenities: [] };
  const filter = buildHardFilterQuery(USER_ID, prefs);

  assert(!filter.rent, 'No rent filter in query');

  const candidates = findCandidates(PROPERTIES, filter);
  assert(candidates.some((p) => p._id === '2'), 'Includes ₹25,000 property (no cap)');
  assert(candidates.some((p) => p._id === '7'), 'Includes ₹20,000 property (no cap)');
}

// ── CASE 7: No property type preference ──────────────────────────────
console.log('\nCASE 7: No propertyTypes (empty array)');
{
  const prefs = { preferredLocations: [], propertyTypes: [], requiredAmenities: [] };
  const filter = buildHardFilterQuery(USER_ID, prefs);

  assert(!filter.propertyType, 'No propertyType filter in query');

  const candidates = findCandidates(PROPERTIES, filter);
  const types = [...new Set(candidates.map((p) => p.propertyType))];
  assert(types.length > 1, `Multiple types included: [${types.join(', ')}]`);
}

// ── CASE 8: User's own property excluded ─────────────────────────────
console.log('\nCASE 8: User owns a property');
{
  const prefs = { preferredLocations: ['Indore'], propertyTypes: [], requiredAmenities: [] };
  const filter = buildHardFilterQuery(USER_ID, prefs);
  const candidates = findCandidates(PROPERTIES, filter);

  assert(!candidates.some((p) => p._id === '5'), "User's own property (#5) excluded");
  assert(!candidates.some((p) => p.createdBy === USER_ID), 'No properties owned by user');
}

// ── CASE 9: Non-AVAILABLE properties excluded ────────────────────────
console.log('\nCASE 9: Non-AVAILABLE properties');
{
  const prefs = { preferredLocations: [], propertyTypes: [], requiredAmenities: [] };
  const filter = buildHardFilterQuery(USER_ID, prefs);
  const candidates = findCandidates(PROPERTIES, filter);

  assert(!candidates.some((p) => p._id === '6'), 'Excludes RENTED property (#6)');
  assert(!candidates.some((p) => p._id === '9'), 'Excludes UNAVAILABLE property (#9)');
  assert(candidates.every((p) => p.status === 'AVAILABLE'), 'All candidates are AVAILABLE');
}

// ── CASE 10: No properties match hard filters ────────────────────────
console.log('\nCASE 10: No matching properties');
{
  const prefs = {
    preferredLocations: ['NonExistentCity'],
    maxRent: 100, // impossibly low
    propertyTypes: ['VILLA'],
    requiredAmenities: [],
  };
  const filter = buildHardFilterQuery(USER_ID, prefs);
  const candidates = findCandidates(PROPERTIES, filter);

  assert(candidates.length === 0, 'Empty candidate list (not an error)');
  assert(Array.isArray(candidates), 'Returns an array (not null/undefined)');
}

// ── BONUS: Combined filters ──────────────────────────────────────────
console.log('\nBONUS: Combined — Indore + maxRent=15000 + APARTMENT');
{
  const prefs = {
    preferredLocations: ['Indore'],
    maxRent: 15000,
    propertyTypes: ['APARTMENT'],
    requiredAmenities: [],
  };
  const filter = buildHardFilterQuery(USER_ID, prefs);
  const candidates = findCandidates(PROPERTIES, filter);

  // Should include: #1 (Indore, ₹9000, APT), #10 (indore, ₹11000, APT)
  // Should exclude: #3 (PG), #5 (own), #6 (rented), #7 (₹20000), #2 (Mumbai), etc.
  assert(candidates.some((p) => p._id === '1'), 'Includes #1 — Indore, ₹9000, APARTMENT');
  assert(candidates.some((p) => p._id === '10'), 'Includes #10 — indore, ₹11000, APARTMENT');
  assert(!candidates.some((p) => p._id === '3'), 'Excludes #3 — PG type');
  assert(!candidates.some((p) => p._id === '7'), 'Excludes #7 — ₹20000 over budget');
  assert(!candidates.some((p) => p._id === '5'), "Excludes #5 — user's own");
  assert(candidates.length === 2, `Exactly 2 candidates (got ${candidates.length})`);
}

// ── Filter structure verification ────────────────────────────────────
console.log('\nFILTER STRUCTURE: Verify filter shape');
{
  const prefs = {
    preferredLocations: ['Indore','Bhopal'],
    maxRent: 15000,
    minRent: 5000, // should NOT appear in hard filter
    propertyTypes: ['APARTMENT', 'PG'],
    minBedrooms: 2, // should NOT appear
    maxBedrooms: 3, // should NOT appear
    requiredAmenities: ['WiFi'], // should NOT appear
    preferredAvailableFrom: new Date('2026-10-01'), // should NOT appear
  };
  const filter = buildHardFilterQuery(USER_ID, prefs);

  assert(filter.status === 'AVAILABLE', 'Always has status: AVAILABLE');
  assert(filter.createdBy?.$ne != null, 'Always has createdBy: { $ne }');
  assert(filter['location.city']?.$in?.length === 2, 'Has location.city $in with 2 entries');
  assert(filter.rent?.$lte === 15000, 'Has rent: { $lte: 15000 }');
  assert(deepEqual(filter.propertyType?.$in, ['APARTMENT', 'PG']), 'Has propertyType: { $in }');

  // MUST NOT have soft-filter fields
  assert(!filter.bedrooms, 'No bedrooms filter (soft criterion)');
  assert(!filter.amenities, 'No amenities filter (soft criterion)');
  assert(!filter.availableFrom, 'No availableFrom filter (soft criterion)');
  assert(!filter.minRent, 'No minRent filter (soft criterion)');
}

// ── Summary ──────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('═══════════════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
