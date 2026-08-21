/**
 * Static contract check: every endpoint the frontend calls must exist on the API.
 *
 * TypeScript cannot catch these mismatches because API responses are `any`,
 * so a wrong path silently 404s at runtime. This script compares the axios
 * calls in apps/web/src/lib/api.ts against the Express routes.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const apiSrc = path.join(root, 'apps/api/src');
const webApiFile = path.join(root, 'apps/web/src/lib/api.ts');

// ---------- 1. Collect backend routes ----------
const indexTs = fs.readFileSync(path.join(apiSrc, 'index.ts'), 'utf8');

// app.use('/api/buyers', buyerRouter)  ->  routerVar => prefix
const mounts = new Map();
for (const m of indexTs.matchAll(/app\.use\(\s*['"](\/api\/[^'"]*)['"]\s*,\s*(\w+)\s*\)/g)) {
  mounts.set(m[2], m[1]);
}

// routerVar => file, via: export { router as buyerRouter }
const routerFileByVar = new Map();
for (const f of fs.readdirSync(path.join(apiSrc, 'routes'))) {
  if (!f.endsWith('.ts')) continue;
  const txt = fs.readFileSync(path.join(apiSrc, 'routes', f), 'utf8');
  for (const m of txt.matchAll(/export\s*\{\s*router\s+as\s+(\w+)\s*\}/g)) {
    routerFileByVar.set(m[1], f);
  }
}

/** @type {{method:string, path:string}[]} */
const backendRoutes = [];
for (const [routerVar, prefix] of mounts) {
  const file = routerFileByVar.get(routerVar);
  if (!file) {
    console.log(`WARN: no file exports router '${routerVar}' (mounted at ${prefix})`);
    continue;
  }
  const txt = fs.readFileSync(path.join(apiSrc, 'routes', file), 'utf8');
  for (const m of txt.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]*)['"]/g)) {
    const method = m[1].toUpperCase();
    let p = prefix + (m[2] === '/' ? '' : m[2]);
    p = p.replace(/\/+$/, '') || '/';
    backendRoutes.push({ method, path: p, file });
  }
}

// ---------- 2. Collect frontend calls ----------
const webTxt = fs.readFileSync(webApiFile, 'utf8');
/** @type {{method:string, path:string, line:number}[]} */
const frontendCalls = [];
webTxt.split(/\r?\n/).forEach((line, i) => {
  for (const m of line.matchAll(/\bapi\.(get|post|put|patch|delete)\(\s*[`'"]([^`'"]*)[`'"]/g)) {
    const method = m[1].toUpperCase();
    let p = '/api' + m[2];
    p = p.replace(/\/+$/, '') || '/';
    frontendCalls.push({ method, path: p, line: i + 1 });
  }
});

// ---------- 3. Compare (treat :params and ${...} as wildcards) ----------
function toRegex(routePath) {
  const escaped = routePath
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) return '[^/]+';
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return new RegExp(`^${escaped}$`);
}

function normaliseFrontend(p) {
  // `${id}` -> wildcard placeholder
  return p.replace(/\$\{[^}]*\}/g, '__PARAM__');
}

const unmatched = [];
for (const call of frontendCalls) {
  const fePath = normaliseFrontend(call.path);
  const hit = backendRoutes.some((r) => {
    if (r.method !== call.method) return false;
    const re = toRegex(r.path);
    return re.test(fePath.replace(/__PARAM__/g, 'X')) || re.test(fePath);
  });
  if (!hit) unmatched.push(call);
}

console.log(`Backend routes found : ${backendRoutes.length}`);
console.log(`Frontend calls found : ${frontendCalls.length}`);

if (unmatched.length === 0) {
  console.log('\nRESULT: OK - every frontend call maps to a backend route.');
} else {
  console.log(`\nRESULT: ${unmatched.length} FRONTEND CALL(S) WITH NO MATCHING ROUTE:`);
  for (const u of unmatched) {
    console.log(`  api.ts:${u.line}  ${u.method} ${u.path}`);
  }
}

// Also list backend routes never called (informational only)
const uncalled = backendRoutes.filter((r) => {
  return !frontendCalls.some((c) => {
    if (c.method !== r.method) return false;
    return toRegex(r.path).test(normaliseFrontend(c.path).replace(/__PARAM__/g, 'X'));
  });
});
if (uncalled.length) {
  console.log('\n(info) Backend routes not referenced by the API client:');
  for (const r of uncalled) console.log(`  ${r.method} ${r.path}   [${r.file}]`);
}
