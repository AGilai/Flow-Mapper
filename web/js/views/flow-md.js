// Markdown-lite for the flow and step descriptions (0.45.0, #91): the same renderer as `about` (core/markdown-lite.js: sanitized, http(s) links only).
// The plain text shows at once and the Markdown replaces it when the module has loaded (it is loaded on first use, so node tests need no core/*.ts).
// The block fires `fm:md` (bubbling) after it has been drawn, so a clamp can measure it again.

import { h } from '../dom.js';

/** mdBlock(text, cls) -> a div whose content is the Markdown of `text`. Editing never goes through here: it shows the raw text. */
export function mdBlock(text, cls = '') {
  const el = h('div.md', { class: cls }, String(text ?? ''));
  import('../../core/markdown-lite.js').then((m) => {
    el.innerHTML = m.aboutHtml(String(text ?? ''));
    for (const p of el.querySelectorAll('p')) if (/^why it exists:/i.test(p.textContent.trim())) p.classList.add('why');
    el.dispatchEvent(new CustomEvent('fm:md', { bubbles: true }));
  }).catch(() => { /* the plain text stays */ });
  return el;
}
