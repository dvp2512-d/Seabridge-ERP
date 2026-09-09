# SEABRIDGE ERP - FUNCTIONAL CHANGE ANALYSIS REPORT

**Analysis Date:** Monday, 2026-08-24  
**Commits Analyzed:** 5 commits (20ed069, 7b38d3f, edf65c0, 7521e16, 88ad9d8)  
**Analysis Method:** Source code diff analysis with current implementation verification

---

## 1. FEATURES ADDED

### 1.1 Port Selection in Quotations (Commit 7b38d3f)

**New Feature:** Port of Loading and Port of Discharge selection dropdowns added to quotation creation.

**User-Facing Functionality:**
- Two new dropdown fields appear in the New Quotation form:
  - **Port of Loading** - Select origin port
  - **Port of Discharge** - Select destination port
- Ports display as "Port Name (Code)" format (e.g., "Mumbai (INMUN)")

**Where Available:**
- `/quotations/new` - New Quotation page
- Quotation detail view (displays selected ports)

**How It Works:**
1. User navigates to New Quotation
2. Dropdown populated from `/api/master/dropdowns` endpoint
3. User selects ports (optional fields)
4. On save, `portOfLoadingId` and `portOfDischargeId` sent to API
5. Stored in quotation record
6. Displayed on quotation detail page

**New Fields Added:**
| Field | Type | Required | Location |
|-------|------|----------|----------|
| portOfLoadingId | String (UUID) | No | Quotation form |
| portOfDischargeId | String (UUID) | No | Quotation form |

**New UI Controls:**
- 2 SelectField dropdown components in NewQuotation.tsx
- Port data fetched via dropdowns API

---

## 2. FEATURES REMOVED

### 2.1 Automated Exchange Rate Market Comparison (Commit 20ed069)

**Removed Feature:** Real-time market rate comparison for exchange rate entry validation.

**What Was Removed:**

#### Backend (API):
| Component | Description |
|-----------|-------------|
| `GET /api/exchange-rates/market-check` endpoint | Fetched live rates from open.er-api.com |
| External API call to `https://open.er-api.com/v6/latest/{base}` | Third-party rate provider |
| Rate inversion calculation | Converted foreign-per-base to base-per-foreign |
| Graceful degradation logic | Returned "unavailable" on provider failure |

**Removed API Endpoint Code:**
```javascript
// REMOVED - was in apps/api/src/routes/exchangeRates.ts
router.get('/market-check', can('MASTER_VIEW'), async (_req, res, next) => {
  // Fetched from open.er-api.com
  // Inverted rates (foreign-per-base → base-per-foreign)
  // Returned ratesPerForeignUnit map
});
```

#### Frontend (Client):
| Component | Description |
|-----------|-------------|
| `exchangeRatesApi.marketCheck()` method | API client method removed from api.ts |
| Market rate query | `useQuery` for 'exchange-rates-market' removed |
| Market column in rates table | Table header and cell removed |
| Difference column in rates table | Percentage diff calculation removed |
| Market indicator badge | "market comparison available" text removed |
| TrendingUp icon import | Icon no longer needed |
| marketRate prop on RateRow | Component prop removed |
| market prop on NotificationModal | Component prop removed |
| Market column in notification modal | Rate entry comparison removed |

**Removed UI Elements:**
1. "Market" column header in exchange rates table
2. "Difference" column header in exchange rates table
3. Market rate value cell (showed 4 decimal places)
4. Difference percentage cell (with ±% and warning icon)
5. "market comparison available" badge with TrendingUp icon
6. Market rate column in notification entry modal

**Removed Calculations:**
```javascript
// REMOVED - was in ExchangeRates.tsx RateRow component
const diffPercent = rate.rate && marketRate 
  ? ((rate.rate - marketRate) / marketRate) * 100 
  : null;
const suspicious = diffPercent !== null && Math.abs(diffPercent) > 5;
```

**What Replaced It:**
- Nothing - exchange rates are now purely manual entry from CBIC notifications
- No automated validation against market rates
- Users must verify rates manually against official CBIC notification

