// The entry-point list on the left of the Flows page. Picking one opens a tab (it never replaces one).

import { h, fill, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { href } from '../router.js';
import { chip, splitKey } from '../format.js';
import { describeCount } from '../../core/flow-counts.js';
import { entryKey } from './flow-tabs-state.js';
import { KEYS, SLIDE_MS, isNarrow, readCollapsed, writeCollapsed, toggleLabel, stripLabel } from '../collapse.js';

const LIST_CAP = 300;

/** "(8)" after an entry point: distinct services, channels and stores its flow reaches; the breakdown is the tooltip. */
const countBadge = (c) => c ? h('span.count', { title: describeCount(c) }, ` (${c.total})`) : null;

/** createList({ points, counts, service, onPick(point), onAll(), onCollapse(collapsed) }) -> { el, mark({ keys, active }), collapsed() } (onCollapse: the page gives the freed width to the diagram) */
export function createList({ points, counts, service, onPick, onAll, onCollapse }) {
  const body = h('div.flows-scroll');
  const filter = h('input.input', { type: 'search', placeholder: service ? 'Filter ingress' : 'Filter entry points', 'aria-label': 'Filter starting points' });
  let marks = { keys: [], active: null }, collapsed = readCollapsed(KEYS.list, undefined, isNarrow()); // narrow viewport: starts collapsed unless a choice was saved
  const word = h('span.fl-word'), strip = h('div.fl-strip', { 'aria-hidden': 'true' }, word);
  const btn = h('button.collapse-btn.fl-toggle', { type: 'button', on: { click: () => set(!collapsed) } }, icon('chev'));
  const paint = () => {
    btn.setAttribute('aria-expanded', String(!collapsed)); btn.setAttribute('aria-label', toggleLabel('the entry point list', collapsed)); btn.title = toggleLabel('the entry point list', collapsed);
    word.textContent = stripLabel({ service, active: marks.active, count: points.length });
    el.classList.toggle('is-c', collapsed); strip.setAttribute('aria-hidden', String(!collapsed));
    el.querySelectorAll('.fl-body input, .fl-body a').forEach((x) => { x.tabIndex = collapsed ? -1 : 0; });
  };
  const set = (c) => { collapsed = writeCollapsed(KEYS.list, c); paint(); onCollapse?.(collapsed); setTimeout(() => document.dispatchEvent(new CustomEvent('fm:layout')), SLIDE_MS + 40); };
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    const xs = points.filter((p) => !q || p.bindKey.toLowerCase().includes(q) || p.service.includes(q) || p.handler.toLowerCase().includes(q));
    const groups = new Map();
    for (const p of xs.slice(0, LIST_CAP)) { if (!groups.has(p.service)) groups.set(p.service, []); groups.get(p.service).push(p); }
    fill(body,
      service ? h('a.small', { href: href('/flows'), style: { padding: '0 var(--s2)' }, on: { click: (e) => { e.preventDefault(); onAll(); } } }, 'Show all entry points') : null,
      [...groups].map(([svc, ps]) => [h('h3', svc), ps.map((p) => h('a.entry', { href: href('/flows', { service: p.service, ingress: p.id }), 'data-key': entryKey(p.service, p.id),
        on: { click: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); onPick(p); } } },
      h('span.row', p.bindKey.startsWith('amqp-rpc:') ? chip('rpc', 'amqp rpc') : chip(p.transport), p.entryPoint ? h('span.xs.muted', 'entry point') : null), h('span.key', splitKey(p.bindKey).rest, countBadge(counts.get(`${p.service}:${p.id}`)))))]),
      xs.length > LIST_CAP ? h('p.xs.muted', { style: { padding: 'var(--s2)' } }, `${xs.length - LIST_CAP} more. Type to narrow the list.`) : null,
      !xs.length ? h('p.small.muted', { style: { padding: 'var(--s2)' } }, 'No starting points match.') : null);
    mark(marks);
  };
  // The tab on screen is the current entry (aria-current); entries that have a tab get a dot.
  function mark(m) {
    marks = m;
    if (collapsed) word.textContent = stripLabel({ service, active: m.active, count: points.length });
    const base = (k) => (k ?? '').replace(/(~[^!]*)?(!(intra|full))?$/, '');
    const open = new Set(m.keys.map(base)), cur = base(m.active);
    body.querySelectorAll('a.entry').forEach((a) => { a.setAttribute('aria-current', String(a.dataset.key === cur)); a.classList.toggle('has-tab', open.has(a.dataset.key)); });
  }
  filter.addEventListener('input', debounce(draw, 120));
  draw();
  const el = h('aside.flows-list', h('div.fl-head', h('span.fl-title', service ? 'Ingress' : 'Entry points'), btn),
    h('div.fl-body', h('div.search', icon('search'), filter), body), strip);
  strip.addEventListener('click', () => set(false));
  paint();
  return { el, mark, collapsed: () => collapsed };
}
