// Inventory: every object in one table — services (incl. gateways and Lambdas), topics/queues/buses,
// data stores and event types. Filter by type, kind, team, text and "has problems"; a row opens its page.

import { h, debounce } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { go, setQuery } from '../router.js';
import { pageHead } from '../components/page.js';
import { dataTable } from '../components/table.js';
import { detailPath } from './inventory-links.js';

const TYPES = [['', 'All'], ['service', 'Services'], ['channel', 'Topics and queues'], ['store', 'Data stores'], ['event', 'Event types']];
const TYPE_LABEL = { service: 'Service', channel: 'Channel', store: 'Data store', event: 'Event type' };

export async function render({ main, query }) {
  const items = await api.inventory(state.env);
  const f = { type: query.get('type') ?? '', kind: query.get('kind') ?? '', team: query.get('team') ?? '', q: query.get('q') ?? '', problems: query.get('problems') === '1' };
  const count = (t) => items.filter((x) => !t || x.type === t).length;

  const table = dataTable({
    rows: [], pageSize: 50, sortKey: 'label', onRow: (x) => go(detailPath(x)),
    columns: [
      { key: 'label', label: 'Name', render: (x) => h('div.stack', { style: { gap: 0 } }, h('b', { class: x.type === 'service' ? '' : 'key' }, x.label), x.group && x.group !== x.id ? h('span.xs.muted', x.group) : null) },
      { key: 'type', label: 'Type', render: (x) => h('span.small', TYPE_LABEL[x.type]) },
      { key: 'kind', label: 'Kind', render: (x) => h('span.pill', x.kind) },
      { key: 'team', label: 'Team', render: (x) => h('span.small.muted', x.team ?? '') },
      { key: 'size', label: 'Connections', render: (x) => h('span.small', x.connections) },
      { key: 'problems', label: 'Problems', num: true, render: (x) => (x.problems ? h('span', { style: { color: 'var(--bad)', fontWeight: 600 } }, String(x.problems)) : h('span.muted', '0')) },
    ],
  });

  const kindSel = h('select.select', { 'aria-label': 'Kind', on: { change: (e) => { f.kind = e.target.value; apply(); } } });
  const fillKinds = () => {
    const kinds = [...new Set(items.filter((x) => !f.type || x.type === f.type).map((x) => x.kind))].sort();
    if (!kinds.includes(f.kind)) f.kind = '';
    kindSel.replaceChildren(h('option', { value: '' }, 'All kinds'), ...kinds.map((k) => h('option', { value: k, selected: k === f.kind }, k)));
  };
  const teams = [...new Set(items.map((x) => x.team).filter(Boolean))].sort();
  const seg = h('div.seg', { role: 'group', 'aria-label': 'Type' }, TYPES.map(([t, label]) =>
    h('button', { 'aria-pressed': String(f.type === t), on: { click: () => { f.type = t; seg.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(TYPES[i][0] === t))); fillKinds(); apply(); } } },
      label, h('span.muted', ` ${count(t)}`))));
  const shown = h('span.small.muted');

  function apply() {
    const n = f.q.trim().toLowerCase();
    const rows = items.filter((x) => (!f.type || x.type === f.type) && (!f.kind || x.kind === f.kind) && (!f.team || x.team === f.team)
      && (!f.problems || x.problems > 0) && (!n || `${x.id} ${x.label} ${x.kind} ${x.team ?? ''} ${x.group ?? ''}`.toLowerCase().includes(n)));
    table.setRows(rows);
    shown.textContent = `${rows.length} shown`;
    setQuery({ type: f.type || null, kind: f.kind || null, team: f.team || null, q: f.q || null, problems: f.problems ? 1 : null });
  }

  main.append(
    pageHead('Inventory', `${items.length} objects in ${state.env}`,
      h('div.search', icon('search'), h('input.input', { type: 'search', placeholder: 'Filter by name, kind, team', value: f.q, 'aria-label': 'Filter inventory',
        on: { input: debounce((e) => { f.q = e.target.value; apply(); }) } })),
      kindSel,
      h('select.select', { 'aria-label': 'Team', on: { change: (e) => { f.team = e.target.value; apply(); } } },
        h('option', { value: '' }, 'All teams'), teams.map((t) => h('option', { value: t, selected: t === f.team }, t)))),
    h('div.filter-bar', seg,
      h('label.check', h('input', { type: 'checkbox', checked: f.problems, on: { change: (e) => { f.problems = e.target.checked; apply(); } } }), 'Only with problems'),
      h('span.spacer'), shown),
    h('div.content', h('div.box', table.el)));
  fillKinds();
  apply();
}
