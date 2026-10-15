/**
 * Recommendation API — Integration Test Script
 *
 * Temporarily seeds MongoDB with test users, properties, and preferences,
 * tests all 8 required cases against the live server, then cleans up.
 *
 * Prerequisites:
 *   1. MongoDB connected (server running)
 *   2. Server running on port 5000
 *
 * Run: node scripts/test-recommendation-api.js
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import http from 'http';

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'secret-access-key-replace-me';
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/rentmate';
const BASE_URL = 'http://localhost:5000';

// ── Helpers ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

const assert = (condition, label) => {
  if (condition) {
    console.log(`  ✅ PASS: ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${label}`);
    failed++;
  }
};

function makeRequest(path, token = null) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(
      `${BASE_URL}${path}`,
      { method: 'GET', headers },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function generateToken(userId) {
  return jwt.sign({ id: userId }, JWT_ACCESS_SECRET, { expiresIn: '10m' });
}

// ── Test Data ────────────────────────────────────────────────────────

const USER_A_ID = new mongoose.Types.ObjectId();  // user with prefs + properties to recommend
const USER_B_ID = new mongoose.Types.ObjectId();  // user without prefs
const USER_C_ID = new mongoose.Types.ObjectId();  // user whose prefs match nothing
const OWNER_ID  = new mongoose.Types.ObjectId();  // property owner

const testUsers = [
  { _id: USER_A_ID, name: 'User A', email: 'usera-rectest@test.com', password: 'hashed', isVerified: true },
  { _id: USER_B_ID, name: 'User B', email: 'userb-rectest@test.com', password: 'hashed', isVerified: true },
  { _id: USER_C_ID, name: 'User C', email: 'userc-rectest@test.com', password: 'hashed', isVerified: true },
  { _id: OWNER_ID,  name: 'Owner',  email: 'owner-rectest@test.com', password: 'hashed', isVerified: true },
];

const testProperties = [
  {
    title: 'Sunny 2BHK in Indore',
    createdBy: OWNER_ID,
    status: 'AVAILABLE',
    location: { city: 'Indore', state: 'MP', address: '123 Main St', pincode: '452001' },
    rent: 9000,
    propertyType: 'APARTMENT',
    bedrooms: 2,
    bathrooms: 1,
    amenities: ['WiFi', 'Parking'],
    availableFrom: new Date('2026-10-01'),
    description: 'Test property 1',
    images: [],
  },
  {
    title: 'PG in Indore',
    createdBy: OWNER_ID,
    status: 'AVAILABLE',
    location: { city: 'Indore', state: 'MP', address: '456 College Rd', pincode: '452010' },
    rent: 5000,
    propertyType: 'PG',
    bedrooms: 1,
    bathrooms: 1,
    amenities: ['WiFi'],
    availableFrom: new Date('2026-10-15'),
    description: 'Test property 2',
    images: [],
  },
  {
    title: 'Villa in Mumbai',
    createdBy: OWNER_ID,
    status: 'AVAILABLE',
    location: { city: 'Mumbai', state: 'MH', address: '789 Sea Rd', pincode: '400001' },
    rent: 25000,
    propertyType: 'VILLA',
    bedrooms: 4,
    bathrooms: 3,
    amenities: ['WiFi', 'Pool', 'Gym', 'Security'],
    availableFrom: new Date('2026-11-01'),
    description: 'Test property 3',
    images: [],
  },
  {
    // User A's OWN property — must NOT appear in their recommendations
    title: 'User A Own Property',
    createdBy: USER_A_ID,
    status: 'AVAILABLE',
    location: { city: 'Indore', state: 'MP', address: '999 Owner St', pincode: '452001' },
    rent: 10000,
    propertyType: 'APARTMENT',
    bedrooms: 2,
    bathrooms: 1,
    amenities: ['WiFi', 'Parking'],
    availableFrom: new Date('2026-10-01'),
    description: 'User A self-owned',
    images: [],
  },
  {
    // RENTED property — must NOT appear
    title: 'Rented Property',
    createdBy: OWNER_ID,
    status: 'RENTED',
    location: { city: 'Indore', state: 'MP', address: '555 Old Rd', pincode: '452001' },
    rent: 8000,
    propertyType: 'APARTMENT',
    bedrooms: 2,
    bathrooms: 1,
    amenities: ['WiFi'],
    availableFrom: new Date('2026-09-01'),
    description: 'Already rented',
    images: [],
  },
];

const testPreferences = [
  {
    user: USER_A_ID,
    preferredLocations: ['Indore'],
    minRent: 5000,
    maxRent: 15000,
    propertyTypes: ['APARTMENT', 'PG'],
    minBedrooms: 1,
    maxBedrooms: 3,
    requiredAmenities: ['WiFi', 'Parking'],
    preferredAvailableFrom: new Date('2026-10-15'),
  },
  {
    // User C: prefs that match nothing
    user: USER_C_ID,
    preferredLocations: ['NonExistentCity'],
    maxRent: 100,
    propertyTypes: ['VILLA'],
  },
];

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  RECOMMENDATION API — INTEGRATION TESTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── Connect to MongoDB ─────────────────────────────────────────────
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB\n');

  const db = mongoose.connection.db;
  const usersCol = db.collection('users');
  const propsCol = db.collection('properties');
  const prefsCol = db.collection('propertypreferences');

  try {
    // ── Seed test data ─────────────────────────────────────────────────
    await usersCol.insertMany(testUsers);
    await propsCol.insertMany(testProperties);
    await prefsCol.insertMany(testPreferences);
    console.log('Test data seeded\n');

    // ── Generate tokens ────────────────────────────────────────────────
    const tokenA = generateToken(USER_A_ID.toString());
    const tokenB = generateToken(USER_B_ID.toString());
    const tokenC = generateToken(USER_C_ID.toString());

    // ── CASE 1: Authenticated user with valid preferences ────────────
    console.log('CASE 1: Authenticated user with valid preferences');
    {
      const res = await makeRequest('/api/v1/recommendations/properties', tokenA);
      assert(res.status === 200, `Status 200 (got ${res.status})`);
      assert(res.body.success === true, 'success: true');
      assert(Array.isArray(res.body.data?.recommendations), 'data.recommendations is array');
      assert(res.body.data.recommendations.length > 0, `Has recommendations (got ${res.body.data?.recommendations?.length})`);
      console.log(`  → ${res.body.data?.recommendations?.length} recommendations returned`);
    }

    // ── CASE 2: Authenticated user with no preferences ───────────────
    console.log('\nCASE 2: Authenticated user with NO preferences');
    {
      const res = await makeRequest('/api/v1/recommendations/properties', tokenB);
      assert(res.status === 404, `Status 404 (got ${res.status})`);
      assert(res.body.success === false, 'success: false');
      assert(res.body.message?.toLowerCase().includes('preference'), `Message mentions preferences: "${res.body.message}"`);
    }

    // ── CASE 3: Unauthenticated request ──────────────────────────────
    console.log('\nCASE 3: Unauthenticated request');
    {
      const res = await makeRequest('/api/v1/recommendations/properties');
      assert(res.status === 401, `Status 401 (got ${res.status})`);
      assert(res.body.success === false, 'success: false');
    }

    // ── CASE 4: No properties satisfy hard filters ───────────────────
    console.log('\nCASE 4: No properties match hard filters');
    {
      const res = await makeRequest('/api/v1/recommendations/properties', tokenC);
      assert(res.status === 200, `Status 200 (got ${res.status})`);
      assert(res.body.success === true, 'success: true');
      assert(Array.isArray(res.body.data?.recommendations), 'data.recommendations is array');
      assert(res.body.data.recommendations.length === 0, `Empty recommendations (got ${res.body.data?.recommendations?.length})`);
    }

    // ── CASE 5: User's own properties must NOT appear ────────────────
    console.log("\nCASE 5: User's own properties excluded");
    {
      const res = await makeRequest('/api/v1/recommendations/properties', tokenA);
      const recs = res.body.data?.recommendations || [];
      const ownProps = recs.filter((r) => r.createdBy?._id?.toString() === USER_A_ID.toString());
      assert(ownProps.length === 0, `No self-owned properties in results (found ${ownProps.length})`);

      // Verify the "User A Own Property" is NOT in results
      const selfTitle = recs.find((r) => r.title === 'User A Own Property');
      assert(!selfTitle, '"User A Own Property" not in recommendations');
    }

    // ── CASE 6: Every property has valid compatibilityScore ──────────
    console.log('\nCASE 6: Score validity [0, 100]');
    {
      const res = await makeRequest('/api/v1/recommendations/properties', tokenA);
      const recs = res.body.data?.recommendations || [];
      assert(
        recs.every((r) => typeof r.compatibilityScore === 'number'),
        'All have numeric compatibilityScore'
      );
      assert(
        recs.every((r) => r.compatibilityScore >= 0 && r.compatibilityScore <= 100),
        'All scores in [0, 100]'
      );
      recs.forEach((r) => console.log(`    ${r.title}: ${r.compatibilityScore}`));
    }

    // ── CASE 7: Verify scoreBreakdown structure ──────────────────────
    console.log('\nCASE 7: scoreBreakdown structure');
    {
      const res = await makeRequest('/api/v1/recommendations/properties', tokenA);
      const recs = res.body.data?.recommendations || [];
      const requiredKeys = ['location', 'rent', 'propertyType', 'bedrooms', 'amenities', 'availability'];

      assert(recs.every((r) => r.scoreBreakdown != null), 'All have scoreBreakdown');
      assert(
        recs.every((r) => requiredKeys.every((k) => typeof r.scoreBreakdown?.[k] === 'number')),
        'All breakdown keys are numeric'
      );
      if (recs.length > 0) {
        console.log(`    Sample breakdown:`, recs[0].scoreBreakdown);
      }
    }

    // ── CASE 8: Cannot access another user's preferences ─────────────
    console.log("\nCASE 8: User B cannot get User A's recommendations");
    {
      // User B has no preferences → should get 404 (their OWN prefs don't exist)
      // This proves User B cannot access User A's prefs through this endpoint.
      const res = await makeRequest('/api/v1/recommendations/properties', tokenB);
      assert(res.status === 404, `User B gets 404 (no own prefs), not User A's recs`);
      assert(res.body.success === false, 'success: false — not returning foreign data');
    }

    // ── BONUS: Verify RENTED property excluded ───────────────────────
    console.log('\nBONUS: RENTED property not in results');
    {
      const res = await makeRequest('/api/v1/recommendations/properties', tokenA);
      const recs = res.body.data?.recommendations || [];
      const rented = recs.find((r) => r.title === 'Rented Property');
      assert(!rented, '"Rented Property" (status=RENTED) excluded');
    }

    // ── BONUS: Verify count field in response ────────────────────────
    console.log('\nBONUS: Response count field');
    {
      const res = await makeRequest('/api/v1/recommendations/properties', tokenA);
      assert(
        res.body.count === res.body.data?.recommendations?.length,
        `count=${res.body.count} matches recommendations.length=${res.body.data?.recommendations?.length}`
      );
    }

  } finally {
    // ── Cleanup test data ──────────────────────────────────────────────
    const testUserIds = testUsers.map((u) => u._id);
    await usersCol.deleteMany({ _id: { $in: testUserIds } });
    await propsCol.deleteMany({ createdBy: { $in: [OWNER_ID, USER_A_ID] } });
    await prefsCol.deleteMany({ user: { $in: [USER_A_ID, USER_C_ID] } });
    console.log('\nTest data cleaned up');
  }

  await mongoose.disconnect();

  // ── Summary ──────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═══════════════════════════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
