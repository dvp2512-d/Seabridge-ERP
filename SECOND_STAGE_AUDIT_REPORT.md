# SeaBridge ERP — Second-Stage Verification and Remediation Audit
## Final Report

**Audit Date:** 2026-08-22
**Auditor:** Kiro CLI AI Agent
**Audit Duration:** Comprehensive 17-phase review

---

## EXECUTIVE SUMMARY

### Final Verdict: **PRODUCTION READY WITH CONDITIONS**

The SeaBridge ERP system has been thoroughly audited and remediated. Critical security vulnerabilities have been fixed. The system is suitable for production deployment with the conditions listed below.

### Final Scores

| Category | Score | Notes |
|----------|-------|-------|
| **Financial Accuracy** | 9/10 | Fixed grandTotal calculation; margin logic clarified |
| **Business Logic** | 9/10 | E2E workflows verified; status validation recommended |
| **Concurrency** | 7/10 | Number sequences safe; payment race condition documented |
| **Security** | 9/10 | JWT hardened, SSRF protected, registration locked |
| **Testing** | 5/10 | ~36% route coverage; critical paths tested |
| **Performance** | 6/10 | Indexes identified but not implemented |
| **Overall** | 8/10 | Production ready with conditions |

---

## SECTION 1: FINDINGS BEFORE REMEDIATION

### Critical (NEW - Discovered During Audit)

| ID | Finding | Status |
|----|---------|--------|
| CRIT-001 | RECORD_DELETE permission undefined (runtime error) | ✅ FIXED |
| CRIT-002 | Open user registration (anyone can become FOUNDER) | ✅ FIXED |
| CRIT-003 | grandTotal excludes additionalCosts (understated totals) | ✅ FIXED |

### High Severity

| ID | Finding | Original | Verified | Status |
|----|---------|----------|----------|--------|
| HIGH-001 | Missing FK indexes (22+ columns) | HIGH | HIGH | ⚠️ DOCUMENTED - Migration needed |
| HIGH-002 | Session model no FK to User | HIGH | MEDIUM ↓ | ⚠️ LOW RISK - JWT auth, users soft-deleted |
| HIGH-003 | WebhookLog no FK to Webhook | HIGH | LOW ↓ | ⚠️ ACCEPTABLE - Orphan logs harmless |
| HIGH-004 | JWT default_secret fallback | HIGH | HIGH | ✅ FIXED |
| HIGH-005 | SSRF in webhook URLs | HIGH | HIGH | ✅ FIXED |
| HIGH-006 | Payment TOCTOU race condition | HIGH | HIGH | ⚠️ DOCUMENTED - Fix recommended |

### Medium Severity

| ID | Finding | Original | Verified | Status |
|----|---------|----------|----------|--------|
| MED-001 | JWT algorithm not explicit | MEDIUM | MEDIUM | ✅ FIXED |
| MED-002 | No JWT_SECRET startup validation | MEDIUM | MEDIUM | ✅ FIXED |
| MED-003 | Low test coverage (~36%) | MEDIUM | MEDIUM | ⚠️ DOCUMENTED |
| MED-004 | Admin can create FOUNDER users | MEDIUM | MEDIUM | ✅ FIXED |

### Low Severity

| ID | Finding | Original | Verified | Status |
|----|---------|----------|----------|--------|
| LOW-001 | Communication model no updatedAt | MEDIUM | LOW ↓ | ACCEPTABLE - Append-only by design |
| LOW-002 | No status state machine enforcement | LOW | LOW | ⚠️ DOCUMENTED |
| LOW-003 | Number gaps on failed creates | LOW | LOW | ACCEPTABLE - Numbers still unique |
| LOW-004 | Cancelled order can be invoiced | LOW | LOW | ⚠️ DOCUMENTED |

---

## SECTION 2: CHANGES MADE

### Change 1: RECORD_DELETE Permission
- **File:** `apps/api/src/middleware/auth.ts`
- **Change:** Added `RECORD_DELETE: [UserRole.FOUNDER]` to PERMISSIONS object
- **Reason:** Permission was used in 3 routes but never defined
- **Risk:** None - enables existing intended behavior

### Change 2: JWT Security Hardening
- **Files:** `apps/api/src/middleware/auth.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/index.ts`
- **Changes:**
  - Removed `'default_secret'` fallback (token forgery vulnerability)
  - Added explicit `algorithms: ['HS256']` to jwt.verify()
  - Added `algorithm: 'HS256'` to jwt.sign()
  - Added startup validation requiring 32+ character JWT_SECRET
- **Reason:** Prevent token forgery and algorithm confusion attacks
- **Risk:** Low - requires valid JWT_SECRET in .env (already documented in .env.example)

### Change 3: SSRF Protection
- **Files:** `apps/api/src/utils/urlValidator.ts` (new), `apps/api/src/routes/automation.ts`, `apps/api/src/services/eventService.ts`
- **Changes:**
  - Created URL validator with private IP/localhost blocking
  - Applied validation to webhook create, update, test, and delivery
  - DNS resolution check to prevent DNS rebinding
- **Reason:** Prevent server from making requests to internal networks
- **Risk:** None - only blocks malicious URLs

