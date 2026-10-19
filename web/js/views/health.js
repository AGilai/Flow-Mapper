// Link health: what does not connect. Totals, worst services first, and every broken item, paged.

import { h, fill } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { go, href, setQuery } from '../router.js';
import { pageHead } from '../components/page.js';
import { dataTable } from '../components/table.js';
import { chip, coverageBar, pct, splitKey } from '../format.js';

const KINDS = [
  { id: 'dangling', label: 'Calls with no match', help: 'An egress whose bind key matches no ingress, queue or route.' },
  { id: 'orphans', label: 'Never called', help: 'Ingress nothing reaches. Entry points (public routes, crons) are not counted.' },
  { id: 'unbound', label: 'Unbound queues and topics', help: 'Topics without a subscription, queues without a consumer, exchanges without a binding.' },
  { id: 'brokenBindings', label: 'Subscriptions to nothing', help: 'A subscription or binding whose target matches nothing.' },
  { id: 'ambiguous', label: 'Ambiguous calls', help: 'A unicast call with more than one equally specific match.' },
];

export async function render({ main, query }) {
  const r = await api.health(state.env);
  const t = r.totals;
  let kind = query.get('kind') ?? 'dangling';

  const figures = h('div.figures',
    fig(pct(t.coverage), 'Calls resolved'),
    fig(t.links.toLocaleString(), 'Links'),
    ...KINDS.map((k) => fig(t[k.id], k.label, t[k.id] > 0 && k.id !== 'orphans')));

  const itemsBox = h('div.box');
  const tabs = h('div.tabs', { role: 'tablist' });
  function showKind(id) {
    kind = id;
    setQuery({ kind: id });
    fill(tabs, KINDS.map((k) => h('button', { role: 'tab', 'aria-selected': String(k.id === id), on: { click: () => showKind(k.id) } }, `${k.label} (${t[k.id]})`)));
    const k = KINDS.find((x) => x.id === id);
    fill(itemsBox, h('div.box-head', h('p.small.muted', k.help)), itemsTable(id, r.items[id]).el);
  }

  const worst = dataTable({
    rows: r.services.filter((s) => s.dangling || s.orphans || s.unbound || s.ambiguous), pageSize: 15,
    sortKey: 'dangling', sortDir: 'desc', onRow: (s) => go(`/services/${encodeURIComponent(s.service)}`),
    empty: 'Every service connects cleanly.',
    columns: [
      { key: 'service', label: 'Service', render: (s) => h('b', s.service) },
      { key: 'coverage', label: 'Resolved calls', render: (s) => coverageBar(s.coverage), sort: (s) => s.coverage ?? 2 },
      { key: 'dangling', label: 'No match', num: true },
      { key: 'orphans', label: 'Never called', num: true },
      { key: 'unbound', label: 'Unbound', num: true },
    ],
  });

  main.append(
    pageHead('Link health', `How well the harvested keys connect in ${state.env}`),
    h('div.content', h('div.page-grid',
      figures,
      h('div.two-col',
        h('section.stack', tabs, itemsBox),
        h('section.box', h('div.box-head', h('h2', 'Services to look at')), worst.el)))));
  showKind(kind);
}

const fig = (v, label, bad = false) => h('div.figure', { class: bad ? 'bad' : '' }, h('b', String(v)), h('span', label));

function itemsTable(kind, rows) {
  const svc = (s) => h('a', { href: href(`/services/${encodeURIComponent(s)}`) }, s);
  const keyCell = (key) => { const k = splitKey(key); return h('div.row', chip(k.transport), h('span.key', k.rest)); };
  const columns = {
    dangling: [{ key: 'service', label: 'Caller', render: (x) => svc(x.service) }, { key: 'bindKey', label: 'Key', render: (x) => keyCell(x.bindKey) }, { key: 'id', label: 'Egress id', render: (x) => h('span.key.muted', x.id) }],
    orphans: [{ key: 'service', label: 'Service', render: (x) => svc(x.service) }, { key: 'bindKey', label: 'Key', render: (x) => keyCell(x.bindKey) }, { key: 'id', label: 'Ingress id', render: (x) => h('a.key', { href: href('/flows', { service: x.service, ingress: x.id }) }, x.id) }],
    unbound: [{ key: 'bindKey', label: 'Channel', render: (x) => keyCell(x.bindKey) }, { key: 'kind', label: 'Kind' }, { key: 'reason', label: 'Problem' }, { key: 'service', label: 'Declared by', render: (x) => svc(x.service) }],
    brokenBindings: [{ key: 'service', label: 'Service', render: (x) => svc(x.service) }, { key: 'from', label: 'From', render: (x) => h('span.key', x.from) }, { key: 'to', label: 'To', render: (x) => h('span.key', x.to) }],
    ambiguous: [{ key: 'service', label: 'Caller', render: (x) => svc(x.service) }, { key: 'bindKey', label: 'Key', render: (x) => keyCell(x.bindKey) }, { key: 'candidates', label: 'Matches', nosort: true, render: (x) => x.candidates.map((c) => h('div.key', c)) }],
  }[kind];
  return dataTable({ rows, columns, pageSize: 25, sortKey: columns[0].key, empty: 'Nothing here.' });
}
