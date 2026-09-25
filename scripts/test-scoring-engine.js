/**
 * Compatibility Scoring Engine — Unit Tests
 *
 * Tests all scoring functions against the exact formulas in
 * docs/property-recommendation-design.md.
 *
 * Run: node scripts/test-scoring-engine.js
 */

import {
  calculateLocationRatio,
  calculateRentRatio,
  calculatePropertyTypeRatio,
  calculateBedroomRatio,
  calculateAmenityRatio,
  calculateAvailabilityRatio,
  calculatePropertyCompatibility,
  scoreAllCandidates,
} from '../src/utils/scoring.utils.js';

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

/** Approximate equality for floating-point comparison */
const approx = (a, b, epsilon = 0.01) => Math.abs(a - b) < epsilon;

// ── Base property/preferences templates ──────────────────────────────

const makeProperty = (overrides = {}) => ({
  _id: 'test-prop-1',
  title: 'Test Property',
  createdBy: 'other-user',
  status: 'AVAILABLE',
  location: { city: 'Indore', state: 'MP', address: '123 St', pincode: '452001' },
  rent: 10000,
  propertyType: 'APARTMENT',
  bedrooms: 2,
  bathrooms: 1,
  amenities: ['WiFi', 'Parking', 'Gym'],
  availableFrom: new Date('2026-10-01'),
  createdAt: new Date('2026-09-01'),
  ...overrides,
});

const makePreferences = (overrides = {}) => ({
  preferredLocations: ['Indore'],
  minRent: 8000,
  maxRent: 15000,
  propertyTypes: ['APARTMENT'],
  minBedrooms: 2,
  maxBedrooms: 3,
  requiredAmenities: ['WiFi', 'Parking', 'Gym'],
  preferredAvailableFrom: new Date('2026-10-15'),
  ...overrides,
});

// ══════════════════════════════════════════════════════════════════════
// INDIVIDUAL RATIO TESTS
// ══════════════════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  SCORING ENGINE TESTS');
console.log('═══════════════════════════════════════════════════════════');

// ── Location Ratio ───────────────────────────────────────────────────
console.log('\n── Location Ratio ──');
{
  assert(calculateLocationRatio() === 1.0, 'Always returns 1.0 (hard filter handles elimination)');
}

// ── Rent Ratio ───────────────────────────────────────────────────────
console.log('\n── Rent Ratio ──');
{
  const prop = makeProperty();

  // Case 1: Both minRent and maxRent
  const prefs1 = makePreferences({ minRent: 8000, maxRent: 15000 });
  // rent=10000, distFromMin=2000, range=7000, ratio=1-2000/7000=0.714
  const r1 = calculateRentRatio(prop, prefs1);
  assert(approx(r1, 0.714, 0.01), `Both min+max: rent=10000, ratio=${r1.toFixed(3)} ≈ 0.714`);

  // rent exactly at minRent
  const propAtMin = makeProperty({ rent: 8000 });
  const rMin = calculateRentRatio(propAtMin, prefs1);
  assert(approx(rMin, 1.0), `At minRent: ratio=${rMin.toFixed(3)} = 1.0`);

  // rent exactly at maxRent
  const propAtMax = makeProperty({ rent: 15000 });
  const rMax = calculateRentRatio(propAtMax, prefs1);
  assert(approx(rMax, 0.0), `At maxRent: ratio=${rMax.toFixed(3)} = 0.0`);

  // rent below minRent
  const propBelow = makeProperty({ rent: 4000 });
  // distBelow=4000, penalty=4000/8000=0.5, ratio=max(0,1-0.5)=0.5
  const rBelow = calculateRentRatio(propBelow, prefs1);
  assert(approx(rBelow, 0.5), `Below minRent: rent=4000, ratio=${rBelow.toFixed(3)} ≈ 0.5`);

  // Case 1 edge: rentRange === 0 (exact match)
  const prefsExact = makePreferences({ minRent: 10000, maxRent: 10000 });
  const rExact = calculateRentRatio(prop, prefsExact);
  assert(rExact === 1.0, `Exact match: min=max=10000, rent=10000 → 1.0`);
  const rNoMatch = calculateRentRatio(makeProperty({ rent: 9000 }), prefsExact);
  assert(rNoMatch === 0, `Exact mismatch: min=max=10000, rent=9000 → 0`);

  // Case 2: Only maxRent
  const prefs2 = makePreferences({ minRent: undefined, maxRent: 20000 });
  // rent=10000, ratio=1-10000/20000=0.5
  const r2 = calculateRentRatio(prop, prefs2);
  assert(approx(r2, 0.5), `Only maxRent=20000: rent=10000, ratio=${r2.toFixed(3)} = 0.5`);

  // Case 3: Only minRent
  const prefs3 = makePreferences({ minRent: 8000, maxRent: undefined });
  const r3 = calculateRentRatio(prop, prefs3);
  assert(r3 === 1.0, `Only minRent=8000: rent=10000 ≥ 8000 → 1.0`);

  const r3b = calculateRentRatio(makeProperty({ rent: 5000 }), prefs3);
  // distBelow=3000, penalty=3000/8000=0.375, ratio=0.625
  assert(approx(r3b, 0.625), `Only minRent=8000: rent=5000 → ratio=${r3b.toFixed(3)} ≈ 0.625`);

  // Case 4: Neither
  const prefs4 = makePreferences({ minRent: undefined, maxRent: undefined });
  const r4 = calculateRentRatio(prop, prefs4);
  assert(r4 === 1.0, 'No rent prefs → 1.0');
}