**Table Column Changes:**
| Before | After |
|--------|-------|
| Currency | Currency |
| Notified Rate | Notified Rate |
| Market | *(removed)* |
| Difference | *(removed)* |
| Effective From | Effective From |
| Age | Age |
| Notification | Notification |
| Actions | Actions |

**colspan Change:** Base currency row changed from `colSpan={7}` to `colSpan={5}`

---

## 3. CALCULATIONS & BUSINESS LOGIC

### 3.1 Quotation Margin Calculation (Commit 88ad9d8)

**Previous Behavior (WRONG):**
```javascript
const totalMargin = itemsSubtotal - totalCost;
// Where totalCost = itemsCost + additionalCosts
// Additional costs (CHA, transport) REDUCED the margin
```

**New Behavior (CORRECT):**
```javascript
const totalMargin = itemsSubtotal - itemsCost;
// Additional costs do NOT reduce margin
// Margin is from line items only
```

**Formula Comparison:**

| Calculation | Previous (Wrong) | Current (Correct) |
|-------------|------------------|-------------------|
| totalMargin | subtotal - (itemsCost + additionalCosts) | subtotal - itemsCost |
| marginPercent | (margin / subtotal) * 100 | (margin / itemsCost) * 100 |

**Input Values:**
- `itemsSubtotal`: Sum of all item totalPrice values
- `itemsCost`: Sum of all item totalCost values
- `additionalCosts`: Sum of all additional cost amounts (CHA, transport, etc.)

**Output Values:**
- `totalMargin`: Profit from line items only
- `marginPercent`: Margin as percentage of cost (not of selling price)

**Implementation Location:**
- `apps/web/src/pages/NewQuotation.tsx` (lines 141-155)
- `apps/web/src/pages/QuotationDetail.tsx` (lines 119-123)

**Example Calculation:**
```
Line Item: 25 MT at cost 850/unit, price 1000/unit
- itemsCost = 25 × 850 = 21,250
- itemsSubtotal = 25 × 1000 = 25,000
- additionalCosts = 2,000 (CHA 1,200 + transport 800)

BEFORE (wrong):
- totalCost = 21,250 + 2,000 = 23,250
- margin = 25,000 - 23,250 = 1,750 ❌
- marginPercent = (1,750 / 25,000) × 100 = 7% ❌

AFTER (correct):
- totalCost = 21,250 + 2,000 = 23,250 (unchanged for display)
- margin = 25,000 - 21,250 = 3,750 ✅
- marginPercent = (3,750 / 21,250) × 100 = 17.6% ✅
```

### 3.2 Quotation Grand Total Calculation (Commit 88ad9d8)

**Previous Behavior (WRONG):**
```javascript
grandTotal: itemsSubtotal
// Additional costs were NOT billed to buyer
```

**New Behavior (CORRECT):**
```javascript
grandTotal: itemsSubtotal + additionalCostsTotal
// Additional costs ARE billed to buyer
```

**Formula:**
| Calculation | Previous (Wrong) | Current (Correct) |
|-------------|------------------|-------------------|
| grandTotal | subtotal | subtotal + additionalCosts |

**Example:**
```
- itemsSubtotal = 25,000
- additionalCosts = 2,000

BEFORE: grandTotal = 25,000 ❌ (buyer doesn't pay CHA/transport)
AFTER:  grandTotal = 27,000 ✅ (buyer pays everything)
```

**Impact on Documents:**
- Quotation PDF will show correct grand total
- Invoice amounts derived from quotation will be correct
- Order values will include additional costs

---

## 4. QUOTATION CHANGES

### 4.1 Complete Quotation Change Summary

| Aspect | Change Type | Details |
|--------|-------------|---------|
| Port of Loading | NEW FIELD | Optional dropdown, stored as portOfLoadingId |
| Port of Discharge | NEW FIELD | Optional dropdown, stored as portOfDischargeId |
| Margin Calculation | FIXED | Now excludes additional costs |
| Grand Total | FIXED | Now includes additional costs |
| marginPercent Base | CHANGED | Based on itemsCost, not subtotal |

### 4.2 Port Selection Details

**State Variables Added (NewQuotation.tsx):**
```javascript
const [portOfLoadingId, setPortOfLoadingId] = useState('');
const [portOfDischargeId, setPortOfDischargeId] = useState('');
```

