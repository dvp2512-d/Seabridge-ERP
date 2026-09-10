/**
 * API contract checker.
 *
 * Cross-references every HTTP call the frontend makes in apps/web/src/lib/api.ts
 * against the routes actually registered by the Express routers, and fails when a
 * call has no matching route.
 *
 * This exists because that mismatch is invisible to TypeScript: a client method
 * and a route are joined only by a string. Real defects it has caught:
 *   - the Expenses status action used PATCH where the route was PUT
 *   - the Income options dropdown called /income/options, not /income/meta/options
 *   - seven exchange-rate methods pointed at routes that were never implemented
 *
 * Run: npm run verify:contract
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_SRC = path.join(ROOT, 'apps/api/src');
const WEB_API = path.join(ROOT, 'apps/web/src/lib/api.ts');

for (const required of [path.join(API_SRC, 'index.ts'), WEB_API]) {
  if (!fs.existsSync(required)) {
    console.error(`check-api-contract: cannot find ${path.relative(ROOT, required)}`);
    process.exit(1);
  }
}

// ── Router mount prefixes, from the real server entrypoint ──────────────────
const indexSrc = fs.readFileSync(path.join(API_SRC, 'index.ts'), 'utf8');

const mounts = {}; // routerVar -> '/api/x'
// Matches app.use('/api/x', router) and app.use('/api/x', limiter, router)
for (const m of indexSrc.matchAll(
  /app\.use\(\s*'(\/api\/[^']*)'\s*,\s*(?:[A-Za-z]+\s*,\s*)*([A-Za-z]+Router)\s*\)/g
)) {
  mounts[m[2]] = m[1];
}

const routerFiles = {}; // routerVar -> routes/<file>
for (const m of indexSrc.matchAll(
  /import\s*\{\s*([A-Za-z]+Router)\s*\}\s*from\s*'\.\/routes\/([A-Za-z]+)'/g
)) {
  routerFiles[m[1]] = m[2];
}

// ── Registered routes ───────────────────────────────────────────────────────
const routes = [];
for (const [routerVar, prefix] of Object.entries(mounts)) {
  const file = routerFiles[routerVar];
  if (!file) continue;
  const filePath = path.join(API_SRC, 'routes', `${file}.ts`);
  if (!fs.existsSync(filePath)) continue;
  const src = fs.readFileSync(filePath, 'utf8');
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
    const sub = m[2] === '/' ? '' : m[2];
    routes.push({ method: m[1].toUpperCase(), pattern: prefix + sub, file: `${file}.ts` });
  }
}

// ── Frontend calls ──────────────────────────────────────────────────────────
const webSrc = fs.readFileSync(WEB_API, 'utf8');
const calls = [];
for (const m of webSrc.matchAll(
  /\bapi\.(get|post|put|patch|delete)(?:<[^>]*>)?\(\s*([`'])([^`']*)\2/g
)) {
  calls.push({
    method: m[1].toUpperCase(),
    raw: m[3],
    line: webSrc.slice(0, m.index).split('\n').length,
  });
}

/** `/buyers/${id}/contacts` -> `/api/buyers/:x/contacts` */
const normalise = (raw) =>
  ('/api' + raw.replace(/\$\{[^}]*\}/g, ':x')).replace(/\/+$/, '') || '/api';

/** Does a concrete call path match a route pattern containing :params? */
const matches = (callPath, pattern) => {
  const a = callPath.split('/').filter(Boolean);
  const b = pattern.split('/').filter(Boolean);
  if (a.length !== b.length) return false;
  return b.every((seg, i) => seg.startsWith(':') || a[i] === ':x' || seg === a[i]);
};

const missing = calls.filter(
  (c) => !routes.some((r) => r.method === c.method && matches(normalise(c.raw), r.pattern))
);

const unused = routes.filter(
  (r) => !calls.some((c) => c.method === r.method && matches(normalise(c.raw), r.pattern))
);

console.log(`Registered routes: ${routes.length}`);
console.log(`Frontend calls:    ${calls.length}`);

if (missing.length) {
  console.log(`\nBROKEN (${missing.length}) - frontend calls with no matching route:`);
  for (const m of missing) {
    console.log(`  api.ts:${m.line}  ${m.method} ${normalise(m.raw)}`);
  }
} else {
  console.log('\nOK - every frontend call maps to a registered route.');
}

// Advisory only: a route with no caller is often dead or renamed code, but some
// are legitimately reserved, so this never fails the build.
if (unused.length) {
  console.log(`\nRoutes the frontend never calls (${unused.length}, advisory):`);
  for (const r of unused) console.log(`  ${r.method} ${r.pattern}  (${r.file})`);
}

process.exit(missing.length ? 1 : 0);