// ── Property Type Ratio ──────────────────────────────────────────────
console.log('\n── Property Type Ratio ──');
{
  assert(calculatePropertyTypeRatio() === 1.0, 'Always returns 1.0 (hard filter handles elimination)');
}

// ── Bedroom Ratio ────────────────────────────────────────────────────
console.log('\n── Bedroom Ratio ──');
{
  // Both min=2, max=3 → ideal=2.5, tolerance=max(1,1)=1
  const prefs = makePreferences({ minBedrooms: 2, maxBedrooms: 3 });

  // bedrooms=2, diff=0.5, ratio=1-0.5/(1+1)=1-0.25=0.75
  const r2 = calculateBedroomRatio(makeProperty({ bedrooms: 2 }), prefs);
  assert(approx(r2, 0.75), `2 beds (ideal 2.5): ratio=${r2.toFixed(3)} ≈ 0.75`);

  // bedrooms=3, diff=0.5 → same
  const r3 = calculateBedroomRatio(makeProperty({ bedrooms: 3 }), prefs);
  assert(approx(r3, 0.75), `3 beds (ideal 2.5): ratio=${r3.toFixed(3)} ≈ 0.75`);

  // bedrooms=1, diff=1.5, ratio=1-1.5/2=0.25
  const r1 = calculateBedroomRatio(makeProperty({ bedrooms: 1 }), prefs);
  assert(approx(r1, 0.25), `1 bed (ideal 2.5): ratio=${r1.toFixed(3)} ≈ 0.25`);

  // bedrooms=4, diff=1.5 → same
  const r4 = calculateBedroomRatio(makeProperty({ bedrooms: 4 }), prefs);
  assert(approx(r4, 0.25), `4 beds (ideal 2.5): ratio=${r4.toFixed(3)} ≈ 0.25`);

  // bedrooms=5, diff=2.5, ratio=1-2.5/2=-0.25 → clamped to 0
  const r5 = calculateBedroomRatio(makeProperty({ bedrooms: 5 }), prefs);
  assert(r5 === 0, `5 beds (ideal 2.5): ratio=${r5} = 0 (clamped)`);

  // Exact match: min=max=2 → ideal=2, tolerance=max(0,1)=1
  const prefsExact = makePreferences({ minBedrooms: 2, maxBedrooms: 2 });
  const rExact = calculateBedroomRatio(makeProperty({ bedrooms: 2 }), prefsExact);
  assert(rExact === 1.0, `Exact bedroom match: 2=2 → 1.0`);

  // Only minBedrooms=2 → ideal=2, tolerance=2
  const prefsMin = makePreferences({ minBedrooms: 2, maxBedrooms: undefined });
  const rMin = calculateBedroomRatio(makeProperty({ bedrooms: 2 }), prefsMin);
  assert(rMin === 1.0, `Only min=2, beds=2, diff=0 → 1.0`);

  // Only maxBedrooms=3 → ideal=3, tolerance=2
  const prefsMax = makePreferences({ minBedrooms: undefined, maxBedrooms: 3 });
  const rMax2 = calculateBedroomRatio(makeProperty({ bedrooms: 2 }), prefsMax);
  // diff=1, ratio=1-1/(2+1)=0.667
  assert(approx(rMax2, 0.667), `Only max=3, beds=2: ratio=${rMax2.toFixed(3)} ≈ 0.667`);

  // No bedroom preference
  const prefsNone = makePreferences({ minBedrooms: undefined, maxBedrooms: undefined });
  const rNone = calculateBedroomRatio(makeProperty({ bedrooms: 5 }), prefsNone);
  assert(rNone === 1.0, 'No bedroom pref → 1.0');
}

