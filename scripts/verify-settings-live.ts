/**
 * Verifies the company profile endpoints and that editing the profile actually
 * changes what is printed on documents - the whole point of making it editable.
 *
 * Also checks that a non-privileged role can read but not write, since these
 * values appear on legal documents.
 *
 * Run against a seeded, running stack: bun scripts/verify-settings-live.ts
 */
import zlib from 'zlib';

const BASE = process.env.API_BASE ?? 'http://localhost:4000/api';

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

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  return json?.data?.token ?? '';
}

async function main() {
  const founder = await login('founder@seabridge.com', process.env.SEED_FOUNDER_PASSWORD ?? 'admin123');
  check('founder authenticated', !!founder);
  if (!founder) process.exit(1);

  const H = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

  console.log('\n=== read the profile ===');
  const getRes = await fetch(`${BASE}/settings/company`, { headers: H(founder) });
  const profile = (await getRes.json())?.data;
  check('GET /settings/company returns 200', getRes.status === 200, `status ${getRes.status}`);
  check('seeded legal name present', profile?.legalName === 'VISION LIMELITE', `got ${profile?.legalName}`);
  check('seeded bank swift present', profile?.bankSwiftCode === 'KKBKINBBXX');

  console.log('\n=== validation ===');
  const noName = await fetch(`${BASE}/settings/company`, {
    method: 'PUT',
    headers: H(founder),
    body: JSON.stringify({ ...profile, legalName: '' }),
  });
  check('empty legal name rejected', noName.status === 400, `status ${noName.status}`);

  const badEmail = await fetch(`${BASE}/settings/company`, {
    method: 'PUT',
    headers: H(founder),
    body: JSON.stringify({ ...profile, email: 'not-an-email' }),
  });
  check('invalid email rejected', badEmail.status === 400, `status ${badEmail.status}`);

  console.log('\n=== edit propagates to documents ===');
  const marker = `SWIFT-${Date.now().toString().slice(-6)}`;
  const put = await fetch(`${BASE}/settings/company`, {
    method: 'PUT',
    headers: H(founder),
    body: JSON.stringify({
      ...profile,
      id: undefined,
      createdAt: undefined,
      updatedAt: undefined,
      bankSwiftCode: marker,
      invoiceDeclaration: 'Amended declaration for verification purposes.',
    }),
  });
  check('PUT /settings/company succeeds', put.status === 200, `status ${put.status}`);
  const updated = (await put.json())?.data;
  check('swift code updated', updated?.bankSwiftCode === marker, `got ${updated?.bankSwiftCode}`);

  // A commercial invoice prints the bank block, so the new value must appear.
  const invoices = await (await fetch(`${BASE}/invoices`, { headers: H(founder) })).json();
  const commercial = invoices.data?.find((i: any) => i.type === 'EXPORT');
  if (commercial) {
    const pdfRes = await fetch(`${BASE}/invoices/${commercial.id}/pdf`, { headers: H(founder) });
    const text = extractText(Buffer.from(await pdfRes.arrayBuffer()));
    check('edited swift code appears on the invoice', text.includes(marker), 'not found in PDF text');
    check(
      'edited declaration appears on the invoice',
      text.includes('Amended declaration'),
      'not found in PDF text'
    );
    check('old swift code no longer printed', !text.includes('KKBKINBBXX'));
  } else {
    check('a commercial invoice exists to test against', false, 'none found');
  }

  // ---- restore the seeded values so later runs start clean ----
  await fetch(`${BASE}/settings/company`, {
    method: 'PUT',
    headers: H(founder),
    body: JSON.stringify({
      ...profile,
      id: undefined,
      createdAt: undefined,
      updatedAt: undefined,
    }),
  });
  const restored = (await (await fetch(`${BASE}/settings/company`, { headers: H(founder) })).json())
    ?.data;
  check('profile restored', restored?.bankSwiftCode === 'KKBKINBBXX', `got ${restored?.bankSwiftCode}`);

  console.log('\n=== authorisation ===');
  const anon = await fetch(`${BASE}/settings/company`);
  check('unauthenticated read refused', anon.status === 401, `status ${anon.status}`);

  // A FINANCE user may view settings but must not change the legal entity.
  // Created here rather than assumed, so this check never silently skips.
  await fetch(`${BASE}/users`, {
    method: 'POST',
    headers: H(founder),
    body: JSON.stringify({
      firstName: 'Finance',
      lastName: 'Tester',
      email: 'finance-test@seabridge.com',
      password: 'financetest123',
      role: 'FINANCE',
    }),
  });

  const finance = await login('finance-test@seabridge.com', 'financetest123');
  check('finance test account usable', !!finance);

  if (finance) {
    const readRes = await fetch(`${BASE}/settings/company`, { headers: H(finance) });
    check('finance role can read', readRes.status === 200, `status ${readRes.status}`);

    const writeRes = await fetch(`${BASE}/settings/company`, {
      method: 'PUT',
      headers: H(finance),
      body: JSON.stringify({ legalName: 'HIJACKED LTD' }),
    });
    check('finance role cannot write', writeRes.status === 403, `status ${writeRes.status}`);

    // Confirm the refused write really did not land.
    const after = (await (await fetch(`${BASE}/settings/company`, { headers: H(founder) })).json())
      ?.data;
    check(
      'legal name unchanged after refused write',
      after?.legalName === 'VISION LIMELITE',
      `got ${after?.legalName}`
    );
  }

  console.log(`\n${'-'.repeat(60)}`);
  console.log(`${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('unexpected error:', e);
  process.exit(1);
});
