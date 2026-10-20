// Inventory: every object in one table — services (incl. gateways and Lambdas), topics/queues/buses,
// data stores and event types. Filter by type (data stores split by database: MongoDB, Redis, …), kind,
// team, text and "has problems"; a row opens its page.

import { h, debounce } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { go, setQuery } from '../router.js';
import { pageHead } from '../components/page.js';
import { dataTable } from '../components/table.js';
import { openTarget, serviceLink, storePath } from './inventory-links.js';
import { objectIcon } from '../components/object-icon.js';
import { driverCounts, driversOn } from '../../core/clients.js';
import { MODE, breakable } from '../components/clients-table.js';

const TYPES = [['', 'All'], ['service', 'Services'], ['channel', 'Topics and queues'], ['event', 'Event types']];
const RPC = ['rpc', 'RPC commands']; // listed only when the env has RPC commands (0.19.0)
const isAmqp = (x) => x.type === 'rpc' || /^(amqp|rpc)-/.test(x.kind);
const DB = { mongodb: 'MongoDB', redis: 'Redis', dynamodb: 'DynamoDB', postgres: 'Postgres', mysql: 'MySQL', s3: 'S3', elasticsearch: 'Elasticsearch', 'external-http': 'External HTTP' };
const DB_ORDER = Object.keys(DB);
/** Type filter values: '', service, channel, event, or `store:<kind>` for one database type. */
const matches = (x, t) => !t || (t.startsWith('store:') ? x.type === 'store' && x.kind === t.slice(6) : t === 'amqp' ? isAmqp(x) : x.type === t);
/** Redis clusters and instances say which; other stores say their database. */
const KIND = { 'rpc-command-queue': 'rpc command queue', 'rpc-reply-queue': 'rpc reply queue', 'rpc-reply-queues': 'rpc reply queues', 'amqp-rpc': 'rpc command' };
const kindLabel = (x) => (x.exchangeType ? `${x.kind} · ${x.exchangeType}` : KIND[x.kind] ? KIND[x.kind] : x.type !== 'store' ? x.kind : x.instance ? `${DB[x.kind] ?? x.kind} ${x.instance}` : DB[x.kind] ?? x.kind);
const TYPE_LABEL = { service: 'Service', channel: 'Channel', store: 'Data store', event: 'Event type', rpc: 'RPC command' };

