// The "About" block (0.30.2): the rich description of a component or a subsystem, Markdown-lite rendered through core/markdown-lite.js (which
// sanitizes; loaded on first use, so node tests that import the panels need no core/*.ts). Folded after about 12 lines with "Show all". Empty or missing text draws nothing.

import { h } from '../dom.js';

/** aboutBlock(markdown, { onEdit? }) -> an element, or null when there is nothing to show. `onEdit`: a design draft is open (an "Edit" button). */
export function aboutBlock(md, { onEdit = null } = {}) {
  const html = typeof md === 'string' && md.trim() !== '';
  if (!html && !onEdit) return null;
  const body = h('div.about-body', { 'data-qa': 'about-body' });
  if (html) import('../../core/markdown-lite.js').then((m) => { body.innerHTML = m.aboutHtml(md); fit(); });
  const more = h('button.btn.sm.ghost.about-more', { type: 'button', hidden: true, 'data-qa': 'about-more', 'aria-expanded': 'false' }, 'Show all');
  more.addEventListener('click', () => { const open = body.classList.toggle('open'); more.textContent = open ? 'Show less' : 'Show all'; more.setAttribute('aria-expanded', String(open)); });
  const fit = () => { if (body.classList.contains('open')) return; more.hidden = body.scrollHeight <= body.clientHeight + 2; body.classList.toggle('folded', !more.hidden); };
  if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(body); else queueMicrotask(fit);
  return h('section.about', { 'data-qa': 'about' },
    h('h3.row', 'About', h('span.grow'), onEdit ? h('button.btn.sm.ghost', { type: 'button', 'data-qa': 'about-edit', on: { click: onEdit } }, html ? 'Edit' : 'Add') : null),
    html ? [body, more] : h('p.small.muted', 'Nothing written yet.'));
}
