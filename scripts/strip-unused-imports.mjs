/**
 * Removes unused import specifiers reported by TypeScript (TS6133).
 *
 * It only touches import statements, and only removes the exact named
 * specifier tsc flagged - so no behavioural code is ever modified.
 * Non-import unused variables are reported for manual review instead.
 *
 * Usage: node scripts/strip-unused-imports.mjs <tsc-output-file>
 */
import fs from 'node:fs';
import path from 'node:path';

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('Usage: node strip-unused-imports.mjs <tsc-output-file>');
  process.exit(1);
}

const webRoot = path.resolve('C:/Users/Dhruvil.Patel/Projects/seabridge-ERP/apps/web');
const lines = fs.readFileSync(reportPath, 'utf8').split(/\r?\n/);

// e.g. src/pages/Orders.tsx(4,10): error TS6133: 'Link' is declared but its value is never read.
const re = /^(.+?)\((\d+),(\d+)\): error TS6133: '(.+?)' is declared but its value is never read\./;

/** @type {Map<string, Set<string>>} */
const byFile = new Map();
for (const line of lines) {
  const m = re.exec(line.trim());
  if (!m) continue;
  const [, file, , , name] = m;
  if (!byFile.has(file)) byFile.set(file, new Set());
  byFile.get(file).add(name);
}

const manualReview = [];

for (const [relFile, names] of byFile) {
  const abs = path.join(webRoot, relFile);
  if (!fs.existsSync(abs)) {
    console.log(`SKIP (missing): ${relFile}`);
    continue;
  }

  let src = fs.readFileSync(abs, 'utf8');
  const removed = [];

  for (const name of names) {
    // Find import statements and try to remove `name` from the named bindings.
    const importRe = /import\s+([^;]*?)\s+from\s+['"][^'"]+['"];/gs;
    let changed = false;

    src = src.replace(importRe, (stmt) => {
      if (changed) return stmt;

      // Only operate inside the { ... } named-binding section.
      const braceMatch = /\{([\s\S]*?)\}/.exec(stmt);

      // Default import like: import PageHeader from '...'
      if (!braceMatch) {
        const defaultRe = new RegExp(`^import\\s+${name}\\s+from\\s+['"][^'"]+['"];$`);
        if (defaultRe.test(stmt.trim())) {
          changed = true;
          return '';
        }
        return stmt;
      }

      const parts = braceMatch[1]
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);

      if (!parts.some((p) => p === name || p.startsWith(`${name} as `))) return stmt;

      const kept = parts.filter((p) => p !== name && !p.startsWith(`${name} as `));
      changed = true;

      // If nothing is left in the braces, drop the whole statement (unless it
      // also has a default import before the braces).
      const hasDefaultToo = /import\s+\w+\s*,\s*\{/.test(stmt);
      if (kept.length === 0 && !hasDefaultToo) return '';

      const multiline = braceMatch[1].includes('\n');
      const inner = multiline
        ? `{\n  ${kept.join(',\n  ')},\n}`
        : `{ ${kept.join(', ')} }`;
      return stmt.replace(/\{[\s\S]*?\}/, inner);
    });

    if (changed) removed.push(name);
    else manualReview.push(`${relFile}: ${name}`);
  }

  // Clean up any blank lines left behind by fully removed imports.
  src = src.replace(/^[ \t]*\n(?=import )/gm, '');

  fs.writeFileSync(abs, src, 'utf8');
  console.log(`${relFile}: removed [${removed.join(', ')}]`);
}

if (manualReview.length) {
  console.log('\n--- NEEDS MANUAL REVIEW (not a plain import) ---');
  for (const m of manualReview) console.log(m);
}