export async function render({ main, query }) {
  const [all, clients] = await Promise.all([api.inventory(state.env), api.clients(state.env)]);
  const f = { rpcq: query.get('rpcq') === '1', type: query.get('type') ?? '', kind: query.get('kind') ?? '', team: query.get('team') ?? '', q: query.get('q') ?? '', problems: query.get('problems') === '1', dto: query.get('dto') ?? '', driver: query.get('driver') ?? '' }; // driver: `<package>@<major>`, `<package>@` when the version is unknown
  if (f.type === 'store') f.type = ''; // older links
  const hasRpc = all.some((x) => x.type === 'rpc'), hasAmqp = all.some(isAmqp);
  let items = all; // RPC queues are plumbing: hidden unless "Show RPC queues" is on
  const pick1 = () => { items = f.rpcq ? all : all.filter((x) => !x.plumbing); };
  pick1();
  const count = (t) => items.filter((x) => matches(x, t)).length;
  const dbKinds = [...new Set(items.filter((x) => x.type === 'store').map((x) => x.kind))]
    .sort((a, b) => (DB_ORDER.indexOf(a) + 1 || 99) - (DB_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
  const typeList = hasRpc ? [...TYPES, RPC] : TYPES;
  const types = [...dbKinds.map((k) => [`store:${k}`, DB[k] ?? k])];

  const table = dataTable({
    rows: [], pageSize: 50, sortKey: 'label', onRow: (x) => go(...openTarget(x)), rowClass: (x) => (x.plumbing ? 'plumb' : ''),
    columns: [
      { key: 'label', label: 'Name', render: (x) => h('div.name-cell', objectIcon(x.type, x.kind, 22), h('div.stack', { style: { gap: 0 } }, h('b', { class: x.type === 'service' ? '' : x.type === 'rpc' || x.plumbing ? 'key nowrap' : 'key' }, x.label), x.group && x.group !== x.id ? h('span.xs.muted', x.group) : null)) },
      { key: 'type', label: 'Type', render: (x) => h('span.small.nowrap', TYPE_LABEL[x.type]) },
      { key: 'kind', label: 'Kind', render: (x) => h('span.pill.kind-pill', { class: isAmqp(x) ? (x.type === 'rpc' || /^rpc-/.test(x.kind) ? 'rpc' : 'amqp') : '' }, x.type === 'store' ? objectIcon('store', x.kind, 14) : null, kindLabel(x)) },
      { key: 'team', label: 'Team', render: (x) => h('span.small.muted', x.team ?? '') },
      { key: 'size', label: 'Connections', render: (x) => h('span.small', x.connections) },
      { key: 'hasDto', label: 'Message DTO', sort: (x) => (x.type === 'event' ? (x.hasDto ? 1 : 0) : null),
        render: (x) => (x.type !== 'event' ? '' : x.hasDto ? h('span.pill.ok', 'Has DTO') : h('span.small.muted', 'No DTO')) },
      { key: 'problems', label: 'Problems', num: true, render: (x) => (x.problems ? h('span', { style: { color: 'var(--bad)', fontWeight: 600 } }, String(x.problems)) : h('span.muted', '0')) },
    ],
  });

  const kindSel = h('select.select', { 'aria-label': 'Kind', on: { change: (e) => { f.kind = e.target.value; apply(); } } });
  const fillKinds = () => {
    const kinds = [...new Set(items.filter((x) => matches(x, f.type)).map((x) => x.kind))].sort();
    if (!kinds.includes(f.kind)) f.kind = '';
    kindSel.hidden = f.type.startsWith('store:') || kinds.length < 2; // a database button already fixes the kind
    kindSel.replaceChildren(h('option', { value: '' }, 'All kinds'), ...kinds.map((k) => h('option', { value: k, selected: k === f.kind }, k)));
  };
  const dtoSel = h('select.select', { 'aria-label': 'Message DTO', on: { change: (e) => { f.dto = e.target.value; apply(); } } },
    [['', 'Any message DTO'], ['yes', 'Has DTO'], ['no', 'No DTO']].map(([v, l]) => h('option', { value: v, selected: v === f.dto }, l)));
  const teams = [...new Set(items.map((x) => x.team).filter(Boolean))].sort();
  const buttons = [];
  const pick = (t) => { f.type = t; dtoSel.hidden = t !== 'event'; buttons.forEach(([v, b]) => b.setAttribute('aria-pressed', String(v === t))); fillKinds(); if (!t.startsWith('store:')) f.driver = ''; fillFacet(); apply(); };
  const button = ([t, label]) => {
    const b = h('button', { 'aria-pressed': String(f.type === t), on: { click: () => pick(t) } },
      t.startsWith('store:') ? objectIcon('store', t.slice(6), 16) : null, label, h('span.muted', ` ${count(t)}`));
    buttons.push([t, b]);
    return b;
  };
  const recount = () => buttons.forEach(([t, b]) => { b.lastChild.textContent = ` ${count(t)}`; });
  /** The fold row for RPC plumbing: what is hidden, and the switch (the commands are listed as entry points of their servers). */
  const fold = h('label.check.rpc-fold');
  const drawFold = () => {
    const mine = all.filter((x) => x.plumbing && matches(x, f.type));
    fold.hidden = !mine.length;
    const cmd = mine.filter((x) => x.kind === 'rpc-command-queue').length, rep = mine.filter((x) => x.kind !== 'rpc-command-queue').length;
    const parts = [cmd ? `${cmd} command ${cmd === 1 ? 'queue' : 'queues'}` : null, rep ? `${rep} reply-queue ${rep === 1 ? 'row' : 'rows'}` : null].filter(Boolean).join(' and ');
    fold.replaceChildren(h('input', { type: 'checkbox', checked: f.rpcq, on: { change: (e) => { f.rpcq = e.target.checked; pick1(); recount(); fillKinds(); apply(); } } }), h('b', 'Show RPC queues'),
      h('span.muted', f.rpcq ? ` ${parts} shown, muted. The RPC commands they carry are listed as entry points of their servers.` : ` ${mine.length} hidden: ${parts}. The RPC commands they carry are listed as entry points of their servers.`));
  };
  const seg = h('div.row', { style: { gap: 'var(--s2)', flexWrap: 'wrap' } },
    h('div.seg', { role: 'group', 'aria-label': 'Type' }, typeList.map(button)),
    dbKinds.length ? [h('span.small.muted', 'Data stores'), h('div.seg', { role: 'group', 'aria-label': 'Database' }, types.map(button))] : null,
    hasAmqp ? [h('span.small.muted', 'Brokers'), h('div.seg', { role: 'group', 'aria-label': 'Broker' }, [['amqp', 'AMQP']].map(button))] : null);
  const shown = h('span.small.muted');
  /** One row per client site on the chosen driver: the service, its store, and where the driver comes from (its own, or inside a lib). */
  const svcTable = dataTable({
    rows: [], pageSize: 50, sortKey: 'service', onRow: (r) => go(storePath(r.store)), empty: 'No service uses this driver here.',
    columns: [
      { key: 'service', label: 'Service', render: (r) => h('b.nowrap', serviceLink(r.service)) },
      { key: 'store', label: 'Store', render: (r) => h('span.key', breakable(r.store ?? '')) },
      { key: 'where', label: 'Where the version comes from', sort: (r) => r.where, render: (r) => h('span', r.where) },
      { key: 'mode', label: 'Access', sort: (r) => r.mode, render: (r) => h('span.nowrap', r.mode) },
    ],
  });
  svcTable.el.hidden = true;
  const where = (r) => driversOn(r, f.driver).map((d) => (d.from === 'own'
    ? `own driver ${d.version ?? 'version not reported'}`
    : `inside ${r.lib?.package ?? 'its library'}${r.lib?.version ? ' ' + r.lib.version : ''} (${d.package} ${d.version ?? 'version not reported'})`)).join('; ');
  const facet = h('div.row', { style: { gap: 'var(--s2)', flexWrap: 'wrap' } });
  const fillFacet = () => {
    const kind = f.type.startsWith('store:') ? f.type.slice(6) : null;
    facet.hidden = !kind;
    if (!kind) return;
    const counts = driverCounts(clients.rows.filter((r) => r.kind === kind));
    facet.hidden = !counts.length;
    const pickDriver = (v) => { f.driver = v; apply(); fillFacet(); };
    const one = (v, label, n) => h('button', { 'aria-pressed': String(f.driver === v), on: { click: () => pickDriver(v) } }, label, n != null ? h('span.muted', ` ${n} ${n === 1 ? 'service' : 'services'}`) : null);
    facet.replaceChildren(h('span.small.muted', 'Driver'), h('div.seg', { role: 'group', 'aria-label': 'Driver' },
      one('', 'Any'), counts.map((c) => one(`${c.driver}@${c.major ?? ''}`, c.label, c.services))));
  };

  function apply() {
    const n = f.q.trim().toLowerCase();
    const kind = f.type.startsWith('store:') ? f.type.slice(6) : null;
    drawFold();
    setQuery({ rpcq: f.rpcq ? 1 : null, type: f.type || null, kind: f.kind || null, team: f.team || null, q: f.q || null, problems: f.problems ? 1 : null, dto: f.type === 'event' && f.dto ? f.dto : null, driver: f.driver || null });
    table.el.hidden = !!f.driver;
    svcTable.el.hidden = !f.driver;
    if (f.driver) { // a driver filter lists services (who is on it and why), from the same rows the facet counts
      const rows = clients.rows.filter((r) => (!kind || r.kind === kind) && driversOn(r, f.driver).length
        && (!n || `${r.service} ${r.store ?? ''}`.toLowerCase().includes(n))).map((r) => ({ ...r, where: where(r), mode: MODE[r.accessMode] ?? 'Not reported' }));
      svcTable.setRows(rows);
      const stores = new Set(rows.map((r) => r.store)).size, svcs = new Set(rows.map((r) => r.service)).size;
      shown.textContent = `${svcs} ${svcs === 1 ? 'service' : 'services'} on ${stores} ${stores === 1 ? 'store' : 'stores'}`;
      return;
    }
    const rows = items.filter((x) => matches(x, f.type) && (!f.kind || x.kind === f.kind) && (!f.team || x.team === f.team)
      && (!f.problems || x.problems > 0) && (f.type !== 'event' || !f.dto || (f.dto === 'yes') === !!x.hasDto) && (!n || `${x.id} ${x.label} ${x.kind} ${x.team ?? ''} ${x.group ?? ''}`.toLowerCase().includes(n)));
    table.setRows(rows);
    shown.textContent = `${rows.length} shown`;
  }

  main.append(
    pageHead('Inventory', `${all.filter((x) => !x.plumbing).length} objects in ${state.env}`,
      h('div.search', icon('search'), h('input.input', { type: 'search', placeholder: 'Filter by name, kind, team', value: f.q, 'aria-label': 'Filter inventory',
        on: { input: debounce((e) => { f.q = e.target.value; apply(); }) } })),
      kindSel, dtoSel,
      h('select.select', { 'aria-label': 'Team', on: { change: (e) => { f.team = e.target.value; apply(); } } },
        h('option', { value: '' }, 'All teams'), teams.map((t) => h('option', { value: t, selected: t === f.team }, t)))),
    h('div.filter-bar', seg, facet,
      h('label.check', h('input', { type: 'checkbox', checked: f.problems, on: { change: (e) => { f.problems = e.target.checked; apply(); } } }), 'Only with problems'),
      h('span.spacer'), shown),
    h('div.content', fold, h('div.box', table.el, svcTable.el)));
  dtoSel.hidden = f.type !== 'event';
  fillKinds();
  fillFacet();
  apply();
}
