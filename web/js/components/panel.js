// Slide-in info panel on the right of the main area. One per view.

import { h, clear, fill } from '../dom.js';
import { icon } from '../icons.js';

export function createPanel(host, { onClose } = {}) {
  const title = h('div.grow');
  const body = h('div.panel-body');
  const el = h('aside.panel', { 'aria-label': 'Details' },
    h('div.panel-head', title, h('button.btn.ghost', { 'aria-label': 'Close details', on: { click: () => close() } }, icon('close'))),
    body);
  host.append(el);
  const onKey = (e) => { if (e.key === 'Escape' && el.classList.contains('open')) close(); };
  addEventListener('keydown', onKey);

  function open(head, ...content) {
    fill(title, head);
    fill(body, content);
    el.classList.add('open');
  }
  function close() {
    el.classList.remove('open');
    onClose?.();
  }
  return { open, close, el, dispose: () => removeEventListener('keydown', onKey) };
}

/** Panel section with a heading and optional count. */
export const section = (label, count, ...content) =>
  h('section.stack', h('h3.row', label, count != null ? h('span.muted.small', String(count)) : null), ...content);