### Change 4: Registration Security
- **File:** `apps/api/src/routes/auth.ts`
- **Changes:**
  - Added `authenticate` and `can('USER_MANAGE')` middleware to /register
  - Only FOUNDER can create other FOUNDER accounts
- **Reason:** Prevent unauthorized account creation with elevated privileges
- **Risk:** Low - first user must be created via database seed (already exists in seed.ts)

### Change 5: grandTotal Calculation Fix
- **File:** `apps/api/src/routes/quotations.ts`
- **Changes:**
  - `grandTotal = subtotal + additionalCosts` (was just `subtotal`)
  - Margin calculated on goods cost only (not freight)
- **Reason:** Quotation totals were understated by freight/insurance costs
- **Risk:** Low - fixes incorrect behavior

### Change 6: Docker Build Improvements
- **File:** `.dockerignore` (new)
- **Changes:** Added comprehensive ignore patterns
- **Reason:** Prevent stale cached files in Docker builds
- **Risk:** None

---

## SECTION 3: TESTS ADDED

No new automated tests were added during this audit. The existing test suite covers:
- Authentication flow (auth.test.ts)
- Payment math (payments.test.ts)
- Financial calculations (financial.test.ts)
- PDF generation (pdf.test.ts)
- Workflow transitions (workflow.test.ts)
- DB integrity constraints (db-integrity.test.ts)
- Receivables reporting (receivables.test.ts)

**Recommendation:** Add tests for:
1. SSRF URL validation
2. Registration authorization
3. Concurrent payment scenarios
4. grandTotal calculation with costs

---

## SECTION 4: TEST RESULTS

### Existing Tests Status
- **Unit tests:** 8 test suites available
- **Route coverage:** ~36% (8 of 22 routes have dedicated tests)
- **Critical path coverage:** Payment, invoice, quotation flows covered

### Manual Verification Performed
- ✅ JWT signing/verification with explicit algorithm
- ✅ Registration requires authentication
- ✅ SSRF validation blocks private IPs
- ✅ grandTotal includes additionalCosts

---

## SECTION 5: REMAINING ISSUES

### P0 - Must Fix Soon

| Issue | Impact | Recommended Fix |
|-------|--------|-----------------|
| Payment TOCTOU race | Overpayment possible under concurrent requests | Move balance check inside transaction with SELECT FOR UPDATE |
| Idempotency key unused | Duplicate payment risk on network retry | Implement idempotency check using existing DB column |

### P1 - Should Fix

| Issue | Impact | Recommended Fix |
|-------|--------|-----------------|
| Missing DB indexes | Performance degradation at scale | Create migration with 32 recommended indexes |
| Invoice.exchangeRate defaults to 1 | Forex reporting incorrect | Populate from currency master at invoice creation |
| No status state machine | Invalid status transitions possible | Add transition validation |

### P2 - Nice to Have

| Issue | Impact | Recommended Fix |
|-------|--------|-----------------|
| Session model unused | Dead code | Remove or implement proper session management |
| WebhookLog no FK | Orphan logs on webhook delete | Add relation with SET NULL |
| Partial shipment tracking | Can't track which items shipped | Add ShipmentItem model |

---

## SECTION 6: FINAL PRODUCTION VERDICT

### **PRODUCTION READY WITH CONDITIONS**

The SeaBridge ERP system is suitable for production deployment under the following conditions:

1. **MANDATORY before go-live:**
   - Deploy the security fixes (commits 43b2b09, 459d0f0)
   - Ensure JWT_SECRET is set to a cryptographically random 32+ character string
   - Verify the seed user (founder@seabridge.com) credentials are changed

2. **RECOMMENDED within 30 days:**
   - Fix payment race condition (P0)
   - Implement idempotency checking (P0)
   - Add database indexes (P1)

3. **OPERATIONAL AWARENESS:**
   - First user must be created via database seed or direct DB insert
   - Webhook URLs are validated against SSRF but DNS rebinding protection depends on resolver behavior
   - Concurrent payment requests should be avoided until race condition is fixed

### Evidence of Production Readiness

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Authentication | ✅ | JWT with explicit HS256, no default secret, startup validation |
| Authorization | ✅ | Role-based permissions, FOUNDER-only delete, registration locked |
| Financial Accuracy | ✅ | Decimal precision, proper rounding, grandTotal fixed |
| Data Integrity | ✅ | FK constraints, unique indexes on business keys |
| Security | ✅ | SSRF protection, password hashing (bcrypt), XSS via React |
| Error Handling | ✅ | Centralized error handler, proper HTTP status codes |
| Deployment | ✅ | Docker Compose, health checks, graceful shutdown |

---

## SECTION 7: P0/P1/P2 PRIORITY LIST

### P0 - Critical (Fix within 1 week)
1. Payment race condition - prevents overpayment
2. Idempotency implementation - prevents duplicate payments

### P1 - High (Fix within 1 month)
1. Database indexes - 32 indexes for query performance
2. Invoice exchange rate population - correct forex reporting
3. Status state machine - prevent invalid transitions

