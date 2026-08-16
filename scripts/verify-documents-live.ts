/**
 * Live end-to-end test of the export document endpoints.
 *
 * Drives the real API over HTTP: login -> buyer -> product -> quotation ->
 * order -> packing figures -> three invoice types -> download all five
 * documents. Proves the routes, permissions, Prisma queries and PDF generation
 * work together against a real database, which unit-level checks cannot show.
 *
 * Run against an already-seeded stack: bun scripts/verify-documents-live.ts
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

async function call(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: any; buffer?: ArrayBuffer; contentType: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/pdf')) {
    return { status: res.status, json: null, buffer: await res.arrayBuffer(), contentType };
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json, contentType };
}

async function main() {
  console.log('=== authentication ===');
  const login = await call('POST', '/auth/login', {
    email: 'founder@seabridge.com',
    password: 'admin123',
  });
  token = login.json?.data?.token ?? login.json?.token ?? '';
  check('login returns a token', login.status === 200 && !!token, `status ${login.status}`);
  if (!token) {
    console.log('\nCannot continue without a token.');
    process.exit(1);
  }

  // ---- reference data ----
  const countries = await call('GET', '/master/countries');
  const currencies = await call('GET', '/master/currencies');
  const incoterms = await call('GET', '/master/incoterms');
  const categories = await call('GET', '/products/categories/list');

  const countryId = countries.json?.data?.find((c: any) => c.name === 'Italy')?.id
    ?? countries.json?.data?.[0]?.id;
  const currencyId = currencies.json?.data?.find((c: any) => c.code === 'USD')?.id;
  const incotermId = incoterms.json?.data?.find((i: any) => i.code === 'CIF')?.id
    ?? incoterms.json?.data?.[0]?.id;
  const categoryId = categories.json?.data?.[0]?.id;
  check('reference data available', !!(countryId && currencyId && incotermId && categoryId));

  // ---- buyer ----
  const buyer = await call('POST', '/buyers', {
    companyName: 'MartinoRossi SpA',
    countryId,
    address: 'Strada Provinciale SP 26, Km 15.100',
    city: 'Malagnino',
    state: 'Cremona',
    email: 'luca.meanti@martinorossispa.it',
    phone: '0372 58131',
  });
  const buyerId = buyer.json?.data?.id;
  check('buyer created', buyer.status === 201 && !!buyerId, `status ${buyer.status}`);

  // ---- product with packaging defaults ----
  const product = await call('POST', '/products', {
    code: 'PSY-99-100',
    name: 'Psyllium Husk Powder 99% pure 100 Mesh',
    categoryId,
    hsnCode: '12119032',
    unit: 'KG',
    packageType: 'BAG',
    packageNetWeight: 25,
    packageGrossWeight: 26,
  });
  const productId = product.json?.data?.id;
  check('product created with packaging defaults', product.status === 201 && !!productId, `status ${product.status}`);
  check(
    'packaging defaults persisted',
    Number(product.json?.data?.packageNetWeight) === 25,
    `got ${product.json?.data?.packageNetWeight}`
  );

  if (!buyerId || !productId) {
    console.log('\nCannot continue without a buyer and product.');
    process.exit(1);
  }

  // ---- quotation ----
  const quotation = await call('POST', '/quotations', {
    buyerId,
    currencyId,
    incotermId,
    validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
    paymentTerms: '40% Advance and 60% on Sight LC.',
    deliveryTerms: 'Nhava Sheva to Genoa',
    items: [{ productId, quantity: 500, unit: 'KG', unitCost: 9, unitPrice: 11.8 }],
  });
  const quotationId = quotation.json?.data?.id;
  check('quotation created', quotation.status === 201 && !!quotationId, `status ${quotation.status} ${JSON.stringify(quotation.json?.message ?? '')}`);

  // ---- Quotation PDF ----
  if (quotationId) {
    const pdf = await call('GET', `/quotations/${quotationId}/pdf`);
    const sig = pdf.buffer ? new TextDecoder().decode(new Uint8Array(pdf.buffer).slice(0, 5)) : '';
    check(
      'Quotation PDF downloads',
      pdf.status === 200 && sig === '%PDF-' && (pdf.buffer?.byteLength ?? 0) > 1000,
      `status ${pdf.status}, ${pdf.buffer?.byteLength ?? 0} bytes`
    );
  }

  // ---- approve then convert to order ----
  await call('PUT', `/quotations/${quotationId}`, { status: 'SENT' });
  await call('PUT', `/quotations/${quotationId}`, { status: 'ACCEPTED' });

  const order = await call('POST', `/quotations/${quotationId}/convert-to-order`, {
    poNumber: 'PO-8891',
    orderDate: new Date().toISOString(),
    dispatchMethod: 'Sea',
    shipmentType: 'FCL',
    variationPercent: 10,
  });
  const orderId = order.json?.data?.id;
  check('order created from quotation', order.status === 201 && !!orderId, `status ${order.status} ${JSON.stringify(order.json?.message ?? '')}`);

  if (!orderId) {
    console.log(`\nCannot continue without an order. Response: ${JSON.stringify(order.json)}`);
    process.exit(1);
  }

  // ---- packing list before any weights: should be refused or empty ----
  const orderDetail = await call('GET', `/orders/${orderId}`);
  const itemId = orderDetail.json?.data?.items?.[0]?.id;
  check('order has a line item', !!itemId);

  // The dispatch fields are printed in the header of every export document, so
  // they must survive the quotation -> order conversion.
  check(
    'dispatch method persisted through conversion',
    orderDetail.json?.data?.dispatchMethod === 'Sea',
    `got ${orderDetail.json?.data?.dispatchMethod}`
  );
  check(
    'shipment type persisted through conversion',
    orderDetail.json?.data?.shipmentType === 'FCL',
    `got ${orderDetail.json?.data?.shipmentType}`
  );
  check(
    'variation percent persisted through conversion',
    Number(orderDetail.json?.data?.variationPercent) === 10,
    `got ${orderDetail.json?.data?.variationPercent}`
  );

  // ---- record packing figures ----
  const packing = await call('PUT', `/orders/${orderId}/items/${itemId}/packing`, {
    numberOfPackages: 20,
    packageWeight: 25,
    netWeight: 500,
    grossWeight: 520,
  });
  check('packing figures saved', packing.status === 200, `status ${packing.status}`);
  check(
    'net weight persisted',
    Number(packing.json?.data?.netWeight) === 500,
    `got ${packing.json?.data?.netWeight}`
  );

  // ---- gross < net must be rejected ----
  const badPacking = await call('PUT', `/orders/${orderId}/items/${itemId}/packing`, {
    netWeight: 500,
    grossWeight: 100,
  });
  check('gross below net rejected', badPacking.status === 400, `status ${badPacking.status}`);

  // ---- Packing List PDF ----
  const packingList = await call('GET', `/orders/${orderId}/packing-list`);
  const plSig = packingList.buffer
    ? new TextDecoder().decode(new Uint8Array(packingList.buffer).slice(0, 5))
    : '';
  check(
    'Packing List PDF downloads',
    packingList.status === 200 && plSig === '%PDF-',
    `status ${packingList.status}, ${packingList.buffer?.byteLength ?? 0} bytes`
  );

  // ---- three invoice types, each producing its own template ----
  for (const [type, label] of [
    ['EXPORT', 'Commercial Invoice'],
    ['PROFORMA', 'Proforma Invoice'],
    ['SAMPLE', 'Sample Invoice'],
  ] as [string, string][]) {
    const invoice = await call('POST', '/invoices', {
      orderId,
      type,
      invoiceDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
    });
    const invoiceId = invoice.json?.data?.id;
    check(
      `${label}: invoice created`,
      invoice.status === 201 && !!invoiceId,
      `status ${invoice.status} ${JSON.stringify(invoice.json?.message ?? '')}`
    );

    if (invoiceId) {
      const pdf = await call('GET', `/invoices/${invoiceId}/pdf`);
      const sig = pdf.buffer ? new TextDecoder().decode(new Uint8Array(pdf.buffer).slice(0, 5)) : '';
      check(
        `${label}: PDF downloads`,
        pdf.status === 200 && sig === '%PDF-' && (pdf.buffer?.byteLength ?? 0) > 1000,
        `status ${pdf.status}, ${pdf.buffer?.byteLength ?? 0} bytes`
      );
    }
  }

  // ---- unauthenticated access must be refused ----
  const saved = token;
  token = '';
  const unauth = await call('GET', `/orders/${orderId}/packing-list`);
  check('packing list requires authentication', unauth.status === 401, `status ${unauth.status}`);
  token = saved;

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('unexpected error:', e);
  process.exit(1);
});
