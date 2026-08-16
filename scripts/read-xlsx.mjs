/**
 * Dumps the cell contents of an extracted .xlsx so the templates can be read.
 *
 * Usage: node scripts/read-xlsx.mjs <extracted-dir> [sheetNumber]
 *
 * An .xlsx is a zip of XML. Strings live in xl/sharedStrings.xml and cells
 * reference them by index, so both files are needed to reconstruct the grid.
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
const onlySheet = process.argv[3] ? parseInt(process.argv[3]) : null;

if (!dir) {
  console.error('Usage: node read-xlsx.mjs <extracted-dir> [sheetNumber]');
  process.exit(1);
}

/** Strip XML tags and decode the handful of entities that appear in cells. */
function decode(xml) {
  return xml
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

// ---- shared strings ----
const sharedPath = path.join(dir, 'xl', 'sharedStrings.xml');
let shared = [];
if (fs.existsSync(sharedPath)) {
  const xml = fs.readFileSync(sharedPath, 'utf8');
  // Each <si> is one string; it may be split across multiple <t> runs.
  shared = [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => {
    const runs = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1]));
    return runs.join('');
  });
}

// ---- sheet names ----
const wbXml = fs.readFileSync(path.join(dir, 'xl', 'workbook.xml'), 'utf8');
const names = [...wbXml.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map((m) => decode(m[1]));

// ---- merged cells tell us where headings span columns ----
function mergedRanges(sheetXml) {
  return [...sheetXml.matchAll(/<mergeCell ref="([^"]+)"/g)].map((m) => m[1]);
}

const sheetFiles = fs
  .readdirSync(path.join(dir, 'xl', 'worksheets'))
  .filter((f) => /^sheet\d+\.xml$/.test(f))
  .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));

sheetFiles.forEach((file, index) => {
  const num = index + 1;
  if (onlySheet && num !== onlySheet) return;

  const xml = fs.readFileSync(path.join(dir, 'xl', 'worksheets', file), 'utf8');
  console.log('\n' + '='.repeat(78));
  console.log(`SHEET ${num}: ${names[index] ?? file}`);
  console.log('='.repeat(78));

  // Build a row -> column -> value grid
  const rows = new Map();
  for (const rowMatch of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowNum = parseInt(rowMatch[1]);
    const cells = new Map();

    for (const c of rowMatch[2].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const col = c[1];
      const attrs = c[2];
      const body = c[3];

      let value = '';
      const isShared = /t="s"/.test(attrs);
      const isInline = /t="(inlineStr|str)"/.test(attrs);
      const v = body.match(/<v>([\s\S]*?)<\/v>/);

      if (isShared && v) value = shared[parseInt(v[1])] ?? '';
      else if (isInline) value = decode(body);
      else if (v) value = decode(v[1]);

      // A formula cell shows its formula, which reveals the calculation intent
      const f = body.match(/<f>([\s\S]*?)<\/f>/);
      if (f) value = value ? `${value}   [=${decode(f[1])}]` : `[=${decode(f[1])}]`;

      if (value.trim() !== '') cells.set(col, value.trim());
    }
    if (cells.size > 0) rows.set(rowNum, cells);
  }

  const sortedRows = [...rows.keys()].sort((a, b) => a - b);
  for (const r of sortedRows) {
    const cells = rows.get(r);
    const parts = [...cells.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([col, val]) => `${col}: ${val}`);
    console.log(`  r${String(r).padStart(3)} | ${parts.join('  |  ')}`);
  }

  const merges = mergedRanges(xml);
  if (merges.length) {
    console.log(`\n  merged ranges (${merges.length}): ${merges.slice(0, 30).join(', ')}${merges.length > 30 ? ' ...' : ''}`);
  }
});
