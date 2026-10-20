// Pieces shared by the compact hub views (topic, queue, event type): the Compact | Full toggle, edge
// markers, the outcome badge, the hub node, the filter box and "Expand all". See design/mockups/hub-views.html.

import { h } from '../dom.js';
import { go } from '../router.js';
import { icon } from '../icons.js';
import { wbr } from '../components/flow-nodes.js';

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Compact | Full, in the page header. Compact has no query; Full is `?view=full`. */
export function viewToggle(path, view) {
  const btn = (id, label) => h('button', { type: 'button', 'aria-pressed': String(view === id), on: { click: () => view !== id && go(path, id === 'full' ? { view: 'full' } : null) } }, label);
  return h('div.seg', { role: 'group', 'aria-label': 'View' }, btn('compact', 'Compact'), btn('full', 'Full'));
}

const FUNNEL = '<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M1.5 2h9L7 6.3V10l-2-1V6.3z"/></svg>';
const CROSSED = '<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M1.5 2h9L7 6.3V10l-2-1V6.3z"/><path d="M1 11L11 1" stroke-linecap="round"/></svg>';

/** The chip on an edge: a funnel with "N types", a crossed funnel with "all but N", or "disagree". */
export function markerChip(m, onClick) {
  if (!m) return null;
  const glyph = m.kind === 'types' ? FUNNEL : m.kind === 'all-but' ? CROSSED : '<i class="dot"></i>';
  const title = { types: `The filter lets ${m.label} through`, 'all-but': `The filter lets everything through except ${m.n}`, disagree: 'The declarations of this subscription disagree on the filter' }[m.kind];
  return h('button.hub-mark', { type: 'button', tabindex: '-1', class: m.kind, title, on: { click: onClick } }, h('span', { html: glyph }), m.label);
}

/** The state of a queue or consumer: a green check, or a red mark with the count of event types that arrive with no handler. */
export function badge({ noHandler = 0, possible = 0, ok = true, text = null }) {
  if (noHandler) return h('span.hub-badge.bad', h('i', '!'), text ?? `${noHandler} arrive, no handler`);
  if (possible && !ok) return h('span.hub-badge.maybe', h('i', '?'), 'Possible');
  return ok ? h('span.hub-badge.ok', { title: 'Everything that arrives is handled' }, h('i', '✓')) : null;
}

export const outcomeBadge = (outcome) => ({
  handled: h('span.hub-badge.ok', h('i', '✓'), 'Handled'),
  'no-handler': h('span.hub-badge.bad', h('i', '!'), 'Arrives, no handler'),
  possible: h('span.hub-badge.maybe', h('i', '?'), 'Possible'),
})[outcome];

/** The node in the middle: name, kind and a few counts. `t` is the transport token for its border. */
export function hubNode(name, kindLabel, t, stats) {
  return h('div.lane-node.chan.here.hub-node', { 'data-t': t },
    h('div.nm', wbr(name)), h('div.who', kindLabel),
    h('div.hub-stats', stats.map(([n, label]) => h('div', h('b', String(n)), ` ${label}`))));
}

/** "Find a ..." and "Expand all" on the right of a section header. Returns { el, query() }. */
export function tools({ placeholder, onQuery, onExpand }) {
  const input = h('input.input', { type: 'search', placeholder, 'aria-label': placeholder, on: { input: () => onQuery(input.value.trim()) } });
  let on = false;
  const btn = onExpand ? h('button.btn', { type: 'button', on: { click: () => { on = !on; btn.textContent = on ? 'Collapse all' : 'Expand all'; onExpand(on); } } }, 'Expand all') : null;
  return { el: h('span.hub-tools', h('span.search', icon('search'), input), btn), input };
}

/** Makes a div keyboard-operable: role=button, tabindex, Enter or Space on the element itself. */
export function pressable(el, fn) {
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.addEventListener('keydown', (e) => { if (e.target === el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fn(); } });
  return el;
}

/** A stub row: "N more ..., all handled" with a button that shows them. */
export const stub = (text, count, onClick) => h('div.lane-stub', h('span', text), h('button.btn.ghost', { type: 'button', on: { click: onClick } }, `Show all ${count}`));