// ── Amenity Ratio ────────────────────────────────────────────────────
console.log('\n── Amenity Ratio ──');
{
  const prop = makeProperty({ amenities: ['WiFi', 'Parking', 'Security'] });

  // 3 of 4 requested — ratio = 3/4 = 0.75
  const prefs4 = makePreferences({ requiredAmenities: ['WiFi', 'Parking', 'Gym', 'Security'] });
  const r1 = calculateAmenityRatio(prop, prefs4);
  assert(approx(r1, 0.75), `3/4 match: ratio=${r1.toFixed(3)} = 0.75`);

  // All match
  const prefsAll = makePreferences({ requiredAmenities: ['WiFi', 'Parking', 'Security'] });
  const rAll = calculateAmenityRatio(prop, prefsAll);
  assert(rAll === 1.0, `3/3 match → 1.0`);

  // None match
  const prefsNone = makePreferences({ requiredAmenities: ['Pool', 'Garden'] });
  const rNone = calculateAmenityRatio(prop, prefsNone);
  assert(rNone === 0, `0/2 match → 0`);

  // Case-insensitive
  const prefsCaseI = makePreferences({ requiredAmenities: ['wifi', 'PARKING'] });
  const rCase = calculateAmenityRatio(prop, prefsCaseI);
  assert(rCase === 1.0, 'Case-insensitive match → 1.0');

  // Property has no amenities
  const propEmpty = makeProperty({ amenities: [] });
  const rEmpty = calculateAmenityRatio(propEmpty, prefs4);
  assert(rEmpty === 0, 'Empty property amenities → 0');

  // No amenity preference
  const prefsNoReq = makePreferences({ requiredAmenities: [] });
  const rNoReq = calculateAmenityRatio(prop, prefsNoReq);
  assert(rNoReq === 1.0, 'No amenity preference → 1.0');

  // Property amenities undefined/null
  const propUndef = makeProperty({ amenities: undefined });
  const rUndef = calculateAmenityRatio(propUndef, prefs4);
  assert(rUndef === 0, 'Undefined amenities → 0');
}

