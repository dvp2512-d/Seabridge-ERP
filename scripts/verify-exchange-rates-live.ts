/**
 * Verifies the exchange rate system and the aggregates that depend on it.
 *
 * The behaviour that matters here is not the arithmetic but the refusals:
 * a missing rate must produce an error rather than a wrong number, a rate must
 * be selected by effective date rather than "latest", and totals that exclude
 * unconvertible records must say so.
 *
 * Run against a seeded, running stack: bun scripts/verify-exchange-rates-live.ts
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

  const currencies = (await api('GET', '/master/currencies')).json?.data ?? [];
  const usd = currencies.find((c: any) => c.code === 'USD');
  const eur = currencies.find((c: any) => c.code === 'EUR');
  const inr = currencies.find((c: any) => c.code === 'INR');
  check('USD, EUR and INR present', !!(usd && eur && inr));
  if (!usd || !eur || !inr) process.exit(1);

  console.log('\n=== base currency comes from data, not a literal ===');
  const current = await api('GET', '/exchange-rates/current');
  check('current rates endpoint responds', current.status === 200, `status ${current.status}`);
  check(
    'base currency is INR',
    current.json?.data?.baseCurrency?.code === 'INR',
    `got ${current.json?.data?.baseCurrency?.code}`
  );
  const inrRow = current.json?.data?.rates?.find((r: any) => r.code === 'INR');
  check('INR is marked as base and needs no rate', inrRow?.isBaseCurrency === true);

  console.log('\n=== a missing rate is refused, not assumed ===');
  const coverageBefore = await api('GET', '/exchange-rates/coverage');
  check(
    'coverage reports currencies with no rate',
    (coverageBefore.json?.data?.missing?.length ?? 0) > 0,
    `missing: ${JSON.stringify(coverageBefore.json?.data?.missing)}`
  );
  check('coverage is not complete yet', coverageBefore.json?.data?.complete === false);

  console.log('\n=== validation on entry ===');
  // Export above import means the columns were swapped, which would undervalue
  // every shipping bill in the period.
  const swapped = await api('POST', '/exchange-rates/notification', {
    notificationRef: 'TEST-SWAPPED',
    effectiveFrom: '2026-08-01',
    rates: [{ currencyId: usd.id, importRate: 90, exportRate: 95 }],
  });
  check('export rate above import rate rejected', swapped.status === 400, `status ${swapped.status}`);

  // The base currency cannot have a rate against itself.
  const selfRate = await api('POST', '/exchange-rates/notification', {
    notificationRef: 'TEST-SELF',
    effectiveFrom: '2026-08-01',
    rates: [{ currencyId: inr.id, importRate: 1, exportRate: 1 }],
  });
  check('base currency rate against itself rejected', selfRate.status === 400, `status ${selfRate.status}`);

  const negative = await api('POST', '/exchange-rates/notification', {
    notificationRef: 'TEST-NEG',
    effectiveFrom: '2026-08-01',
    rates: [{ currencyId: usd.id, importRate: -5, exportRate: -6 }],
  });
  check('negative rate rejected', negative.status === 400, `status ${negative.status}`);

  console.log('\n=== two notifications, so date selection can be tested ===');
  const first = await api('POST', '/exchange-rates/notification', {
    notificationRef: '40/2026-Customs (N.T.)',
    effectiveFrom: '2026-07-01',
    rates: [
      { currencyId: usd.id, importRate: 84.0, exportRate: 83.0 },
      { currencyId: eur.id, importRate: 92.0, exportRate: 91.0 },
    ],
  });
  check('first notification recorded', first.status === 201, `status ${first.status}`);
  check('covered two currencies', first.json?.data?.currencyCount === 2);

  const second = await api('POST', '/exchange-rates/notification', {
    notificationRef: '55/2026-Customs (N.T.)',
    effectiveFrom: '2026-08-01',
    rates: [
      { currencyId: usd.id, importRate: 96.0, exportRate: 95.0 },
      { currencyId: eur.id, importRate: 104.0, exportRate: 103.0 },
    ],
  });
  check('second notification recorded', second.status === 201, `status ${second.status}`);

  console.log('\n=== the rate in force depends on the date, not "latest" ===');
  const july = await api('GET', '/exchange-rates/current?date=2026-07-15');
  const julyUsd = july.json?.data?.rates?.find((r: any) => r.code === 'USD');
  check('mid-July uses the July notification', julyUsd?.rate === 83, `got ${julyUsd?.rate}`);
  check(
    'mid-July cites the July reference',
    julyUsd?.notificationRef === '40/2026-Customs (N.T.)',
    `got ${julyUsd?.notificationRef}`
  );

  const august = await api('GET', '/exchange-rates/current?date=2026-08-15');
  const augustUsd = august.json?.data?.rates?.find((r: any) => r.code === 'USD');
  check('mid-August uses the August notification', augustUsd?.rate === 95, `got ${augustUsd?.rate}`);

  // Before any notification there is no rate, and that must stay an absence.
  const june = await api('GET', '/exchange-rates/current?date=2026-06-15');
  const juneUsd = june.json?.data?.rates?.find((r: any) => r.code === 'USD');
  check('before the first notification there is no rate', juneUsd?.rate === null, `got ${juneUsd?.rate}`);

  console.log('\n=== import versus export ===');
  const imports = await api('GET', '/exchange-rates/current?date=2026-08-15&direction=IMPORT');
  const importUsd = imports.json?.data?.rates?.find((r: any) => r.code === 'USD');
  check('import direction returns the import rate', importUsd?.rate === 96, `got ${importUsd?.rate}`);

  console.log('\n=== the previous period is closed off automatically ===');
  const history = await api('GET', `/exchange-rates/history/${usd.id}`);
  const rows = history.json?.data ?? [];
  check('two rate rows for USD', rows.length === 2, `got ${rows.length}`);
  const julyRow = rows.find((r: any) => r.notificationRef === '40/2026-Customs (N.T.)');
  const augustRow = rows.find((r: any) => r.notificationRef === '55/2026-Customs (N.T.)');
  check('the July row was closed off', !!julyRow?.effectiveTo, `effectiveTo ${julyRow?.effectiveTo}`);
  check('the August row is still in force', augustRow?.effectiveTo === null);
  check(
    'periods are contiguous with no gap',
    julyRow?.effectiveTo?.slice(0, 10) === '2026-07-31',
    `July ends ${julyRow?.effectiveTo?.slice(0, 10)}`
  );

  console.log('\n=== re-entering a notification corrects rather than duplicates ===');
  const correction = await api('POST', '/exchange-rates/notification', {
    notificationRef: '55/2026-Customs (N.T.) rev',
    effectiveFrom: '2026-08-01',
    rates: [{ currencyId: usd.id, importRate: 96.5, exportRate: 95.5 }],
  });
  check('correction accepted', correction.status === 201, `status ${correction.status}`);
  const afterCorrection = (await api('GET', `/exchange-rates/history/${usd.id}`)).json?.data ?? [];
  check('still two rows, not three', afterCorrection.length === 2, `got ${afterCorrection.length}`);
  const revised = afterCorrection.find((r: any) => r.effectiveFrom.startsWith('2026-08-01'));
  check('the rate was corrected', Number(revised?.exportRate) === 95.5, `got ${revised?.exportRate}`);

  console.log('\n=== aggregates convert instead of adding raw numbers ===');
  const dashboard = await api('GET', '/dashboard');
  check('dashboard responds', dashboard.status === 200, `status ${dashboard.status}`);
  check(
    'dashboard states its base currency',
    dashboard.json?.data?.baseCurrency?.code === 'INR',
    `got ${dashboard.json?.data?.baseCurrency?.code}`
  );
  check(
    'dashboard reports unconvertible records',
    typeof dashboard.json?.data?.unconvertedRecords === 'number',
    `got ${typeof dashboard.json?.data?.unconvertedRecords}`
  );

  for (const [name, path] of [
    ['invoices', '/invoices'],
    ['orders', '/orders'],
    ['quotations', '/quotations'],
  ] as [string, string][]) {
    const res = await api('GET', path);
    check(
      `${name} summary states its base currency`,
      res.json?.summary?.baseCurrency?.code === 'INR',
      `got ${res.json?.summary?.baseCurrency?.code}`
    );
    check(
      `${name} summary reports unconvertible records`,
      typeof res.json?.summary?.unconvertedRecords === 'number'
    );
  }

  console.log('\n=== market cross-check degrades gracefully ===');
  const marketRes = await api('GET', '/exchange-rates/market-check');
  check('market check never errors', marketRes.status === 200, `status ${marketRes.status}`);
  check(
    'market check reports availability either way',
    typeof marketRes.json?.data?.available === 'boolean'
  );

  console.log('\n=== authorisation ===');
  const saved = token;
  token = '';
  const anon = await api('GET', '/exchange-rates/current');
  check('unauthenticated read refused', anon.status === 401, `status ${anon.status}`);
  token = saved;

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('unexpected error:', e);
  process.exit(1);
});
