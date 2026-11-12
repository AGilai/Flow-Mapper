// The "View" popover of the minimized flow header (Unreleased, #106 round 2): while the header is minimized the page's view toolbar (.seq-toolbar) and the muted
// "Harvested" line are hidden from the page; this popover hosts the real nodes (moved, never copied, so every handler keeps working) and puts them back on close.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { popPlace } from './flow-headmin-pure.js';

let open = null; // { pop, btn, parts: [{ node, mark }], off }
export const closeViewPop = () => { open?.close(); };

/** viewButton() -> the strip's "View" button (sliders icon and label, aria-haspopup, aria-expanded). */
export function viewButton() {
  const btn = h('button.btn.sm.hs-view', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'View options', title: 'View options: mode, depth, zoom, step details', 'data-qa': 'view-options' }, icon('sliders'), h('span.hs-view-l', 'View'));
  btn.addEventListener('click', (e) => { e.preventDefault(); if (open?.btn === btn) closeViewPop(); else openViewPop(btn); });
  return btn;
}

function openViewPop(btn) {
  closeViewPop();
  const nodes = ['.flows-main > .seq-toolbar', '.flows-main > .pen-hint'].map((q) => document.querySelector(q)).filter(Boolean);
  if (!nodes.length) return;
  const pop = h('div.hs-pop', { role: 'dialog', 'aria-label': 'View options', 'data-qa': 'view-pop' });
  const parts = nodes.map((node) => { const mark = document.createComment('view'); node.replaceWith(mark); return { node, mark }; });
  pop.append(...parts.map((p) => p.node).reverse()); // the Harvested line on top, the toolbar under it
  document.body.append(pop);
  const place = () => { const p = popPlace({ rect: btn.getBoundingClientRect(), vw: innerWidth, vh: innerHeight }); Object.assign(pop.style, { top: `${p.top}px`, right: `${p.right}px`, width: `${p.width}px`, maxHeight: `${p.maxHeight}px` }); };
  place(); btn.setAttribute('aria-expanded', 'true');
  const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close(); btn.focus({ preventScroll: true }); } };
  const onDown = (e) => { if (!pop.contains(e.target) && !btn.contains(e.target)) close(); };
  const off = () => { removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown, true); removeEventListener('resize', place); };
  function close() { off(); parts.forEach((p) => p.mark.replaceWith(p.node)); pop.remove(); btn.setAttribute('aria-expanded', 'false'); if (open?.pop === pop) open = null; }
  addEventListener('keydown', onKey); document.addEventListener('pointerdown', onDown, true); addEventListener('resize', place);
  open = { pop, btn, close };
}