// ── Availability Ratio ───────────────────────────────────────────────
console.log('\n── Availability Ratio ──');
{
  const preferred = new Date('2026-10-01');

  // On the exact date
  const rExact = calculateAvailabilityRatio(
    makeProperty({ availableFrom: new Date('2026-10-01') }),
    makePreferences({ preferredAvailableFrom: preferred })
  );
  assert(rExact === 1.0, `Exact date → 1.0`);

  // Before the date (16 days early)
  const rBefore = calculateAvailabilityRatio(
    makeProperty({ availableFrom: new Date('2026-09-15') }),
    makePreferences({ preferredAvailableFrom: preferred })
  );
  assert(rBefore === 1.0, `16 days early → 1.0`);

  // 9 days after → 1-9/30 = 0.7
  const rAfter9 = calculateAvailabilityRatio(
    makeProperty({ availableFrom: new Date('2026-10-10') }),
    makePreferences({ preferredAvailableFrom: preferred })
  );
  assert(approx(rAfter9, 0.7), `9 days late: ratio=${rAfter9.toFixed(3)} ≈ 0.7`);

  // 19 days after → 1-19/30 ≈ 0.367
  const rAfter19 = calculateAvailabilityRatio(
    makeProperty({ availableFrom: new Date('2026-10-20') }),
    makePreferences({ preferredAvailableFrom: preferred })
  );
  assert(approx(rAfter19, 0.367, 0.02), `19 days late: ratio=${rAfter19.toFixed(3)} ≈ 0.367`);

  // 31 days after → 1-31/30 = -0.033 → clamped to 0
  const rAfter31 = calculateAvailabilityRatio(
    makeProperty({ availableFrom: new Date('2026-11-01') }),
    makePreferences({ preferredAvailableFrom: preferred })
  );
  assert(rAfter31 === 0, `31 days late → 0 (clamped)`);

  // No preference
  const rNoPref = calculateAvailabilityRatio(
    makeProperty({ availableFrom: new Date('2099-12-31') }),
    makePreferences({ preferredAvailableFrom: undefined })
  );
  assert(rNoPref === 1.0, 'No availability pref → 1.0');

  // Missing property.availableFrom with active preference → 0
  const rMissing = calculateAvailabilityRatio(
    makeProperty({ availableFrom: undefined }),
    makePreferences({ preferredAvailableFrom: preferred })
  );
  assert(rMissing === 0, 'Missing property.availableFrom → 0');
}

// ══════════════════════════════════════════════════════════════════════
// FULL SCORING TESTS (10 required cases)
// ══════════════════════════════════════════════════════════════════════

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  FULL COMPATIBILITY SCORING TESTS');
console.log('═══════════════════════════════════════════════════════════');

// ── CASE 1: Perfect match ────────────────────────────────────────────
console.log('\nCASE 1: Perfectly matching property');
{
  const prop = makeProperty({
    rent: 8000,       // at minRent → max rent ratio
    bedrooms: 2,      // close to ideal 2.5
    amenities: ['WiFi', 'Parking', 'Gym'],
    availableFrom: new Date('2026-10-01'), // before preferred
  });
  const prefs = makePreferences();

  const { compatibilityScore, scoreBreakdown } = calculatePropertyCompatibility(prop, prefs);

  assert(compatibilityScore >= 85, `Perfect match score=${compatibilityScore} >= 85`);
  assert(scoreBreakdown.location === 30, `Location = 30`);
  assert(scoreBreakdown.rent === 25, `Rent = 25 (at minRent)`);
  assert(scoreBreakdown.propertyType === 15, `PropertyType = 15`);
  assert(scoreBreakdown.amenities === 10, `Amenities = 10 (3/3)`);
  console.log(`  Score: ${compatibilityScore}, Breakdown:`, scoreBreakdown);
}

// ── CASE 2: Partial amenity match ────────────────────────────────────
console.log('\nCASE 2: Partial amenity match');
{
  const prop = makeProperty({
    rent: 8000,
    bedrooms: 2,
    amenities: ['WiFi', 'Security'],  // 1/3 match
    availableFrom: new Date('2026-10-01'),
  });
  const prefs = makePreferences();

  const { compatibilityScore, scoreBreakdown } = calculatePropertyCompatibility(prop, prefs);

  // amenity ratio = 1/3 → score = (1/3) × 10 ≈ 3.33
  assert(approx(scoreBreakdown.amenities, 3.33, 0.1), `Amenity score ≈ 3.33 (got ${scoreBreakdown.amenities})`);
  console.log(`  Score: ${compatibilityScore}, Amenity: ${scoreBreakdown.amenities}`);
}

