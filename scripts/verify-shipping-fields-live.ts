/**
 * Verifies the quotation shipping block reaches the generated documents.
 *
 * The fields were being captured and displayed in the app but the PDF builder
 * hardcoded nulls, so nothing printed in rows 6 and 7 of the template. This
 * drives the real API and reads the values back out of the PDFs.
 *
 * Also checks the ports survive conversion to an order, so the commercial
 * invoice and packing list can name them before any shipment exists.
 *
 * Run against a seeded, running stack: bun scripts/verify-shipping-fields-live.ts
 */
import zlib from 'zlib';

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

function hexToText(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (code >= 32 && code < 255) out += String.fromCharCode(code);
  }
  return out;
}

function extractText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const out: string[] = [];
  const re = /stream[\r\n]{1,2}([\s\S]*?)[\r\n]{0,2}endstream/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    let text = '';
    try {
      text = zlib
        .inflateSync(Buffer.from(m[1], 'latin1'), {
          finishFlush: zlib.constants.Z_SYNC_FLUSH,
        } as zlib.ZlibOptions)
        .toString('latin1');
    } catch {
      continue;
    }
    if (!/\bBT\b/.test(text)) continue;
    for (const block of text.matchAll(/\[((?:[^\][]|\\.)*)\]\s*TJ|<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
      let run = '';
      for (const h of block[0].matchAll(/<([0-9A-Fa-f\s]+)>/g)) run += hexToText(h[1]);
      if (run) out.push(run);
    }
  }
  return out.join(' ').replace(/\s+/g, ' ');
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