**API Schema (quotations.ts):**
```javascript
portOfLoadingId: z.string().optional(),
portOfDischargeId: z.string().optional(),
```

**Data Submitted:**
```javascript
{
  ...otherFields,
  portOfLoadingId: portOfLoadingId || undefined,
  portOfDischargeId: portOfDischargeId || undefined,
}
```

**Query Include (quotation detail):**
```javascript
include: {
  portOfLoading: true,
  portOfDischarge: true,
}
```

### 4.3 Validation Changes
- Port fields are OPTIONAL (no validation required)
- Empty values sent as `undefined` to avoid empty string in database

### 4.4 UI Changes
- Two new SelectField components after Incoterm dropdown
- Options populated from `dropdowns?.data?.data?.ports`
- Display format: `${p.name} (${p.code})`

### 4.5 Backend Changes
- Zod schema updated with optional port fields
- Prisma include updated for port relations
- Ports added to `/api/master/dropdowns` response

### 4.6 Database
- No schema changes (portOfLoadingId and portOfDischargeId already existed in schema)
- Relations: `Port @relation("QuotationLoadingPort")` and `Port @relation("QuotationDischargePort")`

---

## 5. FRONTEND CHANGES

### 5.1 Pages Changed

| Page | File | Changes |
|------|------|---------|
| ExchangeRates | ExchangeRates.tsx | Removed market comparison UI, columns, props |
| NewQuotation | NewQuotation.tsx | Added port dropdowns, fixed calculations |
| QuotationDetail | QuotationDetail.tsx | Fixed margin calculation |
| Login | Login.tsx | Replaced Ship icon with logo images |
| Layout | Layout.tsx | Replaced Ship icon with logo image |

### 5.2 Components Changed

| Component | File | Changes |
|-----------|------|---------|
| Layout | Layout.tsx | Logo image instead of Ship icon |
| RateRow | ExchangeRates.tsx | Removed marketRate prop, diff calculation |
| NotificationModal | ExchangeRates.tsx | Removed market prop, market column |

### 5.3 Icons/Images Changed

| Location | Before | After |
|----------|--------|-------|
| Layout sidebar | `<Ship className="w-8 h-8 text-gold-500" />` | `<img src="/logo.png" className="w-10 h-10" />` |
| Login desktop | `<Ship className="w-20 h-20 text-gold-500" />` | `<img src="/logo.png" className="w-24 h-24" />` |
| Login mobile | `<Ship className="w-12 h-12 text-navy-900" />` | `<img src="/logo-blue.png" className="w-16 h-16" />` |

### 5.4 Imports Changed

| File | Removed Import |
|------|----------------|
| Layout.tsx | `Ship` from lucide-react |
| Login.tsx | `Ship` from lucide-react |
| ExchangeRates.tsx | `TrendingUp` from lucide-react |

### 5.5 State Changes

| Page | State Added |
|------|-------------|
| NewQuotation.tsx | `portOfLoadingId`, `portOfDischargeId` |

| Page | State Removed |
|------|---------------|
| ExchangeRates.tsx | `market` query removed |

### 5.6 API Calls Changed

| Page | API Call | Change |
|------|----------|--------|
| ExchangeRates.tsx | `exchangeRatesApi.marketCheck()` | REMOVED |
| NewQuotation.tsx | Uses `dropdowns` | Now includes ports |

### 5.7 Calculation Changes

| Page | Calculation | Before | After |
|------|-------------|--------|-------|
| NewQuotation.tsx | totalMargin | `subtotal - totalCost` | `subtotal - itemsCost` |
| NewQuotation.tsx | marginPercent | `margin / subtotal` | `margin / itemsCost` |
| NewQuotation.tsx | grandTotal | `subtotal` | `subtotal + additionalCosts` |
| QuotationDetail.tsx | margin | `itemsTotal - totalCost` | `itemsTotal - itemsCost` |
| QuotationDetail.tsx | marginPercent | `margin / itemsTotal` | `margin / itemsCost` |
| ExchangeRates.tsx | diffPercent | Calculated from market | REMOVED |

---

## 6. BACKEND CHANGES

### 6.1 API Changes

