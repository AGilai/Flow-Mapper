// View · Edit toggle of a design environment (never shown on a sealed one). Edit works inside a draft: with no draft open it asks which.

import { h } from '../dom.js';
import { state, setDesign } from '../state.js';

/** modeToggle({ onNeedDraft }) -> the .seg. `onNeedDraft(anchorEl)` opens the draft picker when Edit is chosen with no draft. */
let pending = null;
/** After the page re-renders (a mode change redraws it), put focus back on the toggle button that was used. */
export function restoreFocus(root) { if (pending) root.querySelector(`[data-qa=${pending}]`)?.focus(); pending = null; }

export function modeToggle({ onNeedDraft }) {
  const btn = (mode, label) => h('button', { type: 'button', 'data-qa': `mode-${mode}`, 'aria-pressed': String(state.mode === mode),
    on: { click: (e) => {
      if (mode === 'edit' && !state.draft) { onNeedDraft(e.currentTarget); return; }
      if (state.mode !== mode) { pending = `mode-${mode}`; setDesign({ mode }); }
    } } }, label);
  return h('div.seg', { role: 'group', 'aria-label': 'Mode' }, btn('view', 'View'), btn('edit', 'Edit'));
}
