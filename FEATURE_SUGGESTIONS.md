# SeaBridge ERP - Feature & Automation Suggestions

**Analysis Date:** 2026-09-15  
**Purpose:** Maximize productivity by reducing repetitive data entry and leveraging existing automation capabilities

---

## 🎯 Executive Summary

After analyzing the entire codebase, I've identified **existing features you may not be using** and **improvements that can be implemented** to significantly reduce manual data entry. The system already has powerful automation foundations - the key is configuring them properly.

---

## ✅ EXISTING FEATURES TO ACTIVATE (No Code Changes Needed)

### 1. Buyer Defaults Auto-Fill
**What it does:** When you select a buyer in quotations/invoices, the system automatically pulls:
- Payment terms
- Credit days (for due date calculation)
- Preferred currency
- Suggested port of discharge (based on buyer's country)

**How to use:**
1. Go to each buyer's profile
2. Fill in: Payment Terms, Credit Days, Currency, Country
3. When creating quotations, these fields auto-populate

**Time saved:** ~2 minutes per quotation/invoice

---

### 2. Webhook Automation (Settings → Webhooks)
**Available Events:**
- `inquiry.created` - New inquiry received
- `quotation.created` / `quotation.sent` / `quotation.accepted`
- `order.created` / `order.status_changed` / `order.shipped` / `order.delivered`
- `invoice.created` / `invoice.paid` / `invoice.overdue`
- `payment.received`
- `shipment.created` / `shipment.departed` / `shipment.arrived`
- `expense.approved` / `expense.paid`

**Use cases:**
- Send Slack/Teams notification when order ships
- Update external accounting system when invoice paid
- Notify warehouse when order confirmed
- Alert sales when quotation accepted

---

### 3. Automation Rules (Settings → Automation)
**Currently supported action:** CREATE_TASK

**Example configurations:**

```json
// Auto-create follow-up task when quotation sent
{
  "name": "Follow up on sent quotations",
  "trigger": "quotation.sent",
  "actions": {
    "type": "CREATE_TASK",
    "title": "Follow up on quotation {{quotation.number}}",
    "assigneeId": "<sales-user-id>",
    "dueInDays": 3,
    "priority": "HIGH"
  }
}

// Remind operations when order confirmed
{
  "name": "Start procurement on new order",
  "trigger": "order.created",
  "actions": {
    "type": "CREATE_TASK",
    "title": "Initiate procurement for {{order.number}}",
    "assigneeId": "<operations-user-id>",
    "dueInDays": 1,
    "priority": "HIGH"
  }
}

// Finance task when invoice overdue
{
  "name": "Collection follow-up",
  "trigger": "invoice.overdue",
  "actions": {
    "type": "CREATE_TASK",
    "title": "Follow up on overdue invoice {{invoice.number}}",
    "assigneeId": "<finance-user-id>",
    "dueInDays": 1,
    "priority": "URGENT"
  }
}
```

---

### 4. Supplier Price Lists
**What it does:** Store product prices per supplier, auto-populated in quotation costing

**Setup:**
1. Go to Suppliers → Select supplier → Add Prices
2. Enter product, price per unit, effective date
3. When creating quotation items, supplier prices auto-fill

---

### 5. CHA & Transporter Rate Cards
**What it does:** Store port-based CHA rates and route-based transport rates

**Setup:**
1. CHA Agents → Select CHA → Add Rates (per port)
2. Transporters → Select → Add Rates (per route/distance)
3. Additional costs in quotations can reference these

---

### 6. Product Defaults
**What it does:** Default packaging type and weight per product

**Setup:**
1. Products → Edit product
2. Set: Default Package Type (BAGS, CTN, DRUMS, etc.)
3. Set: Default Package Weight (kg per package)
4. These auto-fill when creating orders from quotations

---

### 7. Inquiry → Quotation → Order Flow
**Auto-carried fields:**
- Product specifications from inquiry
- Package type and weight
- Buyer details and payment terms
- Port of loading/discharge

**Best practice:** Start with detailed inquiries - data flows through the entire chain

---

### 8. Bulk Operations (Available Now)
**Accessible via:** Select multiple items → Bulk Actions button

- **Orders:** Bulk update status (e.g., mark multiple as "Shipped")
- **Invoices:** Bulk update status
- **Expenses:** Bulk approve pending expenses
- **Tasks:** Bulk complete tasks
- **Inquiries:** Bulk update stage

---

### 9. Keyboard Shortcuts
Press `?` to see all shortcuts:
- `g + d` → Dashboard
- `g + b` → Buyers
- `g + i` → Inquiries
- `g + q` → Quotations
- `g + o` → Orders
- `g + f` → Invoices (Finance)
- `g + e` → Expenses
- `/` → Global search

---

### 10. CSV Exports
**Available exports:**
- Invoices (with date range)
- Orders (with date range)
- Buyers
- Expenses
- Receivables report
- Quotations
- Audit log (Founder only)

---

## 🚀 SUGGESTED IMPROVEMENTS (Require Development)

### Priority 1: High Impact, Moderate Effort

#### 1.1 Email Templates with Auto-Send
**Current state:** Email templates exist but SMTP not configured
**Improvement:**
- Configure SMTP in docker-compose
- Add "Send Quotation" button that emails PDF directly
- Add "Payment Reminder" for overdue invoices
- Auto-send invoice when created

**Implementation:** Configure these env vars in `.env`:
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@company.com
SMTP_PASS=app-password
SMTP_FROM=invoices@company.com
SMTP_FROM_NAME=SeaBridge Exports
```

---

#### 1.2 Recurring Expense Templates
**Problem:** Same expenses entered monthly (rent, salaries, utilities)
**Solution:** Create expense templates with:
- Recurrence pattern (monthly, quarterly)
- Auto-generate on schedule
- Pre-filled vendor, category, amount

---

#### 1.3 Order-to-Procurement Auto-Generation
**Current:** Must manually create procurement for each supplier
**Improvement:** "Auto-Generate Procurements" button that:
- Groups order items by supplier
- Creates one PO per supplier
- Pre-fills quantities and prices from order

---

#### 1.4 Smart Due Date Calculation
**Current:** Manual due date entry
**Improvement:**
- Invoice due = Invoice date + Buyer's credit days
- Auto-mark overdue daily via scheduled job
- Dashboard alert for "Due this week"

---

### Priority 2: Medium Impact

#### 2.1 Clone/Duplicate Records
- Clone quotation (for similar orders)
- Clone order (for repeat customers)
- Clone expense (for recurring)

#### 2.2 Saved Search Filters
- Save frequently used filter combinations
- "My pending orders" / "Overdue invoices" / "This month's quotations"

#### 2.3 Document Generation Queue
- Generate multiple PDFs in background
- "Download all order documents as ZIP"

#### 2.4 Buyer Communication Templates
- Pre-written email templates for common scenarios
- "Order confirmation" / "Shipment notification" / "Payment receipt"

---

### Priority 3: Nice to Have

#### 3.1 Mobile-Responsive Dashboard
- Key metrics viewable on phone
- Quick actions: Approve expense, complete task

#### 3.2 Calendar View for Tasks
- Visual timeline of due dates
- Drag-drop to reschedule

#### 3.3 Notification Center
- In-app notifications for events
- "Invoice #123 was paid" / "Order #456 shipped"

---

## 📋 RECOMMENDED SETUP CHECKLIST

### Week 1: Foundation Data
- [ ] Complete all buyer profiles (payment terms, credit days, country, currency)
- [ ] Enter product defaults (package type, weight)
- [ ] Add supplier price lists for top 20 products
- [ ] Configure CHA rates for your main ports
- [ ] Set up transporter routes

### Week 2: Automation Rules
- [ ] Create "Follow up sent quotations" rule
- [ ] Create "Start procurement" rule
- [ ] Create "Collection reminder" rule
- [ ] Test webhook to Slack/Teams (if used)

### Week 3: Templates & Processes
- [ ] Configure SMTP for email
- [ ] Create email templates (quotation, invoice, reminder)
- [ ] Train team on keyboard shortcuts
- [ ] Set up CSV export schedule for accounting

---

## 💡 QUICK WINS (Do Today)

1. **Fill buyer payment terms** → Due dates auto-calculate
2. **Fill product package defaults** → Packing auto-fills on orders
3. **Create one automation rule** → Tasks auto-assign
4. **Learn keyboard shortcuts** → Navigate 2x faster

---

## 📊 TIME SAVINGS ESTIMATE

| Feature | Manual Time | Automated | Savings/Month |
|---------|-------------|-----------|---------------|
| Buyer defaults | 2 min/doc | 0 | 2 hours |
| Supplier prices | 5 min/quote | 1 min | 3 hours |
| Auto tasks | 1 min/task | 0 | 1 hour |
| Bulk operations | 30 sec/item | 5 sec | 2 hours |
| Keyboard shortcuts | - | - | 1 hour |
| **Total** | | | **~9 hours/month** |

---

## 🔧 CONFIGURATION HELP

Need help setting up any of these features? The system is ready - it just needs configuration:

1. **Webhooks:** Settings → Integrations → Webhooks
2. **Automation Rules:** Settings → Integrations → Automation Rules  
3. **Templates:** Settings → Templates
4. **Company Profile:** Settings → Company (for PDF letterhead)

---

*Document generated from codebase analysis on 2026-09-15*