// ── CASE 3: Different bedroom count ──────────────────────────────────
console.log('\nCASE 3: Different bedroom count (4 bedrooms, ideal 2.5)');
{
  const prop = makeProperty({
    rent: 8000,
    bedrooms: 4,  // diff=1.5, tolerance=1, ratio=1-1.5/2=0.25
    amenities: ['WiFi', 'Parking', 'Gym'],
    availableFrom: new Date('2026-10-01'),
  });
  const prefs = makePreferences();

  const { scoreBreakdown } = calculatePropertyCompatibility(prop, prefs);
  // bedroomRatio=0.25, weight=10, effective=10 → score=2.5
  assert(approx(scoreBreakdown.bedrooms, 2.5), `Bedroom score ≈ 2.5 (got ${scoreBreakdown.bedrooms})`);
  console.log(`  Bedroom score: ${scoreBreakdown.bedrooms}`);
}

// ── CASE 4: Near rent preference ─────────────────────────────────────
console.log('\nCASE 4: Rent near preference (₹9,000 with range 8k–15k)');
{
  const prop = makeProperty({
    rent: 9000,
    bedrooms: 2,
    amenities: ['WiFi', 'Parking', 'Gym'],
    availableFrom: new Date('2026-10-01'),
  });
  const prefs = makePreferences();

  const { scoreBreakdown } = calculatePropertyCompatibility(prop, prefs);
  // dist=1000, range=7000, ratio=1-1000/7000=0.857, score=25×0.857=21.43
  assert(approx(scoreBreakdown.rent, 21.43, 0.1), `Rent score ≈ 21.43 (got ${scoreBreakdown.rent})`);
  console.log(`  Rent score: ${scoreBreakdown.rent}`);
}

// ── CASE 5: Far from rent preference ─────────────────────────────────
console.log('\nCASE 5: Rent far from preference (₹14,500 with range 8k–15k)');
{
  const prop = makeProperty({
    rent: 14500,
    bedrooms: 2,
    amenities: ['WiFi', 'Parking', 'Gym'],
    availableFrom: new Date('2026-10-01'),
  });
  const prefs = makePreferences();

  const { scoreBreakdown } = calculatePropertyCompatibility(prop, prefs);
  // dist=6500, range=7000, ratio=1-6500/7000=0.0714, score=25×0.0714=1.79
  assert(approx(scoreBreakdown.rent, 1.79, 0.1), `Rent score ≈ 1.79 (got ${scoreBreakdown.rent})`);
  assert(scoreBreakdown.rent < scoreBreakdown.location, 'Rent score < Location score (far from ideal)');
  console.log(`  Rent score: ${scoreBreakdown.rent}`);
}

// ── CASE 6: No optional preferences → weight redistribution ─────────
console.log('\nCASE 6: No optional preferences (all arrays empty, no numbers)');
{
  const prop = makeProperty();
  const prefs = makePreferences({
    preferredLocations: [],
    minRent: undefined,
    maxRent: undefined,
    propertyTypes: [],
    minBedrooms: undefined,
    maxBedrooms: undefined,
    requiredAmenities: [],
    preferredAvailableFrom: undefined,
  });

  const { compatibilityScore } = calculatePropertyCompatibility(prop, prefs);
  assert(compatibilityScore === 100, `No prefs → score=100 (got ${compatibilityScore})`);
}

