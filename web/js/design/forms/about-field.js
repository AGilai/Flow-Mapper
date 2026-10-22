// The About field of the component and subsystem forms (0.30.2): a text area for the Markdown-lite and a Write | Preview toggle that shows what
// the panel will draw (core/markdown-lite.js, sanitized). `value()` is the text as typed; the form sends '' to clear.

import { h } from '../../dom.js';
const ABOUT_MAX = 20000; // core/markdown-lite.ts (loaded only when the preview opens, see show())

export function aboutField(initial = '') {
  const ta = h('textarea.textarea', { rows: 8, value: initial, 'data-qa': 'about-text', spellcheck: true, placeholder: '## Capabilities\n- What it does\n\n## Owners\n...' });
  const prev = h('div.about-prev', { hidden: true, 'data-qa': 'about-preview' });
  const count = h('span.about-count');
  const mk = (label, qa) => h('button.btn.sm', { type: 'button', 'data-qa': qa, 'aria-pressed': 'false' }, label);
  const write = mk('Write', 'about-write'), view = mk('Preview', 'about-view');
  const show = (preview) => {
    ta.hidden = preview; prev.hidden = !preview;
    write.setAttribute('aria-pressed', String(!preview)); view.setAttribute('aria-pressed', String(preview));
    if (preview) { if (ta.value.trim()) import('../../../core/markdown-lite.js').then((m) => { if (!prev.hidden) prev.innerHTML = m.aboutHtml(ta.value); }); else prev.textContent = 'Nothing to preview.'; }
  };
  const paintCount = () => { count.textContent = `${ta.value.length} / ${ABOUT_MAX}`; count.style.color = ta.value.length > ABOUT_MAX ? 'var(--bad)' : ''; };
  write.addEventListener('click', () => show(false)); view.addEventListener('click', () => show(true));
  ta.addEventListener('input', paintCount);
  paintCount(); show(false);
  return { node: h('div.about-ed', h('div.about-tabs', write, view, count), ta, prev), value: () => ta.value, textarea: ta };
}
