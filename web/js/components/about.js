// The "About" block (0.30.2): the rich description of a component or a subsystem, Markdown-lite rendered through core/markdown-lite.js (which
// sanitizes; loaded on first use, so node tests that import the panels need no core/*.ts). Folded after about 12 lines with "Show all". Empty or missing text draws nothing.

import { h } from '../dom.js';

/** aboutBlock(markdown, { pen? }) -> an element, or null when there is nothing to show. `pen` (0.31.1, design/pencil.js): { whole: node | null, section(title) -> node | null },
 *  the pencil of the title bar (the whole text) and one per `##` section; absent in a harvested environment. */
export function aboutBlock(md, { pen = null } = {}) {
  const html = typeof md === 'string' && md.trim() !== '';
  const whole = html ? pen?.whole ?? null : pen?.empty ?? pen?.whole ?? null; // an empty About offers a visible "Add about" button (0.31.1)
  if (!html && !whole) return null;
  const body = h('div.about-body', { 'data-qa': 'about-body' });
  if (html) import('../../core/markdown-lite.js').then((m) => {
    body.innerHTML = m.aboutHtml(md);
    if (pen?.section) for (const p of body.querySelectorAll('p > strong:only-child')) { const b = pen.section(p.textContent.trim()); if (b) { p.parentElement.classList.add('has-pen'); p.parentElement.append(b); } }
    fit();
  });
  const more = h('button.btn.sm.ghost.about-more', { type: 'button', hidden: true, 'data-qa': 'about-more', 'aria-expanded': 'false' }, 'Show all');
  more.addEventListener('click', () => { const open = body.classList.toggle('open'); more.textContent = open ? 'Show less' : 'Show all'; more.setAttribute('aria-expanded', String(open)); });
  const fit = () => { if (body.classList.contains('open')) return; more.hidden = body.scrollHeight <= body.clientHeight + 2; body.classList.toggle('folded', !more.hidden); };
  if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(body); else queueMicrotask(fit);
  return h('section.about', { 'data-qa': 'about' },
    h('h3.row.has-pen', 'About', whole),
    html ? [body, more] : h('p.small.muted', 'Nothing written yet.'));
}
