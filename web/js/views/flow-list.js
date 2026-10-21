// The entry-point list on the left of the Flows page. Picking one opens a tab (it never replaces one). Above the text filter: the Subsystem and Component
// groups, and in a design "Changed only" (#61). The filters live in the URL (`subsystems=`, `components=`, `changed=`) and combine with the text.

import { h, fill, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { href, setQuery } from '../router.js';
import { KEYS, SLIDE_MS, isNarrow, readCollapsed, writeCollapsed, toggleLabel, stripLabel } from '../collapse.js';
import { createGroup } from './flow-list-groups.js';
import { entryRow, removedRow } from './flow-list-rows.js';
import { parseSel, encodeSel, subsystemRows, componentRows, filterPoints, removedPoints, filterSummary } from './flow-list-filter.js';

const LIST_CAP = 300;

/** createList({ points, counts, service, groupOf, groups, marks, design, query, onPick(point), onAll(), onCollapse(collapsed) }) -> { el, mark({ keys, active }), collapsed() } */
export function createList({ points, counts, service, groupOf = new Map(), groups = [], marks = null, design = false, query = new URLSearchParams(), onPick, onAll, onCollapse }) {
  const body = h('div.flows-scroll');
  const filter = h('input.input', { type: 'search', placeholder: service ? 'Filter ingress' : 'Filter entry points', 'aria-label': 'Filter starting points' });
  let marked = { keys: [], active: null }, collapsed = readCollapsed(KEYS.list, undefined, isNarrow()); // narrow viewport: starts collapsed unless a choice was saved
  const fs = { subs: parseSel(query.get('subsystems')), comps: parseSel(query.get('components')), changed: design && ['1', 'all'].includes(query.get('changed')) ? query.get('changed') : null };
  const word = h('span.fl-word'), strip = h('div.fl-strip', { 'aria-hidden': 'true' }, word);
  const btn = h('button.collapse-btn.fl-toggle', { type: 'button', on: { click: () => set(!collapsed) } }, icon('chev'));
  const subRows = subsystemRows(points, groupOf, groups);
  const subG = createGroup({ id: 'subsystem', title: 'Subsystem', onChange: (s) => { fs.subs = s; commit(); } });
  const cmpG = createGroup({ id: 'component', title: 'Component', onChange: (s) => { fs.comps = s; commit(); } });
  const changed = h('input', { type: 'checkbox', checked: !!fs.changed, 'data-qa': 'changed-only', on: { change: (e) => { fs.changed = e.target.checked ? (fs.changed ?? '1') : null; commit(); } } });
  const removedBox = h('input', { type: 'checkbox', checked: fs.changed === 'all', 'data-qa': 'changed-removed', on: { change: (e) => { fs.changed = e.target.checked ? 'all' : '1'; commit(); } } });
  const changedRow = design ? h('div.fl-changed', h('label.check', changed, 'Changed only'), h('label.check.fl-rm', { hidden: !fs.changed }, removedBox, 'and removed')) : null;
  const filters = h('div.fl-filters', subRows.length > 1 ? subG.el : null, cmpG.el);

  const vis = () => componentRows(points, groupOf, fs.subs).map((r) => ({ key: r.name, label: r.name, count: r.count }));
  const summary = () => filterSummary({ subs: fs.subs, comps: fs.comps, subRows, compRows: vis(), changed: fs.changed, q: filter.value.trim() });
  const paint = () => {
    btn.setAttribute('aria-expanded', String(!collapsed)); btn.setAttribute('aria-label', toggleLabel('the entry point list', collapsed)); btn.title = toggleLabel('the entry point list', collapsed);
    word.textContent = stripLabel({ service, active: marked.active, count: points.length, summary: summary() });
    el.classList.toggle('is-c', collapsed); strip.setAttribute('aria-hidden', String(!collapsed));
    el.querySelectorAll('.fl-body input, .fl-body a, .fl-body button').forEach((x) => { x.tabIndex = collapsed ? -1 : 0; });
  };
  const set = (c) => { collapsed = writeCollapsed(KEYS.list, c); paint(); onCollapse?.(collapsed); setTimeout(() => document.dispatchEvent(new CustomEvent('fm:layout')), SLIDE_MS + 40); };
  function commit() { // a filter changed: the URL (a parameter that selects everything is left out), the groups and the list
    const rows = vis();
    setQuery({ subsystems: encodeSel(fs.subs, subRows.map((r) => r.key)), components: encodeSel(fs.comps, rows.map((r) => r.key)), changed: fs.changed });
    removedBox.checked = fs.changed === 'all'; changed.checked = !!fs.changed; changedRow?.querySelector('.fl-rm')?.toggleAttribute('hidden', !fs.changed);
    subG.update({ rows: subRows, sel: fs.subs }); cmpG.update({ rows, sel: fs.comps });
    draw(); paint();
  }
  function draw() {
    const opts = { q: filter.value, subs: fs.subs, comps: fs.comps, changed: fs.changed, marks, groupOf }, xs = filterPoints(points, opts);
    const gone = fs.changed === 'all' ? removedPoints(marks, opts) : [], groupsMap = new Map();
    for (const p of xs.slice(0, LIST_CAP)) { if (!groupsMap.has(p.service)) groupsMap.set(p.service, []); groupsMap.get(p.service).push(p); }
    fill(body,
      service ? h('a.small', { href: href('/flows'), style: { padding: '0 var(--s2)' }, on: { click: (e) => { e.preventDefault(); onAll(); } } }, 'Show all entry points') : null,
      [...groupsMap].map(([svc, ps]) => [h('h3', svc), ps.map((p) => entryRow(p, { marks, counts, onPick, design }))]),
      gone.length ? [h('h3', 'Removed'), gone.map((g) => removedRow(g, marks))] : null,
      xs.length > LIST_CAP ? h('p.xs.muted', { style: { padding: 'var(--s2)' } }, `${xs.length - LIST_CAP} more. Type to narrow the list.`) : null,
      !xs.length && !gone.length ? h('p.small.muted', { style: { padding: 'var(--s2)' } }, 'No starting points match.') : null,
      points.some((p) => p.name) ? h('p.xs.muted.fl-foot', 'Unnamed flows show their entry key.') : null);
    mark(marked);
  }
  // The tab on screen is the current entry (aria-current); entries that have a tab get a dot.
  function mark(m) {
    marked = m;
    if (collapsed) word.textContent = stripLabel({ service, active: m.active, count: points.length, summary: summary() });
    const base = (k) => (k ?? '').replace(/(~[^!]*)?(!(intra|full))?$/, '');
    const open = new Set(m.keys.map(base)), cur = base(m.active);
    body.querySelectorAll('a.entry').forEach((a) => { a.setAttribute('aria-current', String(a.dataset.key === cur)); a.classList.toggle('has-tab', open.has(a.dataset.key)); });
  }
  filter.addEventListener('input', debounce(() => { draw(); paint(); }, 120));
  subG.update({ rows: subRows, sel: fs.subs }); cmpG.update({ rows: vis(), sel: fs.comps });
  draw();
  const el = h('aside.flows-list', h('div.fl-head', h('span.fl-title', service ? 'Ingress' : 'Entry points'), btn),
    h('div.fl-body', filters, h('div.search', icon('search'), filter), changedRow, body), strip);
  strip.addEventListener('click', () => set(false));
  paint();
  return { el, mark, collapsed: () => collapsed };
}
