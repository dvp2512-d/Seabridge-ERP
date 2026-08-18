/**
 * Adds a "Show inactive" toggle to the master data lists.
 *
 * Deactivation is reversible, but only if the deactivated rows can be seen. The
 * list endpoints already accept an isActive filter, so this is purely a matter of
 * passing it and offering the switch.
 *
 * Usage: node scripts/wire-inactive-toggle.mjs <PageName> <apiCall> <queryKey>
 *   e.g. node scripts/wire-inactive-toggle.mjs Products productsApi.list products
 */
import fs from 'node:fs';
import path from 'node:path';

const [pageName, apiCall, queryKey] = process.argv.slice(2);
if (!pageName || !apiCall || !queryKey) {
  console.error('Usage: node wire-inactive-toggle.mjs <PageName> <apiCall> <queryKey>');
  process.exit(1);
}

const file = path.resolve('apps/web/src/pages', `${pageName}.tsx`);
let src = fs.readFileSync(file, 'utf8');
const report = [];

// ---- 1. state ----
if (!src.includes('showInactive')) {
  const anchor = `  const lifecycle = useLifecycleActions(['${queryKey}']);`;
  if (!src.includes(anchor)) {
    console.error(`  lifecycle hook not found in ${pageName}`);
    process.exit(1);
  }
  src = src.replace(
    anchor,
    anchor +
      '\n  // Deactivated rows are hidden by default. Revealing them is what makes a\n' +
      '  // deactivation reversible without database access.\n' +
      '  const [showInactive, setShowInactive] = useState(false);'
  );
  report.push('state');
}

// ---- 2. include it in the query key so toggling refetches ----
const keyRe = new RegExp(`queryKey: \\['${queryKey}'([^\\]]*)\\]`);
const keyMatch = src.match(keyRe);
if (keyMatch && !keyMatch[0].includes('showInactive')) {
  src = src.replace(keyRe, `queryKey: ['${queryKey}'$1, showInactive]`);
  report.push('query key');
}

// ---- 3. pass the filter ----
// Only request active records unless the toggle is on; undefined means "no
// filter", which is what returns both.
const callIdx = src.indexOf(`${apiCall}({`);
if (callIdx !== -1 && !src.slice(callIdx, callIdx + 400).includes('isActive')) {
  const insertAt = callIdx + `${apiCall}({`.length;
  src = src.slice(0, insertAt) + `\n      isActive: showInactive ? undefined : true,` + src.slice(insertAt);
  report.push('filter');
} else if (callIdx === -1) {
  console.log(`  note: could not find ${apiCall}({ in ${pageName} - filter not added`);
}

// ---- 4. the switch itself, placed after the search input's container ----
if (!src.includes('Show inactive')) {
  const toggle = [
    '',
    '            <label className="flex items-center gap-2 text-sm text-gray-600 whitespace-nowrap">',
    '              <input',
    '                type="checkbox"',
    '                checked={showInactive}',
    '                onChange={(e) => setShowInactive(e.target.checked)}',
    '                className="rounded border-gray-300"',
    '              />',
    '              Show inactive',
    '            </label>',
  ].join('\n');

  // Anchor on the end of the filter row: the last </div> before the table card.
  const tableIdx = src.search(/<table className="table">/);
  if (tableIdx === -1) {
    console.log(`  note: no table found in ${pageName} - toggle not added`);
  } else {
    const closeIdx = src.lastIndexOf('</div>', tableIdx);
    const lineStart = src.lastIndexOf('\n', closeIdx);
    src = src.slice(0, lineStart) + toggle + src.slice(lineStart);
    report.push('toggle');
  }
}

fs.writeFileSync(file, src);
console.log(`  ${pageName}: ${report.length ? report.join(', ') : 'no changes'}`);