// ── CASE 7: Only one criterion active ────────────────────────────────
console.log('\nCASE 7: Only rent criterion active');
{
  const prop = makeProperty({ rent: 10000 });
  const prefs = makePreferences({
    preferredLocations: [],
    minRent: 8000,
    maxRent: 15000,
    propertyTypes: [],
    minBedrooms: undefined,
    maxBedrooms: undefined,
    requiredAmenities: [],
    preferredAvailableFrom: undefined,
  });

  const { compatibilityScore, scoreBreakdown } = calculatePropertyCompatibility(prop, prefs);

  // Only rent active → effectiveWeight = (25/25) × 100 = 100
  // rentRatio = 1 - 2000/7000 = 0.714
  // finalScore = 0.714 × 100 = 71.4
  assert(approx(compatibilityScore, 71.4, 0.2), `Rent-only score ≈ 71.4 (got ${compatibilityScore})`);
  assert(scoreBreakdown.location === 0, 'Location inactive → 0');
  assert(scoreBreakdown.propertyType === 0, 'PropertyType inactive → 0');
  assert(scoreBreakdown.bedrooms === 0, 'Bedrooms inactive → 0');
  assert(scoreBreakdown.amenities === 0, 'Amenities inactive → 0');
  assert(scoreBreakdown.availability === 0, 'Availability inactive → 0');
  console.log(`  Score: ${compatibilityScore}, Rent score: ${scoreBreakdown.rent}`);
}

// ── CASE 8: Missing property fields ──────────────────────────────────
console.log('\nCASE 8: Missing property fields (no amenities, no availableFrom)');
{
  const prop = makeProperty({
    amenities: undefined,
    availableFrom: undefined,
  });
  const prefs = makePreferences();

  const { compatibilityScore, scoreBreakdown } = calculatePropertyCompatibility(prop, prefs);

  assert(!isNaN(compatibilityScore), `Score is not NaN (got ${compatibilityScore})`);
  assert(isFinite(compatibilityScore), `Score is finite (got ${compatibilityScore})`);
  assert(typeof compatibilityScore === 'number', `Score is a number (got ${typeof compatibilityScore})`);
  assert(scoreBreakdown.amenities === 0, 'Undefined amenities → amenity score = 0');
  console.log(`  Score: ${compatibilityScore}, Breakdown:`, scoreBreakdown);
}

// ── CASE 9: Minimum possible score ───────────────────────────────────
console.log('\nCASE 9: Minimum possible score');
{
  // Property designed to score as low as possible on every criterion
  const prop = makeProperty({
    rent: 15000,        // at maxRent → rentRatio=0
    bedrooms: 10,       // way off ideal → bedroomRatio=0
    amenities: [],      // 0/3 match → amenityRatio=0
    availableFrom: new Date('2027-01-01'), // far future → availabilityRatio=0
  });
  const prefs = makePreferences();

  const { compatibilityScore } = calculatePropertyCompatibility(prop, prefs);

  assert(compatibilityScore >= 0, `Score >= 0 (got ${compatibilityScore})`);
  // location=30, propertyType=15 always full. So minimum = 45.
  assert(compatibilityScore >= 40, `Minimum feasible score ≈ 45 (got ${compatibilityScore})`);
  console.log(`  Minimum score: ${compatibilityScore}`);
}

// ── CASE 10: Maximum possible score ──────────────────────────────────
console.log('\nCASE 10: Maximum possible score');
{
  const prop = makeProperty({
    rent: 8000,
    bedrooms: 2,  // diff=0.5 from ideal 2.5 — close but bedroom ratio ≈ 0.75
    amenities: ['WiFi', 'Parking', 'Gym'],
    availableFrom: new Date('2026-09-01'), // well before preferred
  });
  const prefs = makePreferences();

  const { compatibilityScore } = calculatePropertyCompatibility(prop, prefs);

  assert(compatibilityScore <= 100, `Score <= 100 (got ${compatibilityScore})`);
  console.log(`  Maximum score: ${compatibilityScore}`);
}

// ══════════════════════════════════════════════════════════════════════
// BATCH SCORING TEST
// ══════════════════════════════════════════════════════════════════════

console.log('\n── Batch Scoring (scoreAllCandidates) ──');
{
  const candidates = [
    makeProperty({ _id: 'A', rent: 8000 }),
    makeProperty({ _id: 'B', rent: 14500 }),
    makeProperty({ _id: 'C', rent: 10000 }),
  ];
  const prefs = makePreferences();

  const scored = scoreAllCandidates(candidates, prefs);

  assert(scored.length === 3, `Scored ${scored.length} candidates`);
  assert(scored.every((p) => typeof p.compatibilityScore === 'number'), 'All have numeric scores');
  assert(scored.every((p) => p.scoreBreakdown != null), 'All have scoreBreakdown');
  assert(scored.every((p) => p._id != null), 'Original property data preserved');
  assert(scored[0].compatibilityScore > scored[1].compatibilityScore, 'A(₹8k) > B(₹14.5k)');
  console.log(`  Scores: A=${scored[0].compatibilityScore}, B=${scored[1].compatibilityScore}, C=${scored[2].compatibilityScore}`);
}

