// The index (outline) of the design doc page: a drag grip on its left edge (140-480px, double-click = 200), a hide button, and a slim rail when hidden.
// Width and state are kept per viewer in localStorage (optional). Pure rules in core/index-pane.ts.

import { h } from '../dom.js';
import { clampIndexWidth, parseIndexState, indexCollapsed, IX_DEFAULT } from '../../core/index-pane.js';

const KEY = 'fm.ddoc.index';
const load = () => { try { return parseIndexState(localStorage.getItem(KEY)); } catch { return parseIndexState(null); } };
const save = (s) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } };

/** Adds the grip and the toggle to the outline `nav`; the nav is changed in place. */
export function enhanceIndex(nav) {
  const st = load();
  const head = nav.querySelector('h5');
  const toggle = h('button.ix-tg', { type: 'button' });
  const grip = h('div.ix-grip', { role: 'separator', 'aria-orientation': 'vertical', tabindex: 0, 'aria-label': 'Resize the index', title: 'Drag to resize, double-click to reset' });
  nav.prepend(grip, h('div.ix-head', head, toggle));
  nav.classList.add('nt-ix');

  const paintW = () => { nav.style.setProperty('--ix-w', `${st.w}px`); grip.setAttribute('aria-valuenow', String(st.w)); };
  const paintC = () => {
    const c = indexCollapsed(st, innerWidth);
    nav.classList.toggle('ix-c', c);
    toggle.textContent = c ? '‹' : '›';
    toggle.title = c ? 'Show index' : 'Hide index';
    toggle.setAttribute('aria-label', toggle.title);
    toggle.setAttribute('aria-expanded', String(!c));
  };
  toggle.addEventListener('click', () => { st.collapsed = !indexCollapsed(st, innerWidth); save(st); paintC(); });

  let start = null;
  grip.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; start = { x: e.clientX, w: st.w }; grip.setPointerCapture(e.pointerId); grip.classList.add('dragging'); document.body.classList.add('resizing'); e.preventDefault(); });
  grip.addEventListener('pointermove', (e) => { if (!start) return; st.w = clampIndexWidth(start.w - (e.clientX - start.x)); paintW(); }); // the grip is on the left edge: moving left widens
  const end = () => { if (!start) return; start = null; grip.classList.remove('dragging'); document.body.classList.remove('resizing'); save(st); };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  grip.addEventListener('dblclick', () => { st.w = IX_DEFAULT; paintW(); save(st); });
  grip.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowLeft' ? 16 : e.key === 'ArrowRight' ? -16 : 0;
    if (d) { e.preventDefault(); st.w = clampIndexWidth(st.w + d); paintW(); save(st); }
  });
  paintW(); paintC();
}
