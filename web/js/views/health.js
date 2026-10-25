// Link health: what does not connect. Totals, worst services first, and every broken item, paged.

import { externalTag } from '../components/external-tag.js';
import { h, fill } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { go, href, setQuery } from '../router.js';
import { pageHead } from '../components/page.js';
import { dataTable } from '../components/table.js';
import { filterText, chip, coverageBar, pct, splitKey } from '../format.js';
import { storeLink } from './inventory-links.js';
import { valueText } from '../components/assumed-badge.js';

const KINDS = [
  { id: 'dangling', label: 'Calls with no match', help: 'An egress whose bind key matches no ingress, queue or route.' },
  { id: 'orphans', label: 'Never called', help: 'Ingress nothing reaches. Entry points (public routes, crons) are not counted.' },
  { id: 'unbound', label: 'Unbound queues and topics', help: 'Topics without a subscription, queues without a consumer, exchanges without a binding.' },
  { id: 'brokenBindings', label: 'Subscriptions to nothing', help: 'A subscription or binding whose target matches nothing.' },
  { id: 'ambiguous', label: 'Ambiguous calls', help: 'A unicast call with more than one equally specific match.' },
  { id: 'unhandledEvents', label: 'Unhandled events', help: 'An event type reaches a consumer that lists its event types, and none matches. Those messages fail or go to the dead-letter queue.' },
  { id: 'undeliveredEvents', label: 'Events filtered out', help: 'Published, but every subscription on the way filters this event type out.' },
  { id: 'neverArrives', label: 'Events nothing sends', help: 'A consumer handles this event type, but no producer sends it on a route into its queue and none is declared.' },
  { id: 'declaredNotSeen', label: 'Declared producers not seen', help: 'A consumer declares a producer that Flow-Mapper harvests, but that service does not send this event type to it.' },
  { id: 'subscriptionConflicts', label: 'Subscription conflicts', help: 'The same subscription is reported by more than one manifest with different event filters.' },
  { id: 'multipleWriters', label: 'Stores with several writers', help: 'More than one service writes to the same collection, table or key. Those services are coupled through the data.', store: true },
  { id: 'unusedStores', label: 'Unused stores', help: 'A data store a service declares but no function uses.', store: true },
  { id: 'unresolved', label: 'Unresolved by harvesters', help: 'Calls, consumers and event types a harvester found but could not resolve, with its reason. Not counted as broken links.', harvest: true },
  { id: 'assumed', label: 'Assumed values', help: 'Values a harvester filled by a rule (a client default, a convention) instead of reading them from code. Informational: defaults, not facts, and not problems. Not in the coverage figure.', harvest: true },
  { id: 'mixedCommits', label: 'Mixed commits', help: 'Services whose items were scanned at different commits. Code links follow each item\'s own commit.', harvest: true },
  { id: 'drift', label: 'Drift from live', help: 'Items a harvester checked against the live system and found different.', harvest: true },
];

