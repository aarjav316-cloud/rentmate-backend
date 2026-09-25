# Property Recommendation Algorithm — Design Document

> **Version:** 1.0  
> **Date:** 2026-09-26  
> **Status:** Design Only — No implementation yet  
> **Author:** RentMate Backend Team

---

## Table of Contents

1. [Overview](#1-overview)
2. [Recommendation Flow](#2-recommendation-flow)
3. [Model Field Mapping](#3-model-field-mapping)
4. [Hard Filters](#4-hard-filters)
5. [Compatibility Scoring — Overview](#5-compatibility-scoring--overview)
6. [Scoring Criteria — Detail](#6-scoring-criteria--detail)
   - 6.1 [Location Score](#61-location-score-weight-30)
   - 6.2 [Rent Score](#62-rent-score-weight-25)
   - 6.3 [Property Type Score](#63-property-type-score-weight-15)
   - 6.4 [Bedroom Score](#64-bedroom-score-weight-10)
   - 6.5 [Amenities Score](#65-amenities-score-weight-10)
   - 6.6 [Availability Score](#66-availability-score-weight-10)
7. [Missing Preference Behavior](#7-missing-preference-behavior)
8. [Final Score Calculation](#8-final-score-calculation)
9. [Ranking Logic](#9-ranking-logic)
10. [Edge Cases](#10-edge-cases)
11. [Performance Considerations](#11-performance-considerations)
12. [Worked Example](#12-worked-example)
13. [Future AI/ML Extension](#13-future-aiml-extension)

---

## 1. Overview

RentMate's recommendation system suggests properties to authenticated users based on their saved `PropertyPreference`. The system is **entirely rule-based** — no AI, ML, embeddings, LLMs, or vector databases are used.

**Core Idea:**

1. Fetch the user's `PropertyPreference` document.
2. Apply **hard filters** to eliminate clearly incompatible properties at the MongoDB query level.
3. For each surviving candidate, calculate a **compatibility score** (0–100).
4. Rank candidates by score descending and return the top results.

---

## 2. Recommendation Flow

```
Authenticated User (req.user.id)
        │
        ▼
┌─────────────────────────────┐
│  Fetch PropertyPreference   │
│  (one doc per user)         │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  Build MongoDB Hard Filters │
│  (status, location, rent,   │
│   propertyType)             │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  Query MongoDB              │
│  → Candidate Properties     │
│  (uses existing indexes)    │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  Calculate Compatibility    │
│  Score for each candidate   │
│  (0–100, weighted)          │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  Rank by Score DESC         │
│  (tie-break: createdAt DESC)│
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  Return Paginated Results   │
└─────────────────────────────┘
```

---

## 3. Model Field Mapping

Before defining filters and scores, here is the **exact mapping** between the `PropertyPreference` model and the `Property` model, based on the current codebase.

| PropertyPreference Field     | Type          | Property Model Field   | Type       | Notes                                      |
|------------------------------|---------------|------------------------|------------|--------------------------------------------|
| `preferredLocations`         | `[String]`    | `location.city`        | `String`   | Preference stores city names as an array   |
| `minRent`                    | `Number`      | `rent`                 | `Number`   | Lower bound of acceptable rent             |
| `maxRent`                    | `Number`      | `rent`                 | `Number`   | Upper bound of acceptable rent             |
| `propertyTypes`              | `[String]`    | `propertyType`         | `String`   | Preference allows multiple types           |
| `minBedrooms`                | `Number`      | `bedrooms`             | `Number`   | Lower bound for bedroom count              |
| `maxBedrooms`                | `Number`      | `bedrooms`             | `Number`   | Upper bound for bedroom count              |
| `requiredAmenities`          | `[String]`    | `amenities`            | `[String]` | Amenities the user considers necessary     |
| `preferredAvailableFrom`     | `Date`        | `availableFrom`        | `Date`     | Earliest acceptable availability date      |

**Fields that DO NOT exist in the current models:**

- Geographic coordinates / lat-lng — no distance calculation possible
- Furnishing status — not in either model
- Pet policy — not in either model
- Floor preference — not in either model

These are documented for future extension but are **not used** in the current algorithm.

---

## 4. Hard Filters

Hard filters are applied at the **MongoDB query level** to reduce the candidate set before any scoring happens. A hard filter completely eliminates properties that cannot possibly be a valid recommendation.

### 4.1 Always-Applied Filters

| Filter              | MongoDB Query                          | Rationale                                              |
|----------------------|----------------------------------------|--------------------------------------------------------|
| Status = AVAILABLE   | `{ status: 'AVAILABLE' }`              | Never recommend unavailable or rented properties       |
| Not created by user  | `{ createdBy: { $ne: userId } }`       | Users should not see their own listings as recommendations |

### 4.2 Conditionally-Applied Filters (only when the preference exists)

| Preference Field      | Condition to Apply          | MongoDB Query                                                                                      | Index Used                                   |
|-----------------------|-----------------------------|----------------------------------------------------------------------------------------------------|----------------------------------------------|
| `preferredLocations`  | Array is non-empty          | `{ 'location.city': { $in: preferredLocations } }` (case-insensitive via regex)                    | `{ status: 1, 'location.city': 1, rent: 1 }` |
| `maxRent`             | Value is defined            | `{ rent: { $lte: maxRent } }`                                                                     | `{ status: 1, rent: 1 }`                     |
| `propertyTypes`       | Array is non-empty          | `{ propertyType: { $in: propertyTypes } }`                                                         | Scanned after status/city/rent filter         |

### 4.3 Fields that are NOT Hard Filters

| Field                       | Reason                                                                                        |
|-----------------------------|-----------------------------------------------------------------------------------------------|
| `minRent`                   | Soft constraint — a cheaper property is still a valid recommendation                          |
| `minBedrooms` / `maxBedrooms` | Soft constraint — a property ±1 bedroom still has value                                     |
| `requiredAmenities`         | Soft constraint — partial matches are still useful                                            |
| `preferredAvailableFrom`    | Soft constraint — a property available slightly later could still be relevant                 |

**Rule:** If a preference field is not provided by the user, its corresponding hard filter is **not applied**. The query proceeds without that constraint.

---

## 5. Compatibility Scoring — Overview

After hard filtering, every candidate property receives a **compatibility score** from **0 to 100**.

### Weight Table

| Criterion       | Weight | Max Points |
|----------------|--------|------------|
| Location        | 30%    | 30         |
| Rent            | 25%    | 25         |
| Property Type   | 15%    | 15         |
| Bedrooms        | 10%    | 10         |
| Amenities       | 10%    | 10         |
| Availability    | 10%    | 10         |
| **Total**       | **100%** | **100**  |

> **Important:** When one or more preferences are missing, the weights are **redistributed** so the final score always remains normalized to the 0–100 scale. See [Section 7](#7-missing-preference-behavior).

---

## 6. Scoring Criteria — Detail

### 6.1 Location Score (Weight: 30)

**Preference field:** `preferredLocations` (array of city names)  
**Property field:** `location.city` (single string)

Since `preferredLocations` is used as a **hard filter**, any candidate that passes the filter is in a preferred city. Therefore:

| Scenario                                          | Score   |
|---------------------------------------------------|---------|
| `preferredLocations` is non-empty AND property's city matches one of them | **30** (full) |
| `preferredLocations` is empty (no location preference)                    | **30** (full — no penalty) |

**Rationale:** When location is a hard filter, mismatched locations are already eliminated. There is no "partial location match" in the current system (no distance/geo). If the user has no location preference, every property gets the full location score.

**Formula:**

```
locationScore = WEIGHT_LOCATION  // always 30 for candidates that pass hard filters
```

---

### 6.2 Rent Score (Weight: 25)

**Preference fields:** `minRent`, `maxRent`  
**Property field:** `rent`

The rent score rewards properties that are **closer to the lower end** of the user's acceptable range, since tenants generally prefer lower rent within their budget.

#### Case 1: Both `minRent` and `maxRent` are provided

```
rentRange = maxRent - minRent

if rentRange === 0:
    // User wants an exact rent amount
    rentScore = (property.rent === maxRent) ? 25 : 0

else:
    // Linear scoring — closer to minRent = higher score
    // property.rent is guaranteed ≤ maxRent by hard filter
    // property.rent may be < minRent (not a hard filter)

    if property.rent < minRent:
        // Below minimum — mild penalty, proportional to how far below
        distanceBelow = minRent - property.rent
        penalty = distanceBelow / minRent   // 0 to 1
        rentScore = 25 × max(0, 1 - penalty)

    else:
        // Within [minRent, maxRent] range
        distanceFromMin = property.rent - minRent
        rentScore = 25 × (1 - distanceFromMin / rentRange)
```

#### Case 2: Only `maxRent` is provided

```
if property.rent <= maxRent:
    // Linear: cheaper = better
    rentScore = 25 × (1 - property.rent / maxRent)
else:
    rentScore = 0  // Should not happen due to hard filter
```

#### Case 3: Only `minRent` is provided

```
if property.rent >= minRent:
    rentScore = 25  // Full score — within acceptable range
else:
    distanceBelow = minRent - property.rent
    penalty = distanceBelow / minRent
    rentScore = 25 × max(0, 1 - penalty)
```

#### Case 4: Neither `minRent` nor `maxRent` is provided

```
rentScore = 25  // Full score — no preference = no penalty
```

**Properties:**
- Deterministic ✓
- Bounded [0, 25] ✓
- Explainable — "cheaper within your budget = higher score" ✓
- Continuous — no abrupt 100→0 cliff ✓

---

### 6.3 Property Type Score (Weight: 15)

**Preference field:** `propertyTypes` (array of strings)  
**Property field:** `propertyType` (single string)

Since `propertyTypes` is a **hard filter** when non-empty, matches are guaranteed for candidates.

| Scenario                                    | Score   |
|---------------------------------------------|---------|
| `propertyTypes` is non-empty AND property type is in the array | **15** (full) |
| `propertyTypes` is empty (no preference)    | **15** (full — no penalty) |

**Formula:**

```
propertyTypeScore = WEIGHT_PROPERTY_TYPE  // always 15 for candidates that pass hard filters
```

---

### 6.4 Bedroom Score (Weight: 10)

**Preference fields:** `minBedrooms`, `maxBedrooms`  
**Property field:** `bedrooms`

Bedrooms are a **soft criterion** — not a hard filter. A property with ±1 bedroom from the ideal is still valuable but less preferred.

#### Scoring Logic

```
// Step 1: Determine the user's "ideal" bedroom count
if minBedrooms is defined AND maxBedrooms is defined:
    idealBedrooms = (minBedrooms + maxBedrooms) / 2
    bedroomRange  = maxBedrooms - minBedrooms

elif only minBedrooms is defined:
    idealBedrooms = minBedrooms
    bedroomRange  = 2  // default tolerance window

elif only maxBedrooms is defined:
    idealBedrooms = maxBedrooms
    bedroomRange  = 2  // default tolerance window

else:
    // No bedroom preference
    bedroomScore = 10  // full score
    RETURN

// Step 2: Calculate distance-based score
diff = |property.bedrooms - idealBedrooms|
tolerance = max(bedroomRange, 1)  // Prevent division by zero

if diff === 0:
    bedroomScore = 10  // Perfect match

else:
    // Decay score linearly based on distance from ideal
    bedroomScore = 10 × max(0, 1 - diff / (tolerance + 1))
```

**Examples (minBedrooms=2, maxBedrooms=3, ideal=2.5, tolerance=1):**

| Property Bedrooms | diff | Score |
|-------------------|------|-------|
| 2                 | 0.5  | 10 × (1 - 0.5/2) = 7.5 |
| 3                 | 0.5  | 7.5   |
| 1                 | 1.5  | 10 × (1 - 1.5/2) = 2.5 |
| 4                 | 1.5  | 2.5   |
| 5                 | 2.5  | 0     |

---

### 6.5 Amenities Score (Weight: 10)

**Preference field:** `requiredAmenities` (array of strings)  
**Property field:** `amenities` (array of strings)

#### Scoring Logic

```
if requiredAmenities is empty OR requiredAmenities is undefined:
    amenityScore = 10  // No preference = no penalty

else:
    matchedCount = count of requiredAmenities that exist in property.amenities
                   (case-insensitive comparison)
    totalRequired = requiredAmenities.length

    amenityScore = 10 × (matchedCount / totalRequired)
```

**Examples (requiredAmenities = ["WiFi", "Parking", "Gym", "Security"]):**

| Property Amenities                  | Matched | Score           |
|-------------------------------------|---------|-----------------|
| WiFi, Parking, Gym, Security        | 4/4     | 10 × 1.0 = 10  |
| WiFi, Parking, Security             | 3/4     | 10 × 0.75 = 7.5 |
| WiFi                                | 1/4     | 10 × 0.25 = 2.5 |
| Pool, Garden                        | 0/4     | 10 × 0.0 = 0   |
| WiFi, Parking, Gym, Security, Pool  | 4/4     | 10 × 1.0 = 10  |

**Key Behaviors:**
- Comparison is **case-insensitive** (normalize both sides to lowercase).
- Extra amenities on the property that the user didn't request are **ignored** (no bonus, no penalty).
- If the property has an empty amenities array but the user requested some, score = 0.

---

### 6.6 Availability Score (Weight: 10)

**Preference field:** `preferredAvailableFrom` (Date)  
**Property field:** `availableFrom` (Date)

The score is higher when the property is available **on or before** the user's desired date.

#### Scoring Logic

```
if preferredAvailableFrom is undefined:
    availabilityScore = 10  // No preference = no penalty

else:
    diffDays = (property.availableFrom - preferredAvailableFrom) / (1000 × 60 × 60 × 24)
    // diffDays < 0 → property is available BEFORE the user needs it (good)
    // diffDays = 0 → exact match (best)
    // diffDays > 0 → property is available AFTER the user needs it (worse)

    if diffDays <= 0:
        availabilityScore = 10  // Available on or before the desired date — full score

    else:
        // Gradual decay over a 30-day grace window
        GRACE_PERIOD_DAYS = 30
        availabilityScore = 10 × max(0, 1 - diffDays / GRACE_PERIOD_DAYS)
```

**Examples (preferredAvailableFrom = 2026-10-01):**

| Property availableFrom | diffDays | Score |
|------------------------|----------|-------|
| 2026-09-15             | −16      | 10    |
| 2026-10-01             |  0       | 10    |
| 2026-10-10             |  9       | 10 × (1 − 9/30) = 7.0 |
| 2026-10-20             |  19      | 10 × (1 − 19/30) = 3.67 |
| 2026-11-01             |  31      | 0     |

---

## 7. Missing Preference Behavior

**Principle:** If a user does not provide a preference for a criterion, that criterion MUST NOT reduce their overall score. The system must remain **fair**.

### Strategy: Weight Redistribution

When a preference is missing, the weight for that criterion is **redistributed proportionally** among the remaining active criteria.

**Algorithm:**

```
// 1. Determine which criteria are active (user has the preference)
activeCriteria = []
for each criterion in [location, rent, propertyType, bedrooms, amenities, availability]:
    if user has the corresponding preference:
        activeCriteria.push(criterion)

// 2. Calculate the sum of active base weights
activeWeightSum = sum of base weights for all activeCriteria

// 3. If NO criteria are active, every property gets score = 100
if activeCriteria is empty:
    finalScore = 100
    RETURN

// 4. Calculate each criterion's effective weight
for each criterion in activeCriteria:
    effectiveWeight = (criterion.baseWeight / activeWeightSum) × 100

// 5. Calculate raw score for each criterion using effective weight
// (same formula as before, but replace the base weight with effectiveWeight)
```

### Preference Existence Checks

| Criterion     | "Preference exists" when…                                        |
|---------------|------------------------------------------------------------------|
| Location      | `preferredLocations` is a non-empty array                        |
| Rent          | `minRent` OR `maxRent` is defined                                |
| Property Type | `propertyTypes` is a non-empty array                             |
| Bedrooms      | `minBedrooms` OR `maxBedrooms` is defined                        |
| Amenities     | `requiredAmenities` is a non-empty array                         |
| Availability  | `preferredAvailableFrom` is defined                              |

### Example: User only has location and rent preferences

```
Active:   location (30), rent (25)     → activeWeightSum = 55
Inactive: propertyType, bedrooms, amenities, availability

Effective weights:
  location = (30 / 55) × 100 ≈ 54.55
  rent     = (25 / 55) × 100 ≈ 45.45

Final Score = locationScore (with effective weight) + rentScore (with effective weight)
            = normalized to 0–100
```

---

## 8. Final Score Calculation

### Complete Formula

```javascript
function calculateFinalScore(property, preferences) {
    // Step 1: Determine active criteria and their base weights
    const criteria = [
        { name: 'location',     baseWeight: 30, isActive: preferences.preferredLocations?.length > 0 },
        { name: 'rent',         baseWeight: 25, isActive: preferences.minRent != null || preferences.maxRent != null },
        { name: 'propertyType', baseWeight: 15, isActive: preferences.propertyTypes?.length > 0 },
        { name: 'bedrooms',     baseWeight: 10, isActive: preferences.minBedrooms != null || preferences.maxBedrooms != null },
        { name: 'amenities',    baseWeight: 10, isActive: preferences.requiredAmenities?.length > 0 },
        { name: 'availability', baseWeight: 10, isActive: preferences.preferredAvailableFrom != null },
    ];

    const activeCriteria = criteria.filter(c => c.isActive);

    // Step 2: If no preferences at all, return 100
    if (activeCriteria.length === 0) return 100;

    // Step 3: Calculate effective weights
    const activeWeightSum = activeCriteria.reduce((sum, c) => sum + c.baseWeight, 0);
    const scaleFactor = 100 / activeWeightSum;

    // Step 4: Calculate individual raw scores (0 to 1 ratio)
    const rawScores = {
        location:     calculateLocationRatio(property, preferences),
        rent:         calculateRentRatio(property, preferences),
        propertyType: calculatePropertyTypeRatio(property, preferences),
        bedrooms:     calculateBedroomRatio(property, preferences),
        amenities:    calculateAmenityRatio(property, preferences),
        availability: calculateAvailabilityRatio(property, preferences),
    };

    // Step 5: Weighted sum with effective weights
    let finalScore = 0;
    for (const criterion of activeCriteria) {
        const effectiveWeight = criterion.baseWeight * scaleFactor;
        finalScore += rawScores[criterion.name] * effectiveWeight;
    }

    // Step 6: Clamp and round
    return Math.round(Math.min(100, Math.max(0, finalScore)));
}
```

> Each `calculate*Ratio` function returns a value between **0.0 and 1.0**, representing the fraction of the maximum possible score for that criterion. The effective weight then maps this to the final point contribution.

**Properties of the final score:**
- Always in range **[0, 100]** ✓
- Deterministic ✓
- Normalized regardless of how many preferences exist ✓
- No unfair penalty for missing preferences ✓

---

## 9. Ranking Logic

### Primary Sort

```
Sort by: compatibilityScore DESC
```

### Tie-Breaking (Secondary Sort)

When two or more properties have the **same** compatibility score:

```
Sort by: createdAt DESC
```

**Rationale:** Newer properties are more likely to be still available and have up-to-date information. The `createdAt` field exists on every property via `timestamps: true` in the schema.

### Pagination

Results should support standard pagination:
- `page` (default: 1)
- `limit` (default: 12, max: 50)

This mirrors the existing property discovery API pagination pattern.

---

## 10. Edge Cases

| # | Scenario | Behavior |
|---|----------|----------|
| 1 | **User has no PropertyPreference document** | Return a `404` or graceful message: "Set your preferences to get recommendations." Do NOT fall back to random properties. |
| 2 | **User has an empty/default PropertyPreference** (all arrays empty, no numbers set) | All criteria are inactive → every AVAILABLE property gets score = 100. Sort by `createdAt DESC`. Effectively shows newest available properties. |
| 3 | **No property matches hard filters** | Return an empty array with `count: 0` and a helpful message: "No properties match your preferences. Try broadening your criteria." |
| 4 | **Property has missing optional fields** (e.g., empty amenities array) | The scoring algorithm handles this — if the property has no amenities but the user requested some, the amenity score is 0 for that property. Other criteria scores are unaffected. |
| 5 | **User has no optional preferences** (only hard-filter preferences exist) | Soft-criterion weights redistribute among active criteria. If only location is active, location alone determines the score (100 points for a match). |
| 6 | **Property status is UNAVAILABLE or RENTED** | Eliminated by the always-applied `status: 'AVAILABLE'` hard filter. Never scored. |
| 7 | **Property has no amenities (empty array)** | If user has `requiredAmenities`, amenity score = 0. If user has no amenity preference, amenity criterion is inactive and doesn't affect score. |
| 8 | **User requests amenities but property has none** | Amenity score = `10 × (0 / N) = 0` for that property. Other scores unaffected. |
| 9 | **Only `minRent` exists** (no `maxRent`) | Hard filter is NOT applied for rent (since `maxRent` drives the hard filter). Rent scoring uses Case 3 formula. |
| 10 | **Only `maxRent` exists** (no `minRent`) | Hard filter: `rent ≤ maxRent`. Rent scoring uses Case 2 formula. |
| 11 | **Both `minRent` and `maxRent` are missing** | No rent hard filter. Rent criterion is inactive. Weight redistributed to other active criteria. |
| 12 | **`minBedrooms` = `maxBedrooms`** (e.g., both = 2) | ideal = 2, tolerance = max(0, 1) = 1. Exact match (2 bedrooms) = 10 points. ±1 = reduced score. Works correctly. |
| 13 | **Property `availableFrom` is in the far future** | If > 30 days past user's preferred date → availability score = 0. Other scores unaffected. |
| 14 | **User's `preferredLocations` contains cities with different casing** | Comparison is case-insensitive (regex `^city$` with `i` flag), matching the existing discovery filter pattern. |

---

## 11. Performance Considerations

### 11.1 Query Optimization Strategy

```
Hard Filter First → Score Only Candidates
```

1. **Hard filters reduce the dataset** at the MongoDB level — the scoring function never touches irrelevant properties.
2. The hard filter query uses the **existing compound indexes**:

   | Index                                          | Used By                              |
   |------------------------------------------------|--------------------------------------|
   | `{ status: 1, 'location.city': 1, rent: 1 }`  | status + city + rent range filters   |
   | `{ status: 1, rent: 1 }`                       | status + rent (no city preference)   |
   | `{ rent: 1 }`                                  | Sort-by-rent queries                 |

3. **No new indexes are required** for the recommendation query.

### 11.2 Scoring is In-Memory

- Properties are fetched with `.lean()` (plain JS objects, no Mongoose overhead).
- Compatibility scoring happens in **application memory** on the filtered candidate set.
- Expected candidate set size: 10–500 properties (after hard filtering). Well within in-memory processing limits.

### 11.3 Future: Redis Caching (Not Implemented in This Step)

- Recommendation results can be cached per user with a short TTL (e.g., 5 min).
- Cache key pattern: `rentmate:v1:recommendations:{userId}:{preferencesHash}`
- Cache invalidation: on preference update, on new property creation.
- Details deferred to the Redis implementation step.

### 11.4 Pagination at Database Level

- Use MongoDB `skip` + `limit` for pagination **only** if pre-scoring strategies are applied (e.g., pre-sorted by rent).
- For full scoring accuracy, fetch all candidates matching hard filters, score them, sort in-memory, then slice for the requested page.
- If the candidate set grows very large (10,000+), consider server-side cursor pagination or a two-phase approach.

---

## 12. Worked Example

### User Preferences

```json
{
  "preferredLocations": ["Indore"],
  "minRent": 8000,
  "maxRent": 15000,
  "propertyTypes": ["APARTMENT"],
  "minBedrooms": 2,
  "maxBedrooms": 3,
  "requiredAmenities": ["WiFi", "Parking", "Gym"],
  "preferredAvailableFrom": "2026-10-15"
}
```

### Hard Filter Query

```javascript
{
  status: 'AVAILABLE',
  createdBy: { $ne: userId },
  'location.city': { $regex: /^Indore$/i },
  rent: { $lte: 15000 },
  propertyType: { $in: ['APARTMENT'] }
}
```

### Active Criteria

All 6 criteria are active → `activeWeightSum = 100`, `scaleFactor = 1.0`.  
Effective weights = base weights (no redistribution needed).

---

### Property A: "Sunny 2BHK in Indore"

| Field | Value |
|-------|-------|
| `location.city` | Indore |
| `rent` | 9000 |
| `propertyType` | APARTMENT |
| `bedrooms` | 2 |
| `amenities` | ["WiFi", "Parking", "Security"] |
| `availableFrom` | 2026-10-10 |

**Scoring:**

| Criterion | Calculation | Raw Ratio | Effective Weight | Score |
|-----------|-------------|-----------|------------------|-------|
| Location | City matches Indore → full | 1.0 | 30 | **30.00** |
| Rent | range=7000, dist=9000−8000=1000, ratio=1−1000/7000=0.857 | 0.857 | 25 | **21.43** |
| Property Type | APARTMENT matches → full | 1.0 | 15 | **15.00** |
| Bedrooms | ideal=2.5, diff=\|2−2.5\|=0.5, tol=1, ratio=1−0.5/2=0.75 | 0.75 | 10 | **7.50** |
| Amenities | requested=3, matched=["WiFi","Parking"]=2, ratio=2/3 | 0.667 | 10 | **6.67** |
| Availability | diff=10/10−10/15=−5 days (before) → full | 1.0 | 10 | **10.00** |

**Final Score: 30.00 + 21.43 + 15.00 + 7.50 + 6.67 + 10.00 = 90.60 → 91**

---

### Property B: "Modern 3BHK in Indore"

| Field | Value |
|-------|-------|
| `location.city` | Indore |
| `rent` | 14500 |
| `propertyType` | APARTMENT |
| `bedrooms` | 3 |
| `amenities` | ["WiFi", "Parking", "Gym", "Pool"] |
| `availableFrom` | 2026-10-25 |

**Scoring:**

| Criterion | Calculation | Raw Ratio | Effective Weight | Score |
|-----------|-------------|-----------|------------------|-------|
| Location | City matches → full | 1.0 | 30 | **30.00** |
| Rent | dist=14500−8000=6500, ratio=1−6500/7000=0.071 | 0.071 | 25 | **1.79** |
| Property Type | APARTMENT matches → full | 1.0 | 15 | **15.00** |
| Bedrooms | diff=\|3−2.5\|=0.5, ratio=1−0.5/2=0.75 | 0.75 | 10 | **7.50** |
| Amenities | matched=["WiFi","Parking","Gym"]=3/3 → full | 1.0 | 10 | **10.00** |
| Availability | diff=10 days after, ratio=1−10/30=0.667 | 0.667 | 10 | **6.67** |

**Final Score: 30.00 + 1.79 + 15.00 + 7.50 + 10.00 + 6.67 = 70.96 → 71**

---

### Property C: "Cozy Studio in Indore"

This property has `propertyType: 'STUDIO'` → **eliminated by hard filter** (`propertyType: { $in: ['APARTMENT'] }`).

Not scored.

---

### Final Ranking

| Rank | Property | Score |
|------|----------|-------|
| 1 | Property A — Sunny 2BHK | 91 |
| 2 | Property B — Modern 3BHK | 71 |

---

## 13. Future AI/ML Extension

The current rule-based system is designed to be **easily extensible** with AI/ML in the future:

| Extension | How It Plugs In |
|-----------|-----------------|
| **Collaborative Filtering** | Add a `userSimilarityScore` criterion to the weight table. Properties liked/viewed by similar users get a boost. |
| **Content-Based Filtering** | Use property description embeddings to compute semantic similarity with user's past interactions. Add as a new scoring criterion. |
| **Learning-to-Rank** | Replace the fixed weight table with a trained model that learns optimal weights from user interaction data (clicks, saves, inquiries). |
| **Geographic Distance** | Add lat/lng to the Property model, compute Haversine distance, replace the binary location score with a distance-based decay function. |
| **Personalized Weights** | Track user behavior and dynamically adjust the weight table per user (e.g., a user who always filters by amenities should have amenities weighted higher). |
| **Hybrid System** | Use rule-based scoring as a baseline, then apply an ML re-ranker on the top-N candidates. |

**The current architecture supports these extensions because:**
1. The scoring function is modular — each criterion is an independent function.
2. New criteria can be added by simply adding a new entry to the criteria array.
3. The weight redistribution system automatically normalizes regardless of how many criteria exist.
4. Hard filters and soft scoring are cleanly separated.

---

## Appendix: Quick Reference Card

### Hard Filters
- `status: 'AVAILABLE'` (always)
- `createdBy: { $ne: userId }` (always)
- `location.city` → when `preferredLocations` is non-empty
- `rent ≤ maxRent` → when `maxRent` is defined
- `propertyType ∈ propertyTypes` → when `propertyTypes` is non-empty

### Scoring Weights
| Location | Rent | Type | Bedrooms | Amenities | Availability |
|----------|------|------|----------|-----------|--------------|
| 30       | 25   | 15   | 10       | 10        | 10           |

### Missing Preference → Weight Redistribution
`effectiveWeight = (baseWeight / sumOfActiveBaseWeights) × 100`

### Ranking
Primary: `compatibilityScore DESC` → Tiebreak: `createdAt DESC`
