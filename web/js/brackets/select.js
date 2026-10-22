// Making a range of steps to comment on (0.34.0, frame 20f): shift-click a second step number (the first click is the usual selection), or drag along the
// empty gutter beside the diagram, or Shift+Arrow from the current step. The chosen steps take the yellow band, and a small popover under the last of them
// has one primary button, "Comment on steps 4-9". Esc, the close button or a click elsewhere clears it.

import { h } from '../dom.js';
import { rangeAction, ordered, stepAtY } from '../comments/range.js';

/** createSelect({ gutter, walk, factor(), y0(), rows(), span(from, to) -> { top, bottom }, create(from, to), width(), paint() }) -> { bind(laneBox), pick(n, ev) -> boolean, extend(dir), paint(), clear(), dispose() } */
export function createSelect({ gutter, walk, factor, y0, rows, span, create, width, paint }) {
  let range = null, anchorN = null, endN = null, box = null, drag = null;

  function clear() { if (!range && !drag) return; range = null; anchorN = endN = null; drag = null; walk.hlRange(null); paint(); }
  function set(a, b) { const r = ordered(a, b); anchorN = a; endN = b; range = r; walk.hlRange(r ? r.from : null, r ? r.to : null); paint(); if (r) gutter.querySelector('.cb-pop button.primary')?.focus({ preventScroll: true }); }

  /** Draw the chosen range: a dashed bracket and, once chosen, the popover. Called after every paint of the gutter (it empties it). */
  function paintSel() {
    const r = drag ?? range;
    if (!r) return;
    const s = span(r.from, r.to); if (!s) return;
    gutter.prepend(h('div.cb-band', { style: { top: `${s.top}px`, height: `${s.bottom - s.top}px`, width: `${width()}px` } }));
    gutter.append(h('div.cb-sel', { style: { top: `${s.top}px`, height: `${Math.max(8, s.bottom - s.top)}px` } }, h('i'), h('i')));
    if (!range) return;
    gutter.append(h('div.cb-pop', { role: 'dialog', 'aria-label': 'Comment on a range of steps', 'data-qa': 'cb-pop', style: { top: `${s.bottom + 6}px`, left: `${width() + 10}px` } },
      h('span.cb-chip', `steps ${range.from}–${range.to}`),
      h('button.btn.sm.primary', { type: 'button', 'data-qa': 'cb-comment', on: { click: () => { const x = range; clear(); create?.(x.from, x.to); } } }, rangeAction(range.from, range.to)),
      h('button.cb-x', { type: 'button', 'aria-label': 'Clear the selection', title: 'Clear (Esc)', on: { click: () => clear() } }, '✕')));
  }

  const yOf = (e) => (e.clientY - box.getBoundingClientRect().top - y0()) / factor();
  function onDown(e) { // only the empty gutter (the lane's own padding): a bracket or a bubble handles its own click
    if (e.button || e.target !== box || !box.classList.contains('cb-on') || e.clientX - box.getBoundingClientRect().left > width()) return;
    const a = stepAtY(rows(), yOf(e));
    if (a == null) return;
    e.preventDefault(); box.setPointerCapture?.(e.pointerId);
    range = null; walk.hlRange(null);
    let moved = false;
    drag = { from: a, to: a };
    const move = (ev) => { const b = stepAtY(rows(), yOf(ev)); if (b == null) return; const o = ordered(a, b); moved = moved || !!o; drag = { from: Math.min(a, b), to: Math.max(a, b) }; walk.hlRange(o ? drag.from : null, o ? drag.to : null); paint(); };
    const up = (ev) => {
      box.removeEventListener('pointermove', move); box.removeEventListener('pointerup', up); box.removeEventListener('pointercancel', up);
      const b = stepAtY(rows(), yOf(ev)) ?? a; drag = null;
      if (!moved && b === a) { walk.hlRange(null); paint(); walk.go(a); return; } // a click in the gutter is a click on that step
      set(a, b);
    };
    box.addEventListener('pointermove', move); box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  }
  const onKey = (e) => { if (e.key === 'Escape' && range) { e.preventDefault(); clear(); } };
  const onOut = (e) => { if (range && !e.target.closest?.('.cb-pop') && !(e.shiftKey && e.target.closest?.('.steptile'))) clear(); };
  document.addEventListener('keydown', onKey); document.addEventListener('pointerdown', onOut, true);

  return {
    bind(laneBox) { if (box === laneBox) return; box?.removeEventListener('pointerdown', onDown); box = laneBox; box.addEventListener('pointerdown', onDown); },
    /** A step number was clicked: with Shift, and a step already chosen, that is the other end of a range (true: handled). */
    pick(n, ev) {
      if (!ev?.shiftKey || !walk.picked()) { if (range) clear(); return false; }
      const a = range ? anchorN : walk.current();
      if (a === n) { clear(); return false; }
      ev.preventDefault?.(); set(a, n);
      return true;
    },
    /** Shift+Arrow from the current step: one step more (or less) in that direction. */
    extend(dir) {
      const total = walk.steps().length; if (!total) return;
      const a = range ? anchorN : walk.current(), b = Math.max(1, Math.min(total, (range ? endN : a) + dir));
      if (b === a) { clear(); return; }
      set(a, b);
    },
    paint: paintSel, clear,
    dispose: () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onOut, true); box?.removeEventListener('pointerdown', onDown); },
  };
}
