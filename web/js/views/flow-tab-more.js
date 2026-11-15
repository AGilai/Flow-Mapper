// The items of the toolbar's ⋯ menu for one flow tab (frame 28): what the old title row held, Export (Copy Mermaid, Download .mmd), Import Mermaid in Edit, Edit flow, and the flow's links.

import { exportItems } from '../design/mermaid-export.js';
import { safeUrl } from '../components/ext-links.js';

/** moreItems({ flowBox (null for a sub-flow tab: no items), root, env, name, view() (the tab's scenario), editing, flowEdit (the Edit flow button | null), links }) -> context-menu items */
export function moreItems({ flowBox, root, env, name, view, editing, flowEdit, links }) {
  const items = [];
  if (flowBox) items.push(...exportItems({ ...root, env, name, view }));
  if (flowBox && editing) items.push({ label: 'Import Mermaid…', icon: 'upload', hint: 'Into this draft', onSelect: async () => (await import('../design/mermaid-dialog.js')).openMermaidImport() });
  if (flowEdit) items.push({ label: 'Edit flow…', icon: 'edit', hint: editing ? 'Name, entry point and handler' : 'The same form, in a draft', onSelect: () => flowEdit.click() }); // the button is in the toolbar (hidden under ⋯), so a View-mode draft menu opens there
  const ls = [links?.main, ...(links?.sub ?? [])].filter((l) => l && safeUrl(l.url));
  if (ls.length) items.push('divider', ...ls.map((l) => ({ label: l.label || l.url, icon: 'external', hint: 'Opens in a new tab', onSelect: () => window.open(l.url, '_blank', 'noopener,noreferrer') })));
  return items;
}