async function pdf(path: string): Promise<Buffer> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const login = await api('POST', '/auth/login', {
    email: 'founder@seabridge.com',
    password: 'admin123',
  });
  token = login.json?.data?.token ?? '';
  check('authenticated', !!token);
  if (!token) process.exit(1);

  // ---- reference data ----
  const countries = (await api('GET', '/master/countries')).json?.data ?? [];
  const currencies = (await api('GET', '/master/currencies')).json?.data ?? [];
  const incoterms = (await api('GET', '/master/incoterms')).json?.data ?? [];
  const categories = (await api('GET', '/products/categories/list')).json?.data ?? [];
  const ports = (await api('GET', '/master/ports?limit=500')).json?.data ?? [];

  check('ports available in master data', ports.length >= 2, `found ${ports.length}`);
  if (ports.length < 2) {
    console.log('  cannot continue without at least two ports');
    process.exit(1);
  }

  // Pick two distinguishable sea ports
  const seaPorts = ports.filter((p: any) => !p.type || p.type === 'SEA');
  const loading = seaPorts[0] ?? ports[0];
  const discharge = seaPorts[1] ?? ports[1];
  console.log(`\n  using ports: loading="${loading.name}" discharge="${discharge.name}"`);

  const currencyId = currencies.find((c: any) => c.code === 'USD')?.id ?? currencies[0]?.id;
  const incotermId = incoterms.find((i: any) => i.code === 'CIF')?.id ?? incoterms[0]?.id;

  // ---- base currency should be marked, not assumed ----
  const inr = currencies.find((c: any) => c.code === 'INR');
  check('INR is flagged as the base currency', inr?.isBaseCurrency === true, `got ${inr?.isBaseCurrency}`);
  check(
    'exactly one base currency',
    currencies.filter((c: any) => c.isBaseCurrency).length === 1,
    `found ${currencies.filter((c: any) => c.isBaseCurrency).length}`
  );

  // ---- buyer and product ----
  const buyer = await api('POST', '/buyers', {
    companyName: 'Shipping Fields Test Buyer',
    countryId: countries[0]?.id,
    city: 'Dubai',
  });
  const buyerId = buyer.json?.data?.id;
  const product = await api('POST', '/products', {
    name: 'Steam Basmati Rice 1121',
    categoryId: categories[0]?.id,
    hsnCode: '10063020',
    unit: 'KG',
  });
  const productId = product.json?.data?.id;
  check('buyer and product created', !!(buyerId && productId));

  // ---- quotation carrying the full shipping block ----
  const quotation = await api('POST', '/quotations', {
    buyerId,
    currencyId,
    incotermId,
    validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
    paymentTerms: '40% Advance and 60% on Sight LC.',
    dispatchMethod: 'Sea',
    shipmentType: 'FCL',
    portOfLoadingId: loading.id,
    portOfDischargeId: discharge.id,
    items: [{ productId, quantity: 100, unit: 'KG', unitCost: 120, unitPrice: 150 }],
  });
  const quotationId = quotation.json?.data?.id;
  check('quotation created with shipping fields', quotation.status === 201 && !!quotationId,
    `status ${quotation.status} ${JSON.stringify(quotation.json?.message ?? '')}`);
  if (!quotationId) process.exit(1);

  // ---- stored correctly ----
  const detail = await api('GET', `/quotations/${quotationId}`);
  const q = detail.json?.data;
  check('dispatch method stored', q?.dispatchMethod === 'Sea', `got ${q?.dispatchMethod}`);
  check('shipment type stored', q?.shipmentType === 'FCL', `got ${q?.shipmentType}`);
  check('port of loading resolved', q?.portOfLoading?.name === loading.name, `got ${q?.portOfLoading?.name}`);
  check('port of discharge resolved', q?.portOfDischarge?.name === discharge.name, `got ${q?.portOfDischarge?.name}`);

  // ---- the point of the exercise: do they print? ----
  console.log('\n=== quotation PDF ===');
  const qText = extractText(await pdf(`/quotations/${quotationId}/pdf`));
  check('prints Method Of Dispatch label', qText.includes('Method Of Dispatch'));
  check('prints the dispatch method value "Sea"', qText.includes('Sea'));
  check('prints Type Of Shipment label', qText.includes('Type Of Shipment'));
  check('prints the shipment type value "FCL"', qText.includes('FCL'));
  check('prints Port Of Loading label', qText.includes('Port Of Loading'));
  check(`prints the loading port "${loading.name}"`, qText.includes(loading.name), qText.slice(0, 300));
  check('prints Port Of Discharge label', qText.includes('Port Of Discharge'));
  check(`prints the discharge port "${discharge.name}"`, qText.includes(discharge.name));

  // ---- convert to order: ports must carry across ----
  await api('PUT', `/quotations/${quotationId}`, { status: 'SENT' });
  await api('PUT', `/quotations/${quotationId}`, { status: 'ACCEPTED' });
  const order = await api('POST', `/quotations/${quotationId}/convert-to-order`, {
    poNumber: 'PO-SHIP-1',
    orderDate: new Date().toISOString(),
  });
  const orderId = order.json?.data?.id;
  check('order created', order.status === 201 && !!orderId,
    `status ${order.status} ${JSON.stringify(order.json?.message ?? '')}`);
  if (!orderId) process.exit(1);

  const orderDetail = await api('GET', `/orders/${orderId}`);
  const o = orderDetail.json?.data;
  check('dispatch method inherited by the order', o?.dispatchMethod === 'Sea', `got ${o?.dispatchMethod}`);
  check('shipment type inherited by the order', o?.shipmentType === 'FCL', `got ${o?.shipmentType}`);
  check('port of loading inherited by the order', o?.portOfLoading?.name === loading.name, `got ${o?.portOfLoading?.name}`);
  check('port of discharge inherited by the order', o?.portOfDischarge?.name === discharge.name, `got ${o?.portOfDischarge?.name}`);

  // ---- documents must name the ports with NO shipment created ----
  check('no shipment exists yet', (o?.shipments?.length ?? 0) === 0, `found ${o?.shipments?.length}`);

  console.log('\n=== packing list (no shipment) ===');
  const itemId = o?.items?.[0]?.id;
  await api('PUT', `/orders/${orderId}/items/${itemId}/packing`, {
    numberOfPackages: 4, packageWeight: 25, netWeight: 100, grossWeight: 104,
  });
  const plText = extractText(await pdf(`/orders/${orderId}/packing-list`));
  check(`packing list names the loading port "${loading.name}"`, plText.includes(loading.name));
  check(`packing list names the discharge port "${discharge.name}"`, plText.includes(discharge.name));
  check('packing list shows the dispatch method', plText.includes('Sea'));

  console.log('\n=== commercial invoice (no shipment) ===');
  const invoice = await api('POST', '/invoices', {
    orderId,
    type: 'EXPORT',
    invoiceDate: new Date().toISOString(),
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
  });
  const invoiceId = invoice.json?.data?.id;
  check('invoice created', invoice.status === 201 && !!invoiceId, `status ${invoice.status}`);
  if (invoiceId) {
    const invText = extractText(await pdf(`/invoices/${invoiceId}/pdf`));
    check(`invoice names the loading port "${loading.name}"`, invText.includes(loading.name));
    check(`invoice names the discharge port "${discharge.name}"`, invText.includes(discharge.name));
    check('invoice shows FCL', invText.includes('FCL'));
  }

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('unexpected error:', e);
  process.exit(1);
});
