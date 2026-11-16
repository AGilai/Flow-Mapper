// The draggable top border of the call card (Unreleased), the same handle as the pane's (splitter.js): drag up = taller card, ArrowUp / ArrowDown, double-click resets.
// It sets --cc-h on the caption bar (call-notes.css turns that into the height of the reading area); the diagram keeps >= MIN_DIAGRAM. Remembered per viewer.

import { h } from '../dom.js';
import { dragHeight, MIN_DIAGRAM, cardHeightOf, MIN_CARD } from './pure.js';

const KEY = 'flow-mapper.callcard-h';
const get = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const put = (v) => { try { if (v == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(v)); } catch { /* storage unavailable */ } };
const layout = () => document.dispatchEvent(new CustomEvent('fm:layout'));

/** createCardSplitter({ bar, body, area }) -> { el, apply(), show(on) }; bar: the .capbar (gets --cc-h), body: () => the diagram element above it, area: () => the card's text area now on screen (or null) */
export function createCardSplitter({ bar, body, area }) {
  let height = cardHeightOf(get()), laid = 0;
  const el = h('div.fp-split.cc-split', { role: 'separator', tabindex: 0, 'aria-orientation': 'horizontal', 'aria-label': 'Resize the call card', title: 'Drag to resize, double-click to reset', 'data-qa': 'card-split', hidden: true });
  const now = () => area()?.getBoundingClientRect().height || height || 0;
  const maxH = () => { const d = body(); return d ? now() + Math.max(0, d.offsetHeight - MIN_DIAGRAM) : Infinity; }; // what the diagram can give up
  function apply() {
    bar.classList.toggle('sized', height != null);
    bar.style.setProperty('--cc-h', height != null ? `${height}px` : '');
    if (height == null) return;
    const d = body(), short = d ? MIN_DIAGRAM - d.offsetHeight : 0; // a window that got smaller: the card gives way
    if (short > 0) bar.style.setProperty('--cc-h', `${Math.max(MIN_CARD, height - short)}px`);
  }
  const save = () => put(height);
  const set = (to) => { height = dragHeight({ start: to, dy: 0, min: MIN_CARD, max: maxH() }).h; apply(); };
  const settle = () => { clearTimeout(laid); laid = setTimeout(layout, 160); };

  el.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    e.preventDefault();
    const y0 = e.clientY, h0 = now(), mx = maxH();
    el.setPointerCapture?.(e.pointerId);
    document.body.classList.add('fp-dragging'); el.classList.add('drag');
    const move = (ev) => { height = dragHeight({ start: h0, dy: ev.clientY - y0, min: MIN_CARD, max: mx }).h; apply(); };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); document.body.classList.remove('fp-dragging'); el.classList.remove('drag'); save(); apply(); layout(); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 96 : 24, cur = now();
    const to = e.key === 'ArrowUp' ? cur + step : e.key === 'ArrowDown' ? cur - step : e.key === 'Home' ? Infinity : e.key === 'End' ? 0 : null;
    if (to == null) return;
    e.preventDefault(); set(to); save(); settle();
  });
  el.addEventListener('dblclick', () => { height = null; save(); apply(); layout(); });
  apply();
  return {
    el, apply,
    show(on) { el.hidden = !on; if (!on) return; el.setAttribute('aria-valuemin', String(MIN_CARD)); const mx = maxH(); if (Number.isFinite(mx)) el.setAttribute('aria-valuemax', String(Math.round(mx))); el.setAttribute('aria-valuenow', String(Math.round(now()))); },
  };
}
