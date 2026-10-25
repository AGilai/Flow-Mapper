// The entry-point list on the left of the Flows page. A click opens the flow in the active tab (replacing it), the row's "Tab" button in a new one. Above the text filter: the Subsystem and Component
// groups, and in a design "Changed only" (#61) and "All endpoints" (#65: a design lists named flows unless it is on). The filters live in the URL
// (`subsystems=`, `components=`, `changed=`, `endpoints=all`) and combine with the text.

import { h, fill, debounce } from '../dom.js';
import { icon } from '../icons.js';
import { href, setQuery } from '../router.js';
import { KEYS, SLIDE_MS, isNarrow, readCollapsed, writeCollapsed, toggleLabel, stripLabel } from '../collapse.js';
import { createGroup } from './flow-list-groups.js';
import { TAB_CAP, qual } from './flow-tabs-state.js';
import { entryRow, removedRow } from './flow-list-rows.js';
import { parseRel, relOptions } from './flow-relations-pure.js';
import { startGroup, encodeGroup, saveGroup, flatOrder } from './flow-list-groupby.js';
import { scopePoints, parseSel, encodeSel, subsystemRows, componentRows, filterPoints, removedPoints, filterSummary, hasCoverage, incompleteCount, incompleteOn, incompleteParam } from './flow-list-filter.js';
import { filterStatus } from './incomplete-pure.js';

const LIST_CAP = 300;