export async function render({ main, query }) {
  const r = await api.health(state.env);
  const t = r.totals;
  let kind = query.get('kind') ?? 'dangling';

  const figures = h('div.figures',
    fig(pct(t.coverage), 'Calls resolved'),
    fig(t.links.toLocaleString(), 'Links'),
    ...KINDS.slice(0, 5).map((k) => fig(t[k.id], k.label, t[k.id] > 0 && k.id !== 'orphans')),
    fig(KINDS.slice(5, 10).reduce((n, k) => n + t[k.id], 0), 'Event problems', KINDS.slice(5, 10).some((k) => t[k.id] > 0)),
    fig(t.multipleWriters + t.unusedStores, 'Store problems', t.multipleWriters > 0),
    fig(t.unresolved, 'Unresolved by harvesters'),
    fig(t.assumed, 'Assumed values'));

  const itemsBox = h('div.box');
  const tabs = h('div.tabs', { role: 'tablist' });
  function showKind(id) {
    kind = id;
    setQuery({ kind: id });
    fill(tabs, KINDS.map((k) => h('button', { role: 'tab', 'aria-selected': String(k.id === id), on: { click: () => showKind(k.id) } }, `${k.label} (${t[k.id]})`)));
    const k = KINDS.find((x) => x.id === id);
    // unresolved: how many per reason, so the biggest gaps in the harvesters are obvious
    const byReason = id === 'unresolved' ? [...r.items.unresolved.reduce((m, x) => m.set(x.reason, (m.get(x.reason) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]) : [];
    const byBasis = id === 'assumed' ? Object.entries(r.assumedByBasis ?? {}).sort((a, b) => b[1] - a[1]) : [];
    fill(itemsBox, h('div.box-head', h('p.small.muted', k.help),
      byReason.length ? h('div.ep-producers', byReason.map(([reason, n]) => h('span.pill.gap', `${reason} ${n}`))) : null,
      byBasis.length ? h('div.ep-producers', byBasis.map(([basis, n]) => h('span.pill.assumed', `${basis} ${n}`))) : null), itemsTable(id, r.items[id]).el);
  }

  const worst = dataTable({
    rows: r.services.filter((s) => s.dangling || s.orphans || s.unbound || s.ambiguous || s.eventIssues || s.storeIssues || s.unresolved), pageSize: 15,
    sortKey: 'dangling', sortDir: 'desc', onRow: (s) => go(`/services/${encodeURIComponent(s.service)}`),
    empty: 'Every service connects cleanly.',
    columns: [
      { key: 'service', label: 'Service', render: (s) => [h('b', s.service), externalTag(s)] },
      { key: 'coverage', label: 'Resolved calls', render: (s) => coverageBar(s.coverage), sort: (s) => s.coverage ?? 2 },
      { key: 'dangling', label: 'No match', num: true },
      { key: 'orphans', label: 'Never called', num: true },
      { key: 'unbound', label: 'Unbound', num: true },
      { key: 'eventIssues', label: 'Event problems', num: true },
      { key: 'storeIssues', label: 'Store problems', num: true },
      { key: 'unresolved', label: 'Unresolved', num: true },
      { key: 'assumed', label: 'Assumed', num: true },
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
  const ev = { key: 'event', label: 'Event type', render: (x) => h('span.key', x.event) };
  const keyCell = (key) => { const k = splitKey(key); return h('div.row', chip(k.transport), h('span.key', k.rest)); };
  const columns = {
    dangling: [{ key: 'service', label: 'Caller', render: (x) => svc(x.service) }, { key: 'bindKey', label: 'Key', render: (x) => keyCell(x.bindKey) }, { key: 'id', label: 'Egress id', render: (x) => h('span.key.muted', x.id) }],
    orphans: [{ key: 'service', label: 'Service', render: (x) => svc(x.service) }, { key: 'bindKey', label: 'Key', render: (x) => keyCell(x.bindKey) }, { key: 'id', label: 'Ingress id', render: (x) => h('a.key', { href: href('/flows', { service: x.service, ingress: x.id }) }, x.id) }],
    unbound: [{ key: 'bindKey', label: 'Channel', render: (x) => keyCell(x.bindKey) }, { key: 'kind', label: 'Kind' }, { key: 'reason', label: 'Problem' }, { key: 'service', label: 'Declared by', render: (x) => svc(x.service) }],
    brokenBindings: [{ key: 'service', label: 'Service', render: (x) => svc(x.service) }, { key: 'from', label: 'From', render: (x) => h('span.key', x.from) }, { key: 'to', label: 'To', render: (x) => h('span.key', x.to) }],
    unhandledEvents: [{ key: 'service', label: 'Consumer', render: (x) => svc(x.service) }, ev, { key: 'producer', label: 'Sent by', render: (x) => svc(x.producer) }, { key: 'ingress', label: 'Ingress id', render: (x) => h('span.key.muted', x.ingress) }],
    undeliveredEvents: [{ key: 'service', label: 'Producer', render: (x) => svc(x.service) }, ev, { key: 'bindKey', label: 'Published to', render: (x) => keyCell(x.bindKey) }],
    neverArrives: [{ key: 'service', label: 'Consumer', render: (x) => svc(x.service) }, ev, { key: 'bindKey', label: 'Queue', render: (x) => keyCell(x.bindKey) }],
    declaredNotSeen: [{ key: 'service', label: 'Consumer', render: (x) => svc(x.service) }, ev, { key: 'producer', label: 'Declared producer', render: (x) => svc(x.producer) }],
    multipleWriters: [{ key: 'key', label: 'Data store', render: (x) => storeLink(x.key) }, { key: 'kind', label: 'Kind' }, { key: 'service', label: 'Writer', render: (x) => svc(x.service) }, { key: 'writers', label: 'All writers', nosort: true, render: (x) => h('span.small', x.writers.join(', ')) }],
    unusedStores: [{ key: 'key', label: 'Data store', render: (x) => storeLink(x.key) }, { key: 'kind', label: 'Kind' }, { key: 'service', label: 'Declared by', render: (x) => svc(x.service) }],
    unresolved: [{ key: 'reason', label: 'Reason', render: (x) => h('span.pill.gap', x.reason) }, { key: 'service', label: 'Service', render: (x) => svc(x.service) },
      { key: 'id', label: 'Where', render: (x) => h('div.stack', { style: { gap: 0 } }, h('span.key', x.id), h('span.xs.muted', `${x.kind}, ${x.what === 'event' ? 'event type' : x.what === 'caller' ? 'caller' : x.what === 'detail' ? 'field' : 'target'}`)) },
      { key: 'detail', label: 'Detail', render: (x) => h('span.small.key', x.detail ?? '') },
      { key: 'candidates', label: 'Candidates', nosort: true, render: (x) => x.candidates.map((c) => h('div.key.small', c, x.possible.some((p) => p.candidate === c) ? h('span.xs.muted', ` → ${x.possible.filter((p) => p.candidate === c).map((p) => p.service).join(', ')}`) : null)) }],
    assumed: [{ key: 'basis', label: 'Basis', render: (x) => h('span.pill.assumed', { style: { marginLeft: 0 } }, x.basis) }, { key: 'service', label: 'Service', render: (x) => svc(x.service) },
      { key: 'id', label: 'Where', render: (x) => h('div.stack', { style: { gap: 0 } }, h('span.key', x.id), h('span.xs.muted', x.kind)) },
      { key: 'detail', label: 'Field', render: (x) => h('span.small.key', { style: { whiteSpace: 'nowrap' } }, x.detail ?? x.what) },
      { key: 'value', label: 'Value used', nosort: true, render: (x) => h('span.small.key', valueText(x.value)) },
      { key: 'reason', label: 'Reason', nosort: true, render: (x) => h('span.small', x.reason) }],
    mixedCommits: [{ key: 'service', label: 'Service', render: (x) => svc(x.service) }, { key: 'commit', label: 'Manifest commit', render: (x) => h('span.key', x.commit ?? '') },
      { key: 'others', label: 'Items at other commits', nosort: true, render: (x) => x.others.map((o) => h('div.small', h('span.key', o.commit), ` ${o.items} items`)) }],
    drift: [{ key: 'service', label: 'Service', render: (x) => svc(x.service) }, { key: 'kind', label: 'Kind' }, { key: 'id', label: 'Item', render: (x) => h('span.key', x.id) },
      { key: 'producer', label: 'Checked by', render: (x) => h('span.small', [x.provenance.producer, x.provenance.runId].filter(Boolean).join(' · ')) }],
    subscriptionConflicts: [{ key: 'from', label: 'From', render: (x) => h('span.key', x.from) }, { key: 'to', label: 'To', render: (x) => h('span.key', x.to) },
      { key: 'declarations', label: 'Reported as', nosort: true, render: (x) => x.declarations.map((d) => h('div.small', h('b', d.service), ': ', filterText(d.events))) }],
    ambiguous: [{ key: 'service', label: 'Caller', render: (x) => svc(x.service) }, { key: 'bindKey', label: 'Key', render: (x) => keyCell(x.bindKey) }, { key: 'candidates', label: 'Matches', nosort: true, render: (x) => x.candidates.map((c) => h('div.key', c)) }],
  }[kind];
  return dataTable({ rows, columns, pageSize: 25, sortKey: columns[0].key, empty: 'Nothing here.' });
}
