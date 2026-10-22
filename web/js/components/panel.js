// Slide-in info panel on the right of the main area. One per view.
// Pane mode (0.33.0, web/js/pane/pane.js): the same element carries the info pane of a component or subsystem: its own header and sections fill the body
// (the plain head is hidden), the width is the pane's, and `open()` of any other panel (edge, step, message...) leaves pane mode again.

import { h, fill } from '../dom.js';
import { icon } from '../icons.js';

export function createPanel(host, { onClose, onLeavePane } = {}) {
  const title = h('div.grow');
  const body = h('div.panel-body');
  const el = h('aside.panel', { 'aria-label': 'Details' },
    h('div.panel-head', title, h('button.btn.ghost', { 'aria-label': 'Close details', on: { click: () => close() } }, icon('close'))),
    body);
  host.append(el);
  const onKey = (e) => { if (e.key === 'Escape' && el.classList.contains('open') && !document.querySelector('[data-pane-overlay]')) close(); };
  addEventListener('keydown', onKey);
  let prevWidth = '', guard = null;

  /** Enter or leave pane mode; `width` (px) is the pane's inline width, the one the page had is put back on leaving. */
  function paneMode(on, width = null) {
    const was = el.classList.contains('pane');
    if (on) { if (!was) prevWidth = el.style.width; el.classList.add('pane'); if (width) el.style.width = `${width}px`; }
    else if (was) { el.classList.remove('pane'); el.style.width = prevWidth; el.style.removeProperty('--sheet-h'); el.removeAttribute('data-snap'); }
  }
  function open(head, ...content) {
    if (el.classList.contains('pane')) onLeavePane?.();
    paneMode(false);
    fill(title, head);
    fill(body, content);
    el.classList.add('open');
  }
  /** Show `nodes` as the pane's body (pane mode). */
  function openPane(nodes, width) {
    paneMode(true, width);
    fill(body, nodes);
    el.classList.add('open');
  }
  function close() {
    if (guard && guard() === false) return; // the pane holds unsaved text and asks first
    el.classList.remove('open');
    onClose?.();
  }
  return { open, openPane, setGuard: (fn) => { guard = fn; }, paneMode, close, el, body, isOpen: () => el.classList.contains('open'), isPane: () => el.classList.contains('pane'), dispose: () => removeEventListener('keydown', onKey) };
}

/** Panel section with a heading and optional count. */
export const section = (label, count, ...content) =>
  h('section.stack', h('h3.row', label, count != null ? h('span.muted.small', String(count)) : null), ...content);
