// The entry-point list on the left of the Flows page. Picking one opens a tab (it never replaces one).

import { h, fill, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { href } from '../router.js';
import { chip, splitKey } from '../format.js';
import { describeCount } from '../../core/flow-counts.js';
import { entryKey } from './flow-tabs-state.js';

const LIST_CAP = 300;

/** "(8)" after an entry point: distinct services, channels and stores its flow reaches; the breakdown is the tooltip. */
const countBadge = (c) => c ? h('span.count', { title: describeCount(c) }, ` (${c.total})`) : null;

/** createList({ points, counts, service, onPick(point), onAll() }) -> { el, mark({ keys, active }) } */
export function createList({ points, counts, service, onPick, onAll }) {
  const body = h('div.flows-scroll');
  const filter = h('input.input', { type: 'search', placeholder: service ? 'Filter ingress' : 'Filter entry points', 'aria-label': 'Filter starting points' });
  let marks = { keys: [], active: null };
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    const xs = points.filter((p) => !q || p.bindKey.toLowerCase().includes(q) || p.service.includes(q) || p.handler.toLowerCase().includes(q));
    const groups = new Map();
    for (const p of xs.slice(0, LIST_CAP)) { if (!groups.has(p.service)) groups.set(p.service, []); groups.get(p.service).push(p); }
    fill(body,
      service ? h('a.small', { href: href('/flows'), style: { padding: '0 var(--s2)' }, on: { click: (e) => { e.preventDefault(); onAll(); } } }, 'Show all entry points') : null,
      [...groups].map(([svc, ps]) => [h('h3', svc), ps.map((p) => h('a.entry', { href: href('/flows', { service: p.service, ingress: p.id }), 'data-key': entryKey(p.service, p.id),
        on: { click: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); onPick(p); } } },
      h('span.row', chip(p.transport), p.entryPoint ? h('span.xs.muted', 'entry point') : null), h('span.key', splitKey(p.bindKey).rest, countBadge(counts.get(`${p.service}:${p.id}`)))))]),
      xs.length > LIST_CAP ? h('p.xs.muted', { style: { padding: 'var(--s2)' } }, `${xs.length - LIST_CAP} more. Type to narrow the list.`) : null,
      !xs.length ? h('p.small.muted', { style: { padding: 'var(--s2)' } }, 'No starting points match.') : null);
    mark(marks);
  };
  // The tab on screen is the current entry (aria-current); entries that have a tab get a dot.
  function mark(m) {
    marks = m;
    const base = (k) => (k ?? '').replace(/(~[^!]*)?(!(intra|full))?$/, '');
    const open = new Set(m.keys.map(base)), cur = base(m.active);
    body.querySelectorAll('a.entry').forEach((a) => { a.setAttribute('aria-current', String(a.dataset.key === cur)); a.classList.toggle('has-tab', open.has(a.dataset.key)); });
  }
  filter.addEventListener('input', debounce(draw, 120));
  draw();
  return { el: h('aside.flows-list', h('div.search', icon('search'), filter), body), mark };
}