| Endpoint | Method | Change |
|----------|--------|--------|
| `/api/exchange-rates/market-check` | GET | REMOVED |
| `/api/master/dropdowns` | GET | Added `ports` array |
| `/api/quotations` | POST | Added `portOfLoadingId`, `portOfDischargeId` |
| `/api/quotations/:id` | GET | Include `portOfLoading`, `portOfDischarge` |

### 6.2 Routes Changed

| File | Change |
|------|--------|
| exchangeRates.ts | Removed 52 lines (market-check endpoint) |
| masterData.ts | Added port query and ports to response |
| quotations.ts | Added port fields to schema and includes |

### 6.3 Removed Services/Functions

| Service | Function | Description |
|---------|----------|-------------|
| exchangeRates.ts | market-check handler | External API call to open.er-api.com |

### 6.4 Database Queries

**Added Query (masterData.ts):**
```javascript
prisma.port.findMany({ 
  where: { isActive: true }, 
  select: { 
    id: true, 
    name: true, 
    code: true, 
    type: true, 
    country: { select: { name: true } } 
  }, 
  orderBy: { name: 'asc' } 
})
```

**Added Include (quotations.ts):**
```javascript
portOfLoading: true,
portOfDischarge: true,
```

---

## 7. DATA FLOW

### 7.1 Port Selection Flow

```
User Action: Select port in dropdown
    ↓
Frontend State: setPortOfLoadingId(value)
    ↓
Form Submit: { ...data, portOfLoadingId, portOfDischargeId }
    ↓
API Call: POST /api/quotations
    ↓
Backend Validation: z.string().optional()
    ↓
Prisma Create: data: { ...data, portOfLoadingId, portOfDischargeId }
    ↓
Database: quotations table (port_of_loading_id, port_of_discharge_id)
    ↓
Response: { success: true, data: quotation }
    ↓
UI: Navigate to /quotations/{id}
    ↓
Detail Query: include: { portOfLoading: true, portOfDischarge: true }
    ↓
Display: Show port names in quotation detail
```

### 7.2 Quotation Calculation Flow

```
User Input: Add line items and additional costs
    ↓
Frontend Calculation (useMemo):
  - itemsSubtotal = Σ(item.totalPrice)
  - itemsCost = Σ(item.totalCost)
  - additionalCostsTotal = Σ(cost.amount)
  - totalCost = itemsCost + additionalCostsTotal
  - totalMargin = itemsSubtotal - itemsCost  ← CHANGED
  - marginPercent = (totalMargin / itemsCost) * 100  ← CHANGED
  - grandTotal = itemsSubtotal + additionalCostsTotal  ← CHANGED
    ↓
Display: Show in summary panel
    ↓
Submit: POST /api/quotations
    ↓
Backend Calculation (same logic)
    ↓
Database: Store all calculated values
    ↓
Detail View: Recalculate for display consistency
```

---

## 8. FILE-BY-FILE CHANGES

### 8.1 apps/api/src/routes/exchangeRates.ts
- **What Changed:** Removed `/market-check` endpoint (52 lines)
- **Why:** Removed automated market rate comparison feature
- **Impact:** No external API calls, no market validation
- **Type:** Backend

### 8.2 apps/api/src/routes/masterData.ts
- **What Changed:** Added ports to dropdowns query and response
- **Why:** Support port selection in quotations
- **Impact:** Ports available in all dropdown consumers
- **Type:** Backend

### 8.3 apps/api/src/routes/quotations.ts
- **What Changed:** 
  - Added `portOfLoadingId`, `portOfDischargeId` to create schema
  - Added port relations to detail query include
- **Why:** Enable port selection feature
- **Impact:** Quotations can store and display ports
- **Type:** Backend

### 8.4 apps/web/src/lib/api.ts
- **What Changed:** Removed `marketCheck` method from exchangeRatesApi
- **Why:** Endpoint no longer exists
- **Impact:** No frontend call to market-check
- **Type:** Frontend

### 8.5 apps/web/src/pages/ExchangeRates.tsx
- **What Changed:**
  - Removed TrendingUp import
  - Removed market query
  - Removed market columns from table
  - Removed marketRate prop from RateRow
  - Removed market prop from NotificationModal
  - Removed diffPercent calculation
  - Changed colspan from 7 to 5
