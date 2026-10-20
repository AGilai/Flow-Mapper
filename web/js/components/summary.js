// The verdict: one sentence that answers the page's question, then one callout per problem. A callout
// about a row links to it. See docs/UI-GUIDE.md §1.

import { h } from '../dom.js';

/** summary: { segments, callouts } from the API. `reveal(rowId)` expands a collapsed list that hides the row. */
export function summary(sum, { reveal } = {}) {
  const goTo = (e, id) => {
    e.preventDefault();
    reveal?.(id);
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  };
  const draw = (all) => h('div.callouts', (all ? sum.callouts : sum.callouts.slice(0, 3)).map((c) => h('div.callout', { class: c.level },
    h('span.dot'), h('span.grow', c.subject && c.text.startsWith(`${c.subject}: `) ? [h('b.mono', c.subject), c.text.slice(c.subject.length)] : c.text),
    c.rowId ? h('a', { href: '#', on: { click: (e) => goTo(e, c.rowId) } }, 'Show the row') : null)),
    !all && sum.callouts.length > 3 ? h('button.btn.ghost.show-more', { type: 'button', on: { click: (e) => e.target.closest('.callouts').replaceWith(draw(true)) } }, `Show ${sum.callouts.length - 3} more`) : null);
  return h('div.verdict',
    h('p.lead', sum.segments.map((s) => (s.b ? h('b', s.t) : s.t))),
    sum.callouts.length ? draw(false) : null);
}
