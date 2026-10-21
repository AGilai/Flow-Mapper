// The draft bar's Edit menu (frame 14b): what can be done to the open draft as a whole. Today: Import Mermaid.

import { openMenu } from '../components/context-menu.js';

export function openEditMenu(anchor) {
  const r = anchor.getBoundingClientRect();
  const back = (e) => { if (e.key === 'Escape') setTimeout(() => anchor.focus()); removeEventListener('keydown', back, true); };
  addEventListener('keydown', back, true); setTimeout(() => removeEventListener('keydown', back, true), 20000);
  openMenu(r.left, r.bottom + 4, 'Edit draft', [{ label: 'Import Mermaid…', hint: 'into this draft', onSelect: async () => (await import('./mermaid-dialog.js')).openMermaidImport() }]);
}
