// The (i) on a flow tab (frame 28): the flow's About text and related flows in a popover under the tab. Stage 3 of the redesign replaces it with the flow doc.
// The About region itself is made by the tab's view (flow-head.js `descDetails`); this only hangs it under the button and takes it away again.

import { h } from '../dom.js';

/** createAboutPop({ aboutOf(key) -> { el, open(on) } | null }) -> { open(key, anchor), close(), isOpen() } */
export function createAboutPop({ aboutOf }) {
  let pop = null;
  function close() { pop?.off(); pop?.el.remove(); pop = null; }
  function open(key, anchor) {
    if (pop) { close(); return; } // a second press closes it
    const a = aboutOf(key);
    if (!a) return;
    a.open(true);
    const el = h('div.about-pop', { role: 'dialog', 'aria-label': 'About this flow', 'data-qa': 'about-pop' }, a.el), r = anchor.getBoundingClientRect(), w = Math.min(600, innerWidth - 16);
    Object.assign(el.style, { top: `${Math.round(r.bottom + 6)}px`, left: `${Math.max(8, Math.min(r.left - 40, innerWidth - w - 8))}px`, width: `${w}px`, maxHeight: `${Math.max(160, innerHeight - r.bottom - 20)}px` });
    document.body.append(el);
    const down = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target) && !e.target.closest('.ctx-menu, .toast')) close(); };
    const key2 = (e) => { if (e.key === 'Escape' && !e.target.closest?.('textarea, input')) { close(); anchor.focus?.(); } };
    setTimeout(() => { addEventListener('pointerdown', down, true); addEventListener('keydown', key2, true); });
    pop = { el, off: () => { removeEventListener('pointerdown', down, true); removeEventListener('keydown', key2, true); } };
  }
  return { open, close, isOpen: () => !!pop };
}
