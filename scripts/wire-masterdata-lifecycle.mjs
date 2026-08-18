/**
 * Adds deactivate/reactivate to the five Master Data tabs.
 *
 * Each tab is its own component taking an onEdit prop, so the lifecycle callback
 * has to be threaded through the same way. Scripted because the five
 * transformations are identical and hand-editing invites one drifting.
 */
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('apps/web/src/pages/MasterData.tsx');
let src = fs.readFileSync(file, 'utf8');

/** component name -> lifecycle resource segment and the field holding its label */
const TABS = [
  { component: 'CountriesTab', resource: 'countries', varName: 'c' },
  { component: 'CurrenciesTab', resource: 'currencies', varName: 'c' },
  { component: 'IncotermsTab', resource: 'incoterms', varName: 'i' },
  { component: 'CategoriesTab', resource: 'product-categories', varName: 'c' },
  { component: 'PortsTab', resource: 'ports', varName: 'p' },
];

let changes = 0;

// ---- 1. widen each tab's props to accept the lifecycle callback ----
for (const tab of TABS) {
  const sig = `function ${tab.component}({ onEdit }: { onEdit: (item: any) => void })`;
  const newSig =
    `function ${tab.component}({\n` +
    `  onEdit,\n` +
    `  onLifecycle,\n` +
    `}: {\n` +
    `  onEdit: (item: any) => void;\n` +
    `  /** Deactivate or reactivate, handled by the parent so the dialog is shared */\n` +
    `  onLifecycle: (kind: 'deactivate' | 'reactivate', id: string, label: string) => void;\n` +
    `})`;

  if (src.includes(sig)) {
    src = src.replace(sig, newSig);
    changes++;
  }
}

// ---- 2. swap each Edit button for RowActions ----
for (const tab of TABS) {
  const v = tab.varName;
  const oldCell =
    `                  <button onClick={() => onEdit(${v})} className="text-navy-600 hover:text-navy-800">\n` +
    `                    <Edit2 className="w-4 h-4" />\n` +
    `                  </button>`;

  const newCell =
    `                  <RowActions\n` +
    `                    onEdit={() => onEdit(${v})}\n` +
    `                    editPermission="MASTER_MANAGE"\n` +
    `                    destructiveKind="deactivate"\n` +
    `                    onDestructive={\n` +
    `                      ${v}.isActive\n` +
    `                        ? () => onLifecycle('deactivate', ${v}.id, ${v}.name ?? ${v}.code)\n` +
    `                        : undefined\n` +
    `                    }\n` +
    `                    onReactivate={\n` +
    `                      !${v}.isActive\n` +
    `                        ? () => onLifecycle('reactivate', ${v}.id, ${v}.name ?? ${v}.code)\n` +
    `                        : undefined\n` +
    `                    }\n` +
    `                  />`;

  if (src.includes(oldCell)) {
    src = src.replace(oldCell, newCell);
    changes++;
  } else {
    console.log(`  note: ${tab.component} cell not matched (indentation may differ)`);
  }
}

// ---- 3. pass the callback in from the parent ----
for (const tab of TABS) {
  const oldUse = `<${tab.component} onEdit={(item) => { setEditItem(item); setShowModal(true); }} />`;
  const newUse =
    `<${tab.component}\n` +
    `              onEdit={(item) => { setEditItem(item); setShowModal(true); }}\n` +
    `              onLifecycle={(kind, id, label) =>\n` +
    `                lifecycle.request({ kind, resource: '${tab.resource}' }, id, label)\n` +
    `              }\n` +
    `            />`;

  if (src.includes(oldUse)) {
    src = src.replace(oldUse, newUse);
    changes++;
  }
}

fs.writeFileSync(file, src);
console.log(`  MasterData: ${changes} edits applied`);
