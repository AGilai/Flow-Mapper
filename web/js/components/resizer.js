// A drag handle on one vertical edge of a panel, to resize it. Pointer drag, arrow keys (16px),
// double-click to reset; the width is remembered per viewer in localStorage (optional: the page
// works without it).
//
//   const handle = resizer(host, { edge: 'right', key: 'flows-list', width: () => host.offsetWidth,
//                                  apply: (px) => host.style.width = px + 'px', defaultWidth: 300 });
//
// `host` must be positioned (the handle is absolutely placed on its edge). `edge` is the side of
// `host` the handle sits on: dragging it away from the host grows the panel. `apply` gets a width
// in px, already clamped; `width` reads the current one.

import { h } from '../dom.js';

const STEP = 16;

const read = (key) => { try { const v = Number(localStorage.getItem(`resizer:${key}`)); return v > 0 ? v : null; } catch { return null; } };
const write = (key, px) => { try { localStorage.setItem(`resizer:${key}`, String(Math.round(px))); } catch { /* storage unavailable */ } };
const forget = (key) => { try { localStorage.removeItem(`resizer:${key}`); } catch { /* storage unavailable */ } };

export function resizer(host, { edge = 'right', key, width, apply, defaultWidth, min = 200, maxFraction = 0.6, label = 'Resize panel' }) {
  const max = () => Math.max(min, Math.floor(innerWidth * maxFraction));
  const clamp = (px) => Math.min(max(), Math.max(min, px));
  const sign = edge === 'right' ? 1 : -1; // moving the pointer right grows a panel whose handle is on its right edge
  const handle = h('div.resizer.' + edge, { role: 'separator', 'aria-orientation': 'vertical', tabindex: 0, 'aria-label': label, title: 'Drag to resize, double-click to reset' });

  const set = (px, save = true) => {
    const w = clamp(px);
    apply(w);
    handle.setAttribute('aria-valuenow', String(Math.round(w)));
    handle.setAttribute('aria-valuemin', String(min));
    handle.setAttribute('aria-valuemax', String(max()));
    if (save) write(key, w);
    return w;
  };

  let start = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    start = { x: e.clientX, w: width() };
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('resizing');
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => { if (start) set(start.w + sign * (e.clientX - start.x), false); });
  const end = () => {
    if (!start) return;
    start = null;
    handle.classList.remove('dragging');
    document.body.classList.remove('resizing');
    write(key, width());
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', () => { forget(key); apply(clamp(defaultWidth)); set(defaultWidth, false); });
  handle.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    set(width() + sign * dir * STEP);
  });

  host.append(handle);
  const saved = read(key);
  if (saved) set(saved, false); else handle.setAttribute('aria-valuenow', String(defaultWidth));
  return handle;
}