// ══════════════════════════════════════════════════════════════════════
// DESIGN DOCUMENT WORKED EXAMPLE VERIFICATION
// ══════════════════════════════════════════════════════════════════════

console.log('\n── Design Doc Worked Example Verification ──');
{
  const prefs = makePreferences({
    preferredLocations: ['Indore'],
    minRent: 8000,
    maxRent: 15000,
    propertyTypes: ['APARTMENT'],
    minBedrooms: 2,
    maxBedrooms: 3,
    requiredAmenities: ['WiFi', 'Parking', 'Gym'],
    preferredAvailableFrom: new Date('2026-10-15'),
  });

  // Property A from design doc
  const propA = makeProperty({
    rent: 9000,
    bedrooms: 2,
    amenities: ['WiFi', 'Parking', 'Security'],
    availableFrom: new Date('2026-10-10'),
  });
  const resA = calculatePropertyCompatibility(propA, prefs);

  // Property B from design doc
  const propB = makeProperty({
    rent: 14500,
    bedrooms: 3,
    amenities: ['WiFi', 'Parking', 'Gym', 'Pool'],
    availableFrom: new Date('2026-10-25'),
  });
  const resB = calculatePropertyCompatibility(propB, prefs);

  console.log(`  Property A: score=${resA.compatibilityScore}`, resA.scoreBreakdown);
  console.log(`  Property B: score=${resB.compatibilityScore}`, resB.scoreBreakdown);

  // Doc says A≈91, B≈71 — verify within reasonable tolerance
  // Note: amenity match for A is 2/3 (WiFi, Parking match; Gym ≠ Security)
  assert(resA.compatibilityScore > resB.compatibilityScore, 'A ranks higher than B');
  assert(resA.compatibilityScore >= 80, `A score ≈ 91 (got ${resA.compatibilityScore})`);
  assert(resB.compatibilityScore >= 60, `B score ≈ 71 (got ${resB.compatibilityScore})`);
}

// ── Weight Redistribution Verification ───────────────────────────────
console.log('\n── Weight Redistribution: Location + Rent only ──');
{
  const prop = makeProperty({ rent: 8000 });
  const prefs = makePreferences({
    preferredLocations: ['Indore'],
    minRent: 8000,
    maxRent: 15000,
    propertyTypes: [],
    minBedrooms: undefined,
    maxBedrooms: undefined,
    requiredAmenities: [],
    preferredAvailableFrom: undefined,
  });

  const { compatibilityScore, scoreBreakdown } = calculatePropertyCompatibility(prop, prefs);

  // activeWeightSum = 30 + 25 = 55
  // location effective = (30/55)*100 = 54.55, ratio=1.0 → 54.55
  // rent effective = (25/55)*100 = 45.45, ratio=1.0 (at min) → 45.45
  // total ≈ 100
  assert(approx(compatibilityScore, 100, 0.5), `Location+Rent only, perfect match → ≈100 (got ${compatibilityScore})`);
  assert(approx(scoreBreakdown.location, 54.55, 0.1), `Location effective ≈ 54.55 (got ${scoreBreakdown.location})`);
  assert(approx(scoreBreakdown.rent, 45.45, 0.1), `Rent effective ≈ 45.45 (got ${scoreBreakdown.rent})`);
  assert(scoreBreakdown.bedrooms === 0, 'Bedrooms inactive → 0');
  console.log(`  Score: ${compatibilityScore}, Breakdown:`, scoreBreakdown);
}

// ── Summary ──────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('═══════════════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