- **Why:** Removed market comparison feature
- **Impact:** Simpler exchange rate UI, manual entry only
- **Type:** Frontend

### 8.6 apps/web/src/pages/NewQuotation.tsx
- **What Changed:**
  - Added port state variables
  - Added port dropdowns UI
  - Fixed margin calculation (subtotal - itemsCost)
  - Fixed marginPercent calculation (margin / itemsCost)
  - Fixed grandTotal calculation (subtotal + additionalCosts)
- **Why:** Port selection feature + calculation fixes
- **Impact:** Correct quotation totals, port selection available
- **Type:** Frontend

### 8.7 apps/web/src/pages/QuotationDetail.tsx
- **What Changed:**
  - Fixed margin calculation (itemsTotal - itemsCost)
  - Fixed marginPercent calculation (margin / itemsCost)
- **Why:** Match corrected calculation logic
- **Impact:** Quotation detail shows correct margin
- **Type:** Frontend

### 8.8 apps/web/src/pages/Login.tsx
- **What Changed:**
  - Removed Ship icon import
  - Desktop: Ship → logo.png (w-24 h-24)
  - Mobile: Ship → logo-blue.png (w-16 h-16)
- **Why:** Use actual branding instead of generic icon
- **Impact:** Professional logo display
- **Type:** Frontend/Assets

### 8.9 apps/web/src/components/Layout.tsx
- **What Changed:**
  - Removed Ship icon import
  - Sidebar: Ship → logo.png (w-10 h-10)
- **Why:** Use actual branding
- **Impact:** Logo in sidebar navigation
- **Type:** Frontend/Assets

---

## 9. BEFORE vs AFTER

### 9.1 Exchange Rates Page

| Aspect | Before | After |
|--------|--------|-------|
| Table Columns | 8 columns | 6 columns |
| Market Rate | Shown (fetched from API) | Not shown |
| Difference % | Calculated and shown | Not shown |
| Warning Icon | Shown when diff > 5% | Not shown |
| Header Badge | "market comparison available" | None |
| External API | Calls open.er-api.com | No external calls |
| Rate Entry Modal | Shows market rate column | No market column |

### 9.2 New Quotation Page

| Aspect | Before | After |
|--------|--------|-------|
| Port Selection | Not available | 2 dropdowns |
| Margin Calc | Wrong (included additional costs) | Correct (line items only) |
| Grand Total | Wrong (excluded additional costs) | Correct (includes all) |
| Margin % Base | Based on subtotal | Based on itemsCost |

### 9.3 Quotation Detail Page

| Aspect | Before | After |
|--------|--------|-------|
| Margin Display | Wrong calculation | Correct calculation |
| Margin % | Based on subtotal | Based on itemsCost |
| Port Display | Not shown | Shows port names |

### 9.4 Login Page

| Aspect | Before | After |
|--------|--------|-------|
| Desktop Logo | Ship icon (gold) | logo.png image |
| Mobile Logo | Ship icon (navy) | logo-blue.png image |
| Logo Size | w-20/w-12 | w-24/w-16 |

### 9.5 Sidebar

| Aspect | Before | After |
|--------|--------|-------|
| Logo | Ship icon | logo.png image |
| Logo Size | w-8 h-8 | w-10 h-10 |

---

## 10. REGRESSION / IMPACT ANALYSIS

### 10.1 Potential Impacts

| Area | Impact | Risk Level |
|------|--------|------------|
| Exchange Rate Entry | No market rate validation | LOW - Manual verification still works |
| Existing Quotations | Margin displays differently on detail view | MEDIUM - Historical data unchanged in DB |
| Order Creation | No change to conversion logic | LOW |
| Invoice Generation | Grand total now includes additional costs | HIGH - Affects billing |
| PDF Generation | Will reflect new calculations | MEDIUM - Verify PDF templates |
| Reports | Margin reports may show different percentages | MEDIUM - Verify report queries |

### 10.2 Calculation Dependencies

| Dependent System | Impact |
|------------------|--------|
| Quotation PDF | Will show new grandTotal formula |
| Order from Quotation | Uses quotation.grandTotal |
| Invoice from Order | Derived from order values |
| Dashboard Metrics | Uses stored grandTotal values |
| Finance Reports | Margin calculations affected |

