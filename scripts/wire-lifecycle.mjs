/**
 * Adds the lifecycle plumbing to a list page: the hook, the confirmation dialog
 * and a "Show inactive" toggle.
 *
 * Written as a script because ten pages need exactly the same three additions,
 * and doing it by hand invites one of them being subtly different.
 *
 * Usage: node scripts/wire-lifecycle.mjs <PageName> <queryKey> [--no-toggle]
 */
import fs from 'node:fs';
import path from 'node:path';

const [pageName, queryKey, ...flags] = process.argv.slice(2);
if (!pageName || !queryKey) {
  console.error('Usage: node wire-lifecycle.mjs <PageName> <queryKey> [--no-toggle]');
  process.exit(1);
}

const noToggle = flags.includes('--no-toggle');
const file = path.resolve('apps/web/src/pages', `${pageName}.tsx`);

if (!fs.existsSync(file)) {
  console.error(`not found: ${file}`);
  process.exit(1);
}

let src = fs.readFileSync(file, 'utf8');
const original = src;
const report = [];

// ---- 1. imports -----------------------------------------------------------
if (!src.includes('useLifecycleActions')) {
  // Anchor on the last existing @/ import so the block lands with the others.
  const importRe = /^import .*from '@\/[^']+';$/gm;
  const matches = [...src.matchAll(importRe)];
  if (matches.length === 0) {
    console.error('  no @/ imports found to anchor onto');
    process.exit(1);
  }
  const last = matches[matches.length - 1];
  const insertAt = last.index + last[0].length;

  const block = [
    '',
    "import RowActions from '@/components/ui/RowActions';",
    "import ConfirmDialog from '@/components/ui/ConfirmDialog';",
    "import { useLifecycleActions } from '@/hooks/useLifecycleActions';",
  ].join('\n');

  src = src.slice(0, insertAt) + block + src.slice(insertAt);
  report.push('imports added');
}

// ---- 2. the hook ----------------------------------------------------------
if (!src.includes('const lifecycle =')) {
  // Place it after the first useState in the component, which is reliably inside
  // the function body and before the return.
  const stateRe = /^(\s*)const \[[^\]]+\] = useState[^;]*;$/m;
  const m = src.match(stateRe);
  if (!m) {
    console.error('  no useState found to anchor the hook onto');
    process.exit(1);
  }
  const indent = m[1];
  const insertAt = m.index + m[0].length;

  const lines = [
    '',
    `${indent}// Deactivate / cancel flow, shared with every other list so the`,
    `${indent}// wording and confirmations stay consistent.`,
    `${indent}const lifecycle = useLifecycleActions(['${queryKey}']);`,
  ];
  if (!noToggle) {
    lines.push(
      `${indent}// Deactivated records are hidden by default; this reveals them so a`,
      `${indent}// deactivation can be reversed.`,
      `${indent}const [showInactive, setShowInactive] = useState(false);`
    );
  }

  src = src.slice(0, insertAt) + lines.join('\n') + src.slice(insertAt);
  report.push('hook added');
}

// ---- 3. the confirmation dialog ------------------------------------------
if (!src.includes('<ConfirmDialog')) {
  /**
   * Must land inside the DEFAULT EXPORTED component, not whichever component
   * happens to be last in the file. Most of these pages define modal components
   * below the main one, so anchoring on the final closing tag puts the dialog in
   * the wrong scope and `lifecycle` is then out of reach.
   */
  const exportIdx = src.search(/^export default function \w+/m);
  if (exportIdx === -1) {
    console.error('  no default exported component found');
    process.exit(1);
  }

  // The first `  );` + `}` after the export closes that component's return.
  // Must tolerate CRLF: some of these files use \r\n and an \n-only pattern
  // silently fails to match, which looks like "component not found".
  const endRe = /\r?\n {2}\);\r?\n\}/;
  const tail = src.slice(exportIdx);
  const endMatch = tail.match(endRe);
  if (!endMatch) {
    console.error('  could not find the end of the exported component');
    process.exit(1);
  }
  const endIdx = exportIdx + endMatch.index;

  /**
   * Anchor on the root element's OPENING tag rather than a closing one.
   *
   * Closing-tag anchors proved fragile: indentation differs per file, and the
   * last `</div>` before the component ends is often a conditional block rather
   * than the root. Inserting immediately after the root opens is unambiguous and
   * always valid JSX, since the dialog renders nothing until triggered.
   */
  const returnIdx = src.indexOf('return (', exportIdx);
  if (returnIdx === -1 || returnIdx > endIdx) {
    console.error('  could not find the return statement');
    process.exit(1);
  }

  // End of the first opening tag after `return (`
  const tagStart = src.indexOf('<', returnIdx);
  const tagEnd = src.indexOf('>', tagStart);
  if (tagStart === -1 || tagEnd === -1) {
    console.error('  could not find the root element');
    process.exit(1);
  }

  const dialog = [
    '',
    '      {/* Confirmation for deactivate, cancel and delete */}',
    '      {lifecycle.dialog && (',
    '        <ConfirmDialog',
    '          isOpen',
    '          title={lifecycle.dialog.title}',
    '          message={lifecycle.dialog.message}',
    '          consequences={lifecycle.dialog.consequences}',
    '          tone={lifecycle.dialog.tone}',
    '          requireTyping={lifecycle.dialog.requireTyping}',
    '          confirmLabel={lifecycle.dialog.confirmLabel}',
    '          isPending={lifecycle.isPending}',
    '          onConfirm={lifecycle.confirm}',
    '          onCancel={lifecycle.dismiss}',
    '        />',
    '      )}',
  ].join('\n');

  src = src.slice(0, tagEnd + 1) + dialog + src.slice(tagEnd + 1);
  report.push('dialog added');
}

if (src === original) {
  console.log(`  ${pageName}: already wired, nothing to do`);
} else {
  fs.writeFileSync(file, src);
  console.log(`  ${pageName}: ${report.join(', ')}`);
}
