// The draggable border between a flow's diagram and its bottom pane (0.34.0): drag up and down, focus + ArrowUp / ArrowDown, double-click resets.
// The pane is at least its tab row (collapsed) and at most what leaves the diagram ~120 px. The height is remembered per viewer; the diagram
// lays itself out again on drag end (`fm:layout`). The numbers are in pure.js.

import { h } from '../dom.js';
import { dragHeight, maxPane, MIN_DIAGRAM, heightOf } from './pure.js';

const KEY_H = 'flow-mapper.pane-h', KEY_C = 'flow-mapper.pane-collapsed';
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch { /* storage unavailable */ } };
const layout = () => document.dispatchEvent(new CustomEvent('fm:layout'));

/** createSplitter({ pane, tabs, diagram }) -> { el, apply(), collapsed(), expand(min), toggle() }; pane: the .flow-bottom, tabs: its tab row, diagram: the .flow-body */
export function createSplitter({ pane, tabs, diagram }) {
  let height = heightOf(get(KEY_H)), collapsed = get(KEY_C) === '1', laid = 0;
  const el = h('div.fp-split', { role: 'separator', tabindex: 0, 'aria-orientation': 'horizontal', 'aria-label': 'Resize the diagram and the pane', title: 'Drag to resize, double-click to reset', 'data-qa': 'pane-split' });
  const minH = () => tabs.offsetHeight + 1;
  const maxH = () => {
    const p = pane.parentElement;
    if (!p || !p.clientHeight) return Infinity;
    const others = [...p.children].filter((c) => c !== pane && c !== diagram && c !== el && !c.classList.contains('max-bar')).reduce((n, c) => n + (getComputedStyle(c).display === 'none' ? 0 : c.offsetHeight), 0);
    return maxPane({ tab: p.clientHeight, others, diagram: MIN_DIAGRAM });
  };
  /** Paint the state: collapsed to the tab row, an explicit height (kept inside what the window allows now), or the default (CSS). */
  function apply() {
    pane.classList.toggle('collapsed', collapsed);
    const sized = !collapsed && height != null;
    pane.classList.toggle('sized', sized);
    pane.style.height = sized ? `${Math.max(minH(), Math.min(height, maxH()))}px` : '';
    el.setAttribute('aria-valuemin', String(minH()));
    const mx = maxH(); if (Number.isFinite(mx)) el.setAttribute('aria-valuemax', String(Math.round(mx)));
    el.setAttribute('aria-valuenow', String(Math.round(collapsed ? minH() : pane.offsetHeight || height || 0)));
  }
  const save = () => { put(KEY_H, height); put(KEY_C, collapsed ? 1 : null); };
  const settle = () => { clearTimeout(laid); laid = setTimeout(layout, 160); };
  function set(r) { collapsed = r.collapsed; if (!r.collapsed) height = r.h; apply(); }

  el.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    e.preventDefault();
    const y0 = e.clientY, h0 = collapsed ? minH() : pane.offsetHeight;
    el.setPointerCapture?.(e.pointerId);
    document.body.classList.add('fp-dragging'); el.classList.add('drag');
    const move = (ev) => set(dragHeight({ start: h0, dy: ev.clientY - y0, min: minH(), max: maxH() }));
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); document.body.classList.remove('fp-dragging'); el.classList.remove('drag'); save(); apply(); layout(); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 96 : 24, now = collapsed ? minH() : pane.offsetHeight;
    const to = e.key === 'ArrowUp' ? now + step : e.key === 'ArrowDown' ? now - step : e.key === 'Home' ? Infinity : e.key === 'End' ? 0 : null;
    if (to == null) return;
    e.preventDefault();
    set(dragHeight({ start: to, dy: 0, min: minH(), max: maxH() }));
    save(); settle();
  });
  el.addEventListener('dblclick', () => { height = null; collapsed = false; save(); apply(); layout(); });

  return {
    el, apply, collapsed: () => collapsed,
    /** Open the pane when it is folded to its tab row or too short to read (a cross-link or a tab click lands here). */
    expand(min = 200) { collapsed = false; if (height != null && height < min) height = min; save(); apply(); settle(); },
    toggle() { collapsed = !collapsed; if (!collapsed && height != null && height < 160) height = 240; save(); apply(); settle(); },
  };
}
