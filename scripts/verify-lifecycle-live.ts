/**
 * Verifies the edit and delete behaviour added across every section.
 *
 * The guards are the point of this test, not the happy paths. Each one exists
 * because the alternative silently corrupts something:
 *
 *   - master data deactivates because the foreign keys are RESTRICT, so a real
 *     delete fails once the record has been used
 *   - documents cancel because their numbers appear on customs paperwork
 *   - an invoice with payments cannot be cancelled, or the buyer's ledger shows
 *     money paid against nothing
 *   - the base currency cannot be deactivated, since every converted total
 *     depends on it
 *   - the last founder cannot be deactivated, or nobody can administer the system
 *
 * Run against a seeded, running stack: bun scripts/verify-lifecycle-live.ts
 */
const BASE = process.env.API_BASE ?? 'http://localhost:4000/api';

let token = '';
let passes = 0;
let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ' -> ' + detail : ''}`);
  }
}

const H = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: H(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

async function main() {
  const login = await api('POST', '/auth/login', {
    email: 'founder@seabridge.com',
    password: process.env.SEED_FOUNDER_PASSWORD ?? 'admin123',
  });
  token = login.json?.data?.token ?? '';
  check('authenticated', !!token);
  if (!token) process.exit(1);

  const categories = (await api('GET', '/products/categories/list')).json?.data ?? [];
  const currencies = (await api('GET', '/master/currencies')).json?.data ?? [];
  const countries = (await api('GET', '/master/countries')).json?.data ?? [];

  // ---------------------------------------------------------------- master data
  console.log('\n=== master data deactivates, and comes back ===');

  const product = await api('POST', '/products', {
    name: 'Lifecycle Test Product',
    categoryId: categories[0]?.id,
    unit: 'KG',
  });
  const productId = product.json?.data?.id;
  check('product created', product.status === 201 && !!productId);

  const preview = await api('GET', `/lifecycle/products/${productId}/preview`);
  check('preview responds', preview.status === 200, `status ${preview.status}`);
  check('unused product has no dependents', (preview.json?.data?.dependents?.length ?? -1) === 0);
  check('preview reports it is not blocked', preview.json?.data?.blocked === null);

  const deact = await api('PUT', `/lifecycle/products/${productId}/deactivate`);
  check('product deactivates', deact.status === 200, `status ${deact.status}`);

  const afterDeact = await api('GET', `/products/${productId}`);
  check('product is now inactive', afterDeact.json?.data?.isActive === false);

  // Default listing hides it; asking for inactive brings it back into view.
  const activeList = await api('GET', '/products?isActive=true');
  const inActive = (activeList.json?.data ?? []).some((p: any) => p.id === productId);
  check('hidden from the active list', !inActive);

  const inactiveList = await api('GET', '/products?isActive=false');
  const inInactive = (inactiveList.json?.data ?? []).some((p: any) => p.id === productId);
  check('visible when showing inactive', inInactive);

  const doubleDeact = await api('PUT', `/lifecycle/products/${productId}/deactivate`);
  check('deactivating twice is refused', doubleDeact.status === 400, `status ${doubleDeact.status}`);

  const react = await api('PUT', `/lifecycle/products/${productId}/reactivate`);
  check('product reactivates', react.status === 200, `status ${react.status}`);
  const afterReact = await api('GET', `/products/${productId}`);
  check('product is active again', afterReact.json?.data?.isActive === true);

  // ---------------------------------------------------------------- guards
  console.log('\n=== the base currency is protected ===');
  const base = currencies.find((c: any) => c.isBaseCurrency);
  check('a base currency is configured', !!base);
  if (base) {
    const blockedPreview = await api('GET', `/lifecycle/currencies/${base.id}/preview`);
    check(
      'preview flags the base currency as blocked',
      !!blockedPreview.json?.data?.blocked,
      `blocked: ${blockedPreview.json?.data?.blocked}`
    );

    const attempt = await api('PUT', `/lifecycle/currencies/${base.id}/deactivate`);
    check('deactivating the base currency is refused', attempt.status === 400, `status ${attempt.status}`);
  }

  console.log('\n=== dependents are reported, not hidden ===');
  // Build a quotation that uses a product, then check the product reports it.
  const buyer = await api('POST', '/buyers', {
    companyName: 'Lifecycle Test Buyer',
    countryId: countries[0]?.id,
  });
  const buyerId = buyer.json?.data?.id;
  const incoterms = (await api('GET', '/master/incoterms')).json?.data ?? [];
  const usd = currencies.find((c: any) => c.code === 'USD');

  const quotation = await api('POST', '/quotations', {
    buyerId,
    currencyId: usd?.id,
    incotermId: incoterms[0]?.id,
    validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
    items: [{ productId, quantity: 10, unit: 'KG', unitCost: 5, unitPrice: 8 }],
  });
  const quotationId = quotation.json?.data?.id;
  check('quotation created', quotation.status === 201 && !!quotationId, `status ${quotation.status}`);

  const usedPreview = await api('GET', `/lifecycle/products/${productId}/preview`);
  const deps = usedPreview.json?.data?.dependents ?? [];
  check('the product now reports a dependent', deps.length > 0, JSON.stringify(deps));
  check(
    'the dependent is described in words',
    typeof usedPreview.json?.data?.summary === 'string' &&
      usedPreview.json.data.summary.length > 0,
    usedPreview.json?.data?.summary
  );

  // ---------------------------------------------------------------- documents
  console.log('\n=== draft quotations delete, sent ones cancel ===');
  const draft = await api('POST', '/quotations', {
    buyerId,
    currencyId: usd?.id,
    incotermId: incoterms[0]?.id,
    validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
    items: [{ productId, quantity: 1, unit: 'KG', unitCost: 5, unitPrice: 8 }],
  });
  const draftId = draft.json?.data?.id;
  check('draft created', draft.status === 201 && !!draftId);

  const deleteDraft = await api('DELETE', `/quotations/${draftId}`);
  check('a draft can be deleted outright', deleteDraft.status === 200, `status ${deleteDraft.status}`);
  const goneCheck = await api('GET', `/quotations/${draftId}`);
  check('the draft is really gone', goneCheck.status === 404, `status ${goneCheck.status}`);

  // Move the other quotation past draft, then confirm delete is refused.
  await api('PUT', `/quotations/${quotationId}`, { status: 'SENT' });
  const deleteSent = await api('DELETE', `/quotations/${quotationId}`);
  check('a sent quotation cannot be deleted', deleteSent.status === 400, `status ${deleteSent.status}`);

  const cancelSent = await api('PUT', `/quotations/${quotationId}/cancel`, { reason: 'test' });
  check('a sent quotation cancels instead', cancelSent.status === 200, `status ${cancelSent.status}`);
  const afterCancel = await api('GET', `/quotations/${quotationId}`);
  check('status is REJECTED', afterCancel.json?.data?.status === 'REJECTED', afterCancel.json?.data?.status);
  check(
    'the quotation number is retained',
    !!afterCancel.json?.data?.quotationNumber,
    'number missing'
  );

  console.log('\n=== an invoice with payments cannot be cancelled ===');
  // Build order -> invoice -> payment, then attempt the cancel.
  const q2 = await api('POST', '/quotations', {
    buyerId,
    currencyId: usd?.id,
    incotermId: incoterms[0]?.id,
    validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
    items: [{ productId, quantity: 10, unit: 'KG', unitCost: 5, unitPrice: 10 }],
  });
  const q2Id = q2.json?.data?.id;
  await api('PUT', `/quotations/${q2Id}`, { status: 'SENT' });
  await api('PUT', `/quotations/${q2Id}`, { status: 'ACCEPTED' });
  const order = await api('POST', `/quotations/${q2Id}/convert-to-order`, {
    orderDate: new Date().toISOString(),
  });
  const orderId = order.json?.data?.id;
  check('order created', order.status === 201 && !!orderId, `status ${order.status}`);

  const invoice = await api('POST', '/invoices', {
    orderId,
    invoiceDate: new Date().toISOString(),
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
  });
  const invoiceId = invoice.json?.data?.id;
  check('invoice created', invoice.status === 201 && !!invoiceId);

  // An invoiced order must not be cancellable, or the two would disagree.
  const cancelInvoicedOrder = await api('PUT', `/orders/${orderId}/cancel`);
  check(
    'an invoiced order cannot be cancelled',
    cancelInvoicedOrder.status === 400,
    `status ${cancelInvoicedOrder.status}`
  );

  await api('PUT', `/invoices/${invoiceId}`, { status: 'SENT' });
  await api('POST', `/invoices/${invoiceId}/payments`, {
    amount: 10,
    paymentDate: new Date().toISOString(),
    paymentMode: 'BANK_TRANSFER',
  });

  const cancelPaid = await api('PUT', `/invoices/${invoiceId}/cancel`);
  check(
    'an invoice with a payment cannot be cancelled',
    cancelPaid.status === 400,
    `status ${cancelPaid.status}`
  );
  check(
    'the refusal explains why',
    /payment|credit note/i.test(cancelPaid.json?.message ?? ''),
    cancelPaid.json?.message
  );

  console.log('\n=== users deactivate rather than delete ===');
  const created = await api('POST', '/users', {
    firstName: 'Lifecycle',
    lastName: 'Tester',
    email: `lifecycle-${Date.now()}@seabridge.com`,
    password: 'lifecycletest123',
    role: 'SALES',
  });
  const userId = created.json?.data?.id;
  check('user created', created.status === 201 && !!userId, `status ${created.status}`);

  if (userId) {
    // Give them a task so a hard delete would violate referential integrity.
    await api('POST', '/tasks', { title: 'Lifecycle task', assigneeId: userId });

    const removed = await api('DELETE', `/users/${userId}`);
    check('user removal succeeds despite having a task', removed.status === 200, `status ${removed.status}`);

    const after = await api('GET', `/users/${userId}`);
    check('the user still exists', after.status === 200, `status ${after.status}`);
    check('but is INACTIVE', after.json?.data?.status === 'INACTIVE', after.json?.data?.status);

    const restored = await api('PUT', `/users/${userId}/reactivate`);
    check('user can be reactivated', restored.status === 200, `status ${restored.status}`);
  }

  console.log('\n=== the last founder is protected ===');
  const me = (await api('GET', '/auth/me')).json?.data;
  const selfRemove = await api('DELETE', `/users/${me?.id}`);
  check(
    'you cannot deactivate your own account',
    selfRemove.status === 400,
    `status ${selfRemove.status}`
  );

  console.log('\n=== destructive actions need the right role ===');
  const financeEmail = `lifecycle-finance-${Date.now()}@seabridge.com`;
  await api('POST', '/users', {
    firstName: 'Finance',
    lastName: 'Lifecycle',
    email: financeEmail,
    password: 'financelifecycle123',
    role: 'FINANCE',
  });
  const financeLogin = await api('POST', '/auth/login', {
    email: financeEmail,
    password: 'financelifecycle123',
  });
  const financeToken = financeLogin.json?.data?.token;

  if (financeToken) {
    const saved = token;
    token = financeToken;
    const attempt = await api('PUT', `/lifecycle/products/${productId}/deactivate`);
    check('a finance user cannot deactivate a product', attempt.status === 403, `status ${attempt.status}`);
    token = saved;
  } else {
    check('finance test account usable', false, 'could not log in');
  }

  console.log('\n=== audit log recorded these changes ===');
  const audit = await api('GET', '/audit?limit=50');
  check('audit log is readable', audit.status === 200, `status ${audit.status}`);
  const entries = audit.json?.data ?? [];
  check('it recorded the lifecycle actions', entries.length > 0, `${entries.length} entries`);

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('unexpected error:', e);
  process.exit(1);
});
