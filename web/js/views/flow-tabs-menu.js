// The "N more" menu of the tab row (frame 28): the tabs that do not fit, each with a close button, then "Close others" and "Close all".
// The active tab never goes in here (it is always in the row). It draws what it is given; the strip (flow-tabs.js) owns the state.

import { h, fill } from '../dom.js';

const X = 'M4 4l8 8 M12 4l-8 8';
const svg = (d) => h('svg', { viewBox: '0 0 16 16', html: `<path d="${d}"/>`, 'aria-hidden': 'true' });

/** createMoreMenu({ anchor (the row, which the menu hangs in), button, rows() -> [{ key, title, sub, tn, color, chip }], onPick(key), onClose(key), onCloseOthers(), onCloseAll(), paint(el, key, color) }) -> { toggle, close, redraw, isOpen } */
export function createMoreMenu({ anchor, button, rows, onPick, onClose, onCloseOthers, onCloseAll, paint }) {
  let pop = null, list = null;
  const outside = (e) => { if (pop && !pop.contains(e.target) && !button.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); button.focus(); } };
  function redraw() {
    if (!pop) return;
    const rs = rows();
    pop.querySelector('.tabpop-h').textContent = `${rs.length} more ${rs.length === 1 ? 'tab' : 'tabs'}`;
    fill(list, rs.map((r) => paint(h('div.ctx-item.tabrow', { role: 'option' },
      h('button.tabrow-b', { type: 'button', on: { click: () => { close(); onPick(r.key); } } }, r.tn ? h('span.tn', r.tn) : null, r.chip, h('span.tl', h('b', r.title), r.sub ? h('i', { title: r.sub }, r.sub) : null)),
      h('button.x', { type: 'button', 'aria-label': `Close ${r.title}`, on: { click: () => onClose(r.key) } }, svg(X))), r.key, r.color)));
    if (!rs.length) close();
  }
  function toggle() {
    if (pop) return close();
    list = h('div.tabpop-list', { role: 'listbox', 'aria-label': 'More open flows' });
    pop = h('div.tabpop', { role: 'dialog', 'aria-label': 'More open flows', 'data-qa': 'tab-more-menu' }, h('div.tabpop-h-w', h('b.tabpop-h'), h('span.xs.muted', 'the active tab never goes in here')), list,
      h('div.tabpop-f', h('button.btn.sm', { type: 'button', on: { click: () => { close(); onCloseOthers(); } } }, 'Close others'), h('span.grow'),
        h('button.btn.sm', { type: 'button', on: { click: () => { close(); onCloseAll(); } } }, 'Close all')));
    redraw();
    anchor.append(pop);
    button.classList.add('open'); button.setAttribute('aria-expanded', 'true');
    setTimeout(() => { addEventListener('pointerdown', outside, true); addEventListener('keydown', onKey, true); });
    pop.querySelector('button')?.focus({ preventScroll: true });
  }
  function close() {
    pop?.remove(); pop = null; list = null;
    button.classList.remove('open'); button.setAttribute('aria-expanded', 'false');
    removeEventListener('pointerdown', outside, true); removeEventListener('keydown', onKey, true);
  }
  return { toggle, close, redraw, isOpen: () => !!pop };
}