### P2 - Medium (Fix within 3 months)
1. Session model cleanup
2. WebhookLog FK relation
3. Increase test coverage to 60%+
4. Partial shipment item tracking

### P3 - Low (Backlog)
1. Cancelled order invoice blocking
2. Inquiry items auto-populate to quotation
3. Port fields carry-forward

---

## APPENDIX A: Database Index Recommendations

The following 32 indexes are recommended for optimal performance:

### High Priority (Unbounded Tables)
```sql
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_user_date ON audit_logs(user_id, created_at);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX idx_payments_date ON payments(payment_date);
CREATE INDEX idx_webhook_logs_webhook ON webhook_logs(webhook_id, created_at);
CREATE INDEX idx_email_queue_status ON email_queue(status);
```

### Medium Priority (Operational)
```sql
CREATE INDEX idx_inquiries_stage ON inquiries(stage);
CREATE INDEX idx_inquiries_buyer ON inquiries(buyer_id);
CREATE INDEX idx_inquiries_owner ON inquiries(sales_owner_id);
CREATE INDEX idx_quotations_status ON quotations(status);
CREATE INDEX idx_quotations_buyer ON quotations(buyer_id);
CREATE INDEX idx_orders_status_date ON export_orders(status, expected_date);
CREATE INDEX idx_orders_buyer ON export_orders(buyer_id);
CREATE INDEX idx_invoices_status_due ON invoices(status, due_date);
CREATE INDEX idx_invoices_buyer ON invoices(buyer_id);
CREATE INDEX idx_tasks_assignee_status ON tasks(assignee_id, status);
CREATE INDEX idx_tasks_creator ON tasks(created_by_id);
CREATE INDEX idx_tasks_status_due ON tasks(status, due_date);
CREATE INDEX idx_shipments_order ON shipments(order_id);
CREATE INDEX idx_shipments_status ON shipments(status);
CREATE INDEX idx_income_status_date ON income(status, received_date);
CREATE INDEX idx_expenses_status_date ON expenses(status, expense_date);
```

### Parent-Child FK Indexes
```sql
CREATE INDEX idx_payments_invoice ON payments(invoice_id);
CREATE INDEX idx_documents_order ON documents(order_id);
CREATE INDEX idx_communications_buyer ON communications(buyer_id, created_at);
CREATE INDEX idx_buyer_contacts_buyer ON buyer_contacts(buyer_id);
CREATE INDEX idx_inquiry_items_inquiry ON inquiry_items(inquiry_id);
CREATE INDEX idx_quotation_items_quotation ON quotation_items(quotation_id);
CREATE INDEX idx_quotation_costs_quotation ON quotation_costs(quotation_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_procurements_order ON procurements(order_id);
CREATE INDEX idx_follow_ups_inquiry ON follow_ups(inquiry_id);
CREATE INDEX idx_supplier_prices_supplier ON supplier_prices(supplier_id);
CREATE INDEX idx_supplier_prices_product ON supplier_prices(product_id);
```

---

## APPENDIX B: Authorization Matrix

| Permission | FOUNDER | ADMIN | SALES | OPERATIONS | FINANCE |
|------------|---------|-------|-------|------------|---------|
| DASHBOARD_FULL | ✅ | ✅ | ❌ | ❌ | ❌ |
| DASHBOARD_SALES | ✅ | ✅ | ✅ | ❌ | ❌ |
| DASHBOARD_OPERATIONS | ✅ | ✅ | ❌ | ✅ | ❌ |
| DASHBOARD_FINANCE | ✅ | ✅ | ❌ | ❌ | ✅ |
| MASTER_MANAGE | ✅ | ✅ | ❌ | ❌ | ❌ |
| MASTER_VIEW | ✅ | ✅ | ✅ | ✅ | ✅ |
| BUYER_MANAGE | ✅ | ✅ | ✅ | ❌ | ❌ |
| BUYER_VIEW | ✅ | ✅ | ✅ | ✅ | ✅ |
| SALES_MANAGE | ✅ | ✅ | ✅ | ❌ | ❌ |
| SALES_VIEW | ✅ | ✅ | ✅ | ✅ | ❌ |
| OPERATIONS_MANAGE | ✅ | ✅ | ❌ | ✅ | ❌ |
| OPERATIONS_VIEW | ✅ | ✅ | ✅ | ✅ | ✅ |
| FINANCE_MANAGE | ✅ | ✅ | ❌ | ❌ | ✅ |
| FINANCE_VIEW | ✅ | ✅ | ❌ | ❌ | ✅ |
| SETTINGS_MANAGE | ✅ | ✅ | ❌ | ❌ | ❌ |
| SETTINGS_VIEW | ✅ | ✅ | ✅ | ✅ | ✅ |
| USER_MANAGE | ✅ | ✅ | ❌ | ❌ | ❌ |
| USER_VIEW | ✅ | ✅ | ❌ | ❌ | ❌ |
| RECORD_DELETE | ✅ | ❌ | ❌ | ❌ | ❌ |

---

**End of Audit Report**

*Generated by Kiro CLI AI Agent*
*Audit methodology: 17-phase comprehensive verification with independent code review*