### 10.3 API Consumers

| Endpoint | Impact |
|----------|--------|
| GET /exchange-rates/market-check | REMOVED - Any caller will get 404 |
| GET /master/dropdowns | Returns additional `ports` array |
| POST /quotations | Accepts new optional fields |
| GET /quotations/:id | Returns port relations |

### 10.4 Potential Issues

1. **Historical Data Mismatch:** Old quotations have grandTotal = subtotal, new ones have grandTotal = subtotal + additionalCosts. Comparison reports may show inconsistencies.

2. **Margin Percentage Display:** Old quotations calculated margin % on subtotal, new ones on itemsCost. Same absolute margin shows different percentages.

3. **Logo Files Required:** logo.png and logo-blue.png must exist in /public folder or UI will show broken images.

4. **Port Data Required:** If no ports exist in database, dropdowns will be empty.

---

## 11. CURRENT IMPLEMENTATION VERIFICATION

All changes have been verified in the current codebase:

| Change | Status | Evidence |
|--------|--------|----------|
| market-check API removed | ✅ VERIFIED | No match in exchangeRates.ts |
| marketCheck client removed | ✅ VERIFIED | No match in api.ts |
| Market UI removed | ✅ VERIFIED | No TrendingUp, no marketRate |
| Ports in dropdowns | ✅ VERIFIED | prisma.port.findMany present |
| Port schema fields | ✅ VERIFIED | portOfLoadingId.optional() present |
| Port UI in NewQuotation | ✅ VERIFIED | 8 port references found |
| Logo in Layout | ✅ VERIFIED | src="/logo.png" present |
| Logo in Login | ✅ VERIFIED | src="/logo patterns found |
| Ship removed from Layout | ✅ VERIFIED | No Ship import |
| Ship removed from Login | ✅ VERIFIED | No Ship import |
| Margin calc fixed | ✅ VERIFIED | `itemsSubtotal - itemsCost` |
| Grand total fixed | ✅ VERIFIED | `itemsSubtotal + additionalCostsTotal` |

---

## COMPLETE CHANGE SUMMARY

### Features Added
1. **Port Selection in Quotations** - Two optional dropdowns for Port of Loading and Port of Discharge

### Features Removed
1. **Market Rate Comparison** - Removed automated exchange rate validation against live market rates from open.er-api.com

### Calculations Fixed
1. **Margin Calculation** - Now calculated from line items only (excludes additional costs like CHA, transport)
2. **Grand Total Calculation** - Now includes additional costs (buyer pays for everything)
3. **Margin Percentage Base** - Changed from subtotal to itemsCost for accurate cost-based margin %

### UI Changes
1. **Exchange Rates Table** - Reduced from 8 to 6 columns (removed Market, Difference)
2. **Logo Branding** - Replaced Ship icon with actual logo images throughout
3. **Port Dropdowns** - Added to quotation form after Incoterm field

### API Changes
1. **Removed:** `GET /api/exchange-rates/market-check`
2. **Modified:** `GET /api/master/dropdowns` - Added ports array
3. **Modified:** `POST /api/quotations` - Added portOfLoadingId, portOfDischargeId
4. **Modified:** `GET /api/quotations/:id` - Includes port relations

### Files Modified
- Backend: exchangeRates.ts, masterData.ts, quotations.ts
- Frontend: api.ts, ExchangeRates.tsx, NewQuotation.tsx, QuotationDetail.tsx, Login.tsx, Layout.tsx

### Business Logic Summary
```
QUOTATION CALCULATIONS (CURRENT):
  itemsSubtotal    = Σ(item.quantity × item.unitPrice)
  itemsCost        = Σ(item.quantity × item.unitCost)
  additionalCosts  = Σ(additional cost amounts)
  totalCost        = itemsCost + additionalCosts
  totalMargin      = itemsSubtotal - itemsCost           ← margin from goods only
  marginPercent    = (totalMargin / itemsCost) × 100    ← cost-based percentage
  grandTotal       = itemsSubtotal + additionalCosts    ← buyer pays everything
```

---

*End of Functional Change Analysis Report*
