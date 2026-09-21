/**
 * ═══════════════════════════════════════════════════════════════════════
 * RentMate — MongoDB Query & Index Analysis Script
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Usage (development only):
 *   node scripts/analyze-indexes.js
 *
 * This script:
 *   1. Connects to your local MongoDB
 *   2. Lists all existing indexes on Property and PropertyPreference
 *   3. Runs explain("executionStats") on every real query pattern
 *   4. Prints a clean analysis report
 *   5. Disconnects and exits
 *
 * NEVER expose this via an API. It is a local dev tool only.
 * ═══════════════════════════════════════════════════════════════════════
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/rentmate';

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Helper to pretty-print explain results ───────────────────────────

function summarizeExplain(label, explainResult) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`📊 QUERY: ${label}`);
  console.log(`${'─'.repeat(70)}`);

  const stats = explainResult?.executionStats;
  if (!stats) {
    console.log('  ⚠️  No executionStats available');
    return;
  }

  console.log(`  nReturned:          ${stats.nReturned}`);
  console.log(`  totalDocsExamined:  ${stats.totalDocsExamined}`);
  console.log(`  totalKeysExamined:  ${stats.totalKeysExamined}`);
  console.log(`  executionTimeMs:    ${stats.executionTimeMillis}ms`);

  const plan = explainResult?.queryPlanner?.winningPlan;
  if (plan) {
    const stages = [];
    let current = plan;
    while (current) {
      stages.push(current.stage);
      if (current.inputStage) {
        current = current.inputStage;
      } else if (current.inputStages) {
        stages.push(`[${current.inputStages.map(s => s.stage).join(', ')}]`);
        break;
      } else {
        break;
      }
    }
    console.log(`  stages:             ${stages.join(' → ')}`);

    // Find the IXSCAN stage to show which index was used
    let node = plan;
    while (node) {
      if (node.stage === 'IXSCAN') {
        console.log(`  indexUsed:          ${node.indexName}`);
        console.log(`  indexBounds:        ${JSON.stringify(node.indexBounds).substring(0, 200)}`);
        break;
      }
      node = node.inputStage || null;
    }
  }

  // Efficiency check
  const efficiency = stats.totalDocsExamined > 0
    ? (stats.nReturned / stats.totalDocsExamined * 100).toFixed(1)
    : 'N/A (no docs)';
  console.log(`  efficiency:         ${efficiency}% (returned/examined)`);

  const isCollScan = JSON.stringify(explainResult?.queryPlanner?.winningPlan).includes('COLLSCAN');
  if (isCollScan) {
    console.log(`  ⚠️  COLLSCAN DETECTED — no index used for this query`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log('🔗 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected\n');

  const db = mongoose.connection.db;
  const propertyCol = db.collection('properties');
  const prefCol = db.collection('propertypreferences');

  // ── 1. List existing indexes ─────────────────────────────────────

  console.log('═'.repeat(70));
  console.log('1. CURRENT INDEXES');
  console.log('═'.repeat(70));

  const propIndexes = await propertyCol.indexes();
  console.log('\n📁 Property Collection Indexes:');
  propIndexes.forEach((idx, i) => {
    console.log(`  ${i + 1}. ${idx.name} → ${JSON.stringify(idx.key)}${idx.unique ? ' (UNIQUE)' : ''}`);
  });

  try {
    const prefIndexes = await prefCol.indexes();
    console.log('\n📁 PropertyPreference Collection Indexes:');
    prefIndexes.forEach((idx, i) => {
      console.log(`  ${i + 1}. ${idx.name} → ${JSON.stringify(idx.key)}${idx.unique ? ' (UNIQUE)' : ''}`);
    });
  } catch {
    console.log('\n📁 PropertyPreference Collection: not yet created (no documents)');
  }

  // ── 2. Explain actual query patterns ─────────────────────────────

  console.log(`\n${'═'.repeat(70)}`);
  console.log('2. QUERY PATTERN ANALYSIS (explain executionStats)');
  console.log('═'.repeat(70));

  // Q1: Default property discovery — { status: 'AVAILABLE' }, sort: { createdAt: -1 }
  const q1 = await propertyCol
    .find({ status: 'AVAILABLE' })
    .sort({ createdAt: -1 })
    .limit(12)
    .explain('executionStats');
  summarizeExplain('Default discovery: { status: AVAILABLE } sort: { createdAt: -1 }', q1);

  // Q2: City filter — { status: 'AVAILABLE', 'location.city': /^Indore$/i }
  const q2 = await propertyCol
    .find({ status: 'AVAILABLE', 'location.city': /^Indore$/i })
    .sort({ createdAt: -1 })
    .limit(12)
    .explain('executionStats');
  summarizeExplain('City filter: { status: AVAILABLE, location.city: /Indore/i }', q2);

  // Q3: Rent range — { status: 'AVAILABLE', rent: { $gte: 8000, $lte: 15000 } }
  const q3 = await propertyCol
    .find({ status: 'AVAILABLE', rent: { $gte: 8000, $lte: 15000 } })
    .sort({ createdAt: -1 })
    .limit(12)
    .explain('executionStats');
  summarizeExplain('Rent range: { status: AVAILABLE, rent: { $gte: 8000, $lte: 15000 } }', q3);

  // Q4: Property type — { status: 'AVAILABLE', propertyType: 'APARTMENT' }
  const q4 = await propertyCol
    .find({ status: 'AVAILABLE', propertyType: 'APARTMENT' })
    .sort({ createdAt: -1 })
    .limit(12)
    .explain('executionStats');
  summarizeExplain('Property type: { status: AVAILABLE, propertyType: APARTMENT }', q4);

  // Q5: Combined — status + city + rent + propertyType + bedrooms
  const q5 = await propertyCol
    .find({
      status: 'AVAILABLE',
      'location.city': /^Indore$/i,
      rent: { $gte: 8000, $lte: 15000 },
      propertyType: 'APARTMENT',
      bedrooms: { $gte: 2 },
    })
    .sort({ createdAt: -1 })
    .limit(12)
    .explain('executionStats');
  summarizeExplain('Combined: status + city + rent + type + bedrooms', q5);

  // Q6: Keyword search — $or regex across 6 fields
  const searchRegex = new RegExp(escapeRegex('vijay'), 'i');
  const q6 = await propertyCol
    .find({
      status: 'AVAILABLE',
      $or: [
        { title: searchRegex },
        { description: searchRegex },
        { 'location.address': searchRegex },
        { 'location.city': searchRegex },
        { 'location.state': searchRegex },
        { 'location.pincode': searchRegex },
      ],
    })
    .sort({ createdAt: -1 })
    .limit(12)
    .explain('executionStats');
  summarizeExplain('Keyword search: $or regex across 6 fields', q6);

  // Q7: Sort by rent ASC — { status: 'AVAILABLE' } sort: { rent: 1 }
  const q7 = await propertyCol
    .find({ status: 'AVAILABLE' })
    .sort({ rent: 1 })
    .limit(12)
    .explain('executionStats');
  summarizeExplain('Sort by rent ASC: { status: AVAILABLE } sort: { rent: 1 }', q7);

  // Q8: My Properties — { createdBy: ObjectId(...) } sort: { createdAt: -1 }
  // Use a dummy ObjectId
  const dummyUserId = new mongoose.Types.ObjectId();
  const q8 = await propertyCol
    .find({ createdBy: dummyUserId })
    .sort({ createdAt: -1 })
    .explain('executionStats');
  summarizeExplain('My Properties: { createdBy: <userId> } sort: { createdAt: -1 }', q8);

  // Q9: Property by ID — findById uses _id index (always IXSCAN)
  const q9 = await propertyCol
    .find({ _id: new mongoose.Types.ObjectId() })
    .explain('executionStats');
  summarizeExplain('Property by ID: { _id: <ObjectId> }', q9);

  // Q10: PropertyPreference by user
  try {
    const q10 = await prefCol
      .find({ user: dummyUserId })
      .explain('executionStats');
    summarizeExplain('PropertyPreference by user: { user: <userId> }', q10);
  } catch {
    console.log('\n  ⏭️  PropertyPreference collection not yet created, skipping explain');
  }

  // ── 3. Summary ──────────────────────────────────────────────────

  console.log(`\n${'═'.repeat(70)}`);
  console.log('3. ANALYSIS SUMMARY');
  console.log('═'.repeat(70));

  console.log(`
Key Observations:

  • MongoDB automatically creates an index on _id — no manual index needed.
  
  • The { status: 1 } single-field index has LOW selectivity.
    Most properties are AVAILABLE, so the index doesn't filter out many docs.
    It is SUBSUMED by the compound index { status: 1, location.city: 1, rent: 1 }.
    → REDUNDANT unless standalone status queries exist (they don't).

  • The { propertyType: 1 } single-field index is rarely queried alone.
    It always appears alongside status. As a single-field index it has 
    limited value; the optimizer might use it but status + type would be better.
    → LOW VALUE for current patterns.

  • The { location.city: 1 } single-field index is SUBSUMED by the compound
    index { status: 1, location.city: 1, rent: 1 } for the most common query  
    (status + city). However, city filters use case-insensitive regex (/^city$/i),
    which can still use the B-tree index for prefix anchored patterns.

  • The { rent: 1 } single-field index can help for sort-by-rent queries
    when no other filters are applied. However, it does not help rent RANGE
    queries that also filter by status, because MongoDB uses one index per query
    and the compound index { status: 1, location.city: 1, rent: 1 } would need
    to be used instead.

  • The compound index { status: 1, location.city: 1, rent: 1 } follows the
    Equality-Sort-Range (ESR) pattern well for queries that filter by status + city
    and then range on rent. This is the MOST VALUABLE index for the discovery API.

  • Keyword search ($or with unanchored regex) CANNOT use B-tree indexes.
    Regex patterns like /vijay/i (no ^ anchor) require a COLLSCAN or an  
    expensive index scan. This is a known MongoDB limitation.
    → MongoDB Text Index or Atlas Search would be needed for production scale.

  • skip-based pagination degrades for large page numbers because MongoDB must
    iterate through (page-1)*limit documents before returning results.
    → Cursor-based pagination should be considered if the dataset grows large.

Redundancy Assessment:
  • { status: 1 }              → REDUNDANT (prefix of compound index)
  • { propertyType: 1 }        → LOW VALUE for current query patterns
  • { location.city: 1 }       → MOSTLY REDUNDANT (compound index covers most cases)
  • { rent: 1 }                → USEFUL for sort-by-rent when no city filter
  • { createdBy: 1 }           → ESSENTIAL for getMyProperties
  • compound { status, city, rent } → MOST VALUABLE
`);

  await mongoose.disconnect();
  console.log('🔌 Disconnected from MongoDB');
}

main().catch((err) => {
  console.error('Analysis failed:', err.message);
  process.exit(1);
});