/** createList({ points, counts, cmts = {} (comments per `flow:<service>/<ingress>`), service, groupOf, groups, marks, design, query, onPick(point), onAll(), onCollapse(collapsed) }) -> { el, mark({ keys, active }), collapsed() } */
export function createList({ env = '', points: allPoints, counts, cmts = {}, acts = {}, ments = {}, relBy = new Map(), service, groupOf = new Map(), groups = [], marks = null, design = false, query = new URLSearchParams(), onPick, onPickTab, onAll, onCollapse }) {
  const body = h('div.flows-scroll');
  const filter = h('input.input', { type: 'search', placeholder: service ? 'Filter ingress' : 'Filter entry points', 'aria-label': 'Filter starting points' });
  let marked = { keys: [], active: null }, collapsed = readCollapsed(KEYS.list, undefined, isNarrow()); // narrow viewport: starts collapsed unless a choice was saved
  const fs = { all: query.get('endpoints') === 'all', subs: parseSel(query.get('subsystems')), comps: parseSel(query.get('components')), changed: design && ['1', 'all'].includes(query.get('changed')) ? query.get('changed') : null, rel: relBy.size ? parseRel(query.get('rel')) : null, group: startGroup(query, env, design), inc: false };
  const covered = hasCoverage(allPoints); // #85: "Incomplete flows only" is offered only where some flow reports coverage; `incomplete=1` is ignored elsewhere
  fs.inc = incompleteOn(query, covered);
  const word = h('span.fl-word'), strip = h('div.fl-strip', { 'aria-hidden': 'true' }, word);
  const btn = h('button.collapse-btn.fl-toggle', { type: 'button', on: { click: () => set(!collapsed) } }, icon('chev'));
  let points = scopePoints(allPoints, { design, service, all: fs.all }), subRows = subsystemRows(points, groupOf, groups);
  const flowsOnly = design && !service;   // the "All endpoints" switch exists only where the list is scoped
  const allBox = h('input', { type: 'checkbox', checked: fs.all, 'data-qa': 'all-endpoints', on: { change: (e) => {
    fs.all = e.target.checked; points = scopePoints(allPoints, { design, service, all: fs.all }); subRows = subsystemRows(points, groupOf, groups); commit(); } } });
  const subG = createGroup({ id: 'subsystem', title: 'Subsystem', onChange: (s) => { fs.subs = s; commit(); } });
  const cmpG = createGroup({ id: 'component', title: 'Component', onChange: (s) => { fs.comps = s; commit(); } });
  const changed = h('input', { type: 'checkbox', checked: !!fs.changed, 'data-qa': 'changed-only', on: { change: (e) => { fs.changed = e.target.checked ? (fs.changed ?? '1') : null; commit(); } } });
  const removedBox = h('input', { type: 'checkbox', checked: fs.changed === 'all', 'data-qa': 'changed-removed', on: { change: (e) => { fs.changed = e.target.checked ? 'all' : '1'; commit(); } } });
  const changedRow = design ? h('div.fl-changed', h('label.check', changed, 'Changed only'), h('label.check.fl-rm', { hidden: !fs.changed }, removedBox, 'and removed'),
    flowsOnly ? h('label.check', { title: 'List every endpoint of every component, not only named flows' }, allBox, `All endpoints (${allPoints.length})`) : null) : null;
  // 0.28.2: "Related": flows with a relation of one type (or any); only when the environment has relations. Kept in the URL as `rel=`.
  const incBox = h('input', { type: 'checkbox', checked: fs.inc, 'data-qa': 'incomplete-only', on: { change: (e) => { fs.inc = e.target.checked; commit(); } } }), incN = h('span.n');
  const incRow = covered ? h('div.fl-inc', h('label.check', { title: 'Flows the harvester reports as incomplete: some calls could not be followed' }, incBox, 'Incomplete flows only ', incN)) : null;
  const incStatus = h('p.fl-inc-st.xs', { role: 'status', hidden: true, 'data-qa': 'incomplete-status' });
  const relSel = h('select.select', { 'aria-label': 'Filter by relation', 'data-qa': 'rel-filter', on: { change: (e) => { fs.rel = parseRel(e.target.value); commit(); } } },
    relOptions(new Map([...relBy].filter(([k]) => points.some((p) => `${p.service}/${p.id}` === k)))).map((o) => h('option', { value: o.value, selected: o.value === (fs.rel ?? '') }, o.n == null ? o.label : `${o.label} (${o.n})`)));
  const relRow = relBy.size ? h('div.fl-rel-row', h('label', { for: 'fl-rel' }, 'Related flows'), Object.assign(relSel, { id: 'fl-rel' })) : null;
  // 0.32.5 (#79): Group by Component (a heading per component) or None (one flat list in natural name order). Not offered inside one component.
  const groupSel = h('select.select', { id: 'fl-group', 'aria-label': 'Group by', 'data-qa': 'group-by', on: { change: (e) => { fs.group = e.target.value; saveGroup(env, fs.group); commit(); } } },
    [['component', 'Component'], ['none', 'None']].map(([v, l]) => h('option', { value: v, selected: v === fs.group }, l)));
  const groupRow = service ? null : h('div.fl-group-row', h('label', { for: 'fl-group' }, 'Group by'), groupSel);
  const filters = h('div.fl-filters', subRows.length > 1 ? subG.el : null, cmpG.el);

  const vis = () => componentRows(points, groupOf, fs.subs).map((r) => ({ key: r.name, label: r.name, count: r.count }));
  const summary = () => filterSummary({ subs: fs.subs, comps: fs.comps, subRows, compRows: vis(), changed: fs.changed, rel: fs.rel, incomplete: fs.inc, q: filter.value.trim() });
  const paint = () => {
    btn.setAttribute('aria-expanded', String(!collapsed)); btn.setAttribute('aria-label', toggleLabel('the entry point list', collapsed)); btn.title = toggleLabel('the entry point list', collapsed);
    word.textContent = stripLabel({ service, active: marked.active, count: points.length, summary: summary() });
    el.classList.toggle('is-c', collapsed); strip.setAttribute('aria-hidden', String(!collapsed));
    el.querySelectorAll('.fl-body input, .fl-body a, .fl-body button').forEach((x) => { x.tabIndex = collapsed ? -1 : 0; });
  };
  const set = (c) => { collapsed = writeCollapsed(KEYS.list, c); paint(); onCollapse?.(collapsed); setTimeout(() => document.dispatchEvent(new CustomEvent('fm:layout')), SLIDE_MS + 40); };
  function commit() { // a filter changed: the URL (a parameter that selects everything is left out), the groups and the list
    const rows = vis();
    setQuery({ subsystems: encodeSel(fs.subs, subRows.map((r) => r.key)), components: encodeSel(fs.comps, rows.map((r) => r.key)), changed: fs.changed, rel: fs.rel, endpoints: fs.all ? 'all' : null, incomplete: incompleteParam(fs.inc), group: encodeGroup(fs.group, design) });
    relSel.value = fs.rel ?? ''; incBox.checked = fs.inc;
    removedBox.checked = fs.changed === 'all'; changed.checked = !!fs.changed; changedRow?.querySelector('.fl-rm')?.toggleAttribute('hidden', !fs.changed);
    subG.update({ rows: subRows, sel: fs.subs }); cmpG.update({ rows, sel: fs.comps });
    draw(); paint();
  }
  function draw() {
    const flat = fs.group === 'none' && !service, opts = { q: filter.value, subs: fs.subs, comps: fs.comps, changed: fs.changed, rel: fs.rel, relBy, marks, groupOf, incomplete: fs.inc }, list = filterPoints(points, opts), xs = flat ? flatOrder(list) : list;
    incN.textContent = `(${incompleteCount(points)})`; incStatus.hidden = !fs.inc; incStatus.textContent = fs.inc ? filterStatus(xs.length, points.length) : '';
    const gone = fs.changed === 'all' ? removedPoints(marks, opts) : [], groupsMap = new Map();
    for (const p of xs.slice(0, LIST_CAP)) { if (!groupsMap.has(p.service)) groupsMap.set(p.service, []); groupsMap.get(p.service).push(p); }
    fill(body,
      service ? h('a.small', { href: href('/flows'), style: { padding: '0 var(--s2)' }, on: { click: (e) => { e.preventDefault(); onAll(); } } }, 'Show all entry points') : null,
      flat ? xs.slice(0, LIST_CAP).map((p) => entryRow(p, { marks, counts, cmts, acts, ments, relBy, onPick, onPickTab, design, flat })) : [...groupsMap].map(([svc, ps]) => [h('h3', svc), ps.map((p) => entryRow(p, { marks, counts, cmts, acts, ments, relBy, onPick, onPickTab, design }))]),
      gone.length ? [h('h3', 'Removed'), gone.map((g) => removedRow(g, marks))] : null,
      xs.length > LIST_CAP ? h('p.xs.muted', { style: { padding: 'var(--s2)' } }, `${xs.length - LIST_CAP} more. Type to narrow the list.`) : null,
      !xs.length && !gone.length && fs.inc ? h('div.fl-inc-empty', h('b', `No incomplete flows in ${env || 'this environment'}.`), 'Every flow here is fully mapped, or the harvester has not reported coverage yet. ', h('a', { href: '#', on: { click: (e) => { e.preventDefault(); fs.inc = false; commit(); } } }, 'Clear the filter')) : null,
      !xs.length && !gone.length && !fs.inc ? h('p.small.muted', { style: { padding: 'var(--s2)' } }, flowsOnly && !fs.all && !points.length ? 'No named flows yet. Name a flow, or turn on "All endpoints".' : 'No starting points match.') : null,
      points.some((p) => p.name) ? h('p.xs.muted.fl-foot', 'Unnamed flows show their entry key.') : null);
    mark(marked);
  }
  // The tab on screen is the current entry (aria-current); entries that have a tab get a dot.
  function mark(m) {
    marked = m;
    if (collapsed) word.textContent = stripLabel({ service, active: m.active, count: points.length, summary: summary() });
    const base = (k) => (k ?? '').replace(/(~[^!]*)?(!(intra|full))?$/, '');
    const open = new Set(m.keys.map(base)), cur = base(m.active), mine = (k) => (env ? qual(env, k) : k); // tabs hold qualified keys: a row is open only in ITS env (a prod tab never marks the same-named design row)
    const full = m.keys.length >= TAB_CAP;
    body.querySelectorAll('.entry-r').forEach((r) => {
      const a = r.querySelector('a.entry'), b = r.querySelector('.entry-tab'), on = open.has(mine(a.dataset.key));
      a.setAttribute('aria-current', String(mine(a.dataset.key) === cur)); a.classList.toggle('has-tab', on);
      b.classList.toggle('is-open', on); b.setAttribute('aria-disabled', String(full && !on));
      b.title = on ? 'Already open: go to its tab' : full ? `${TAB_CAP} tabs open: close one to open another` : 'Open in a new tab';
    });
  }
  filter.addEventListener('input', debounce(() => { draw(); paint(); }, 120));
  subG.update({ rows: subRows, sel: fs.subs }); cmpG.update({ rows: vis(), sel: fs.comps });
  draw();
  if (!service && !query.get('group') && encodeGroup(fs.group, design)) setQuery({ group: encodeGroup(fs.group, design) }); // a mode that came only from the per-env memory goes into the URL once, so a copied link keeps it
  const el = h('aside.flows-list', h('div.fl-head', h('span.fl-title', service ? 'Ingress' : 'Entry points'), btn),
    h('div.fl-body', groupRow, filters, h('div.search', icon('search'), filter), changedRow, incRow, incStatus, relRow, body), strip);
  strip.addEventListener('click', () => set(false));
  paint();
  return { el, mark, collapsed: () => collapsed };
}
