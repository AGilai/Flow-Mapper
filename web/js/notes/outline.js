// The outline ("On this page") of a document: a <nav> of its headings, for the reader and (design doc page) for the editor. `set(heads)` rebuilds the entries
// from heading elements; the nav gets class ix-none (hidden) until there is more than one heading, as in the reader. `spy` highlights the heading in view.

import { h } from '../dom.js';

const smooth = () => (matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
/** The headings an outline lists: non-empty h1-h3 under `root`, not the page title (a first-child h1). */
export const outlineHeads = (root) => [...root.querySelectorAll('h1, h2, h3')].filter((x) => x.textContent.trim() && !(x.tagName === 'H1' && x === root.firstElementChild));

/** outlineNav(heads, { spy }) -> { nav, set(heads), dispose() }. */
export function outlineNav(heads, { spy = false } = {}) {
  const nav = h('nav.nt-ol', { 'aria-label': 'On this page', 'data-qa': 'nt-outline' }, h('h5', 'On this page'));
  let io = null;
  const set = (hs) => {
    io?.disconnect(); io = null;
    nav.querySelectorAll('.nt-ol-i').forEach((b) => b.remove());
    const links = hs.map((x) => h('button.nt-ol-i', { type: 'button', class: x.tagName === 'H3' ? 's' : '', on: { click: () => { x.scrollIntoView({ block: 'start', behavior: smooth() }); } } }, x.textContent.trim()));
    nav.append(...links);
    nav.classList.toggle('ix-none', hs.length < 2);
    if (!spy || !links.length) return;
    links[0].classList.add('on');
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((es) => { const seen = es.filter((e) => e.isIntersecting).map((e) => hs.indexOf(e.target)).sort((a, b) => a - b)[0]; if (seen != null) links.forEach((l, i) => l.classList.toggle('on', i === seen)); }, { rootMargin: '0px 0px -70% 0px' });
      hs.forEach((x) => io.observe(x));
    }
  };
  set(heads);
  return { nav, set, dispose: () => io?.disconnect() };
}
