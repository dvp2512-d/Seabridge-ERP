/**
 * Extracts text from a PDF along with its position, so layout problems can be
 * diagnosed without rendering the page.
 *
 * PDFKit writes each run as a text matrix (Tm) giving x and y, followed by the
 * glyphs. Reading those coordinates back shows exactly where each label and value
 * was placed, which is what alignment complaints are really about.
 *
 * Also reports the drawn rectangles (`re`), since those are the cell borders - a
 * value sitting outside its box is visible as a coordinate outside the rect.
 *
 * Usage: bun scripts/inspect-pdf-layout.ts <file.pdf>
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const file = process.argv[2];
if (!file) {
  console.error('Usage: bun scripts/inspect-pdf-layout.ts <file.pdf>');
  process.exit(1);
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

function unescapePdf(s: string): string {
  return s
    .replace(/\\([nrtbf()\\])/g, (_, c) =>
      ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' } as Record<string, string>)[c] ?? c
    )
    .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
}

const raw = fs.readFileSync(file).toString('latin1');

// Find the page content stream: the one containing text operators.
let content = '';
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
  if (/\bBT\b/.test(text)) {
    content += text + '\n';
  }
}

if (!content) {
  console.error('no text content stream found');
  process.exit(1);
}

// ---- cell rectangles ----
interface Rect { x: number; y: number; w: number; h: number }
const rects: Rect[] = [];
for (const r of content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/g)) {
  rects.push({
    x: parseFloat(r[1]),
    y: parseFloat(r[2]),
    w: parseFloat(r[3]),
    h: parseFloat(r[4]),
  });
}

// ---- text runs with their position ----
interface Run { x: number; y: number; size: number; text: string }
const runs: Run[] = [];

// Track the most recent Tm and Tf so each glyph run can be attributed.
let curX = 0;
let curY = 0;
let curSize = 0;

const tokenRe =
  /([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) Tm|\/(F\d+) ([\d.]+) Tf|\[((?:[^\][]|\\.)*)\]\s*TJ|<([0-9A-Fa-f\s]+)>\s*Tj|\(((?:\\.|[^()\\])*)\)\s*Tj/g;

let t: RegExpExecArray | null;
while ((t = tokenRe.exec(content)) !== null) {
  if (t[1] !== undefined) {
    curX = parseFloat(t[5]);
    curY = parseFloat(t[6]);
    continue;
  }
  if (t[7] !== undefined) {
    curSize = parseFloat(t[8]);
    continue;
  }

  let str = '';
  const whole = t[0];
  for (const h of whole.matchAll(/<([0-9A-Fa-f\s]+)>/g)) str += hexToText(h[1]);
  for (const l of whole.matchAll(/\(((?:\\.|[^()\\])*)\)/g)) str += unescapePdf(l[1]);

  if (str.trim()) runs.push({ x: curX, y: curY, size: curSize, text: str });
}

// ---- report ----
console.log(`\n${file}`);
console.log(`text runs: ${runs.length}   rectangles: ${rects.length}\n`);

// Group runs by y so each visual line reads together. PDF y grows upward, and
// PDFKit flips the axis, so sort descending.
const lines = new Map<number, Run[]>();
for (const r of runs) {
  // Round to the nearest point so runs on the same baseline group together
  const key = Math.round(r.y);
  if (!lines.has(key)) lines.set(key, []);
  lines.get(key)!.push(r);
}

const sorted = [...lines.entries()].sort((a, b) => b[0] - a[0]);

console.log('   y      x        size  text');
console.log('  ' + '-'.repeat(76));
for (const [y, items] of sorted) {
  items.sort((a, b) => a.x - b.x);
  for (const item of items) {
    const label = item.text.length > 46 ? item.text.slice(0, 43) + '...' : item.text;
    console.log(
      `  ${String(y).padStart(5)}  ${item.x.toFixed(1).padStart(7)}  ${String(item.size).padStart(5)}  ${label}`
    );
  }
}

// ---- column edges, to spot values drifting out of their cell ----
const xs = [...new Set(rects.map((r) => Math.round(r.x)))].sort((a, b) => a - b);
console.log(`\ncell left edges: ${xs.join(', ')}`);
const widths = [...new Set(rects.map((r) => Math.round(r.w)))].sort((a, b) => a - b);
console.log(`cell widths    : ${widths.join(', ')}`);
