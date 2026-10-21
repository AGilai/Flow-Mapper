// Service view: one service's ingress and egress as a switchboard, plus functions and change history.
// The info button on an ingress opens the endpoint panel (code link and DTOs); `ep` in the URL keeps it open.

import { h, clear, fill, debounce } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { href, setQuery } from '../router.js';
import { pageHead } from '../components/page.js';
import { dataTable } from '../components/table.js';
import { createPanel } from '../components/panel.js';
import { ago } from '../format.js';
import { switchboard } from './service-switchboard.js';
import { endpointPanel } from './endpoint-panel.js';
import { titled } from '../components/object-icon.js';

export async function render({ main, params, query }) {
  const name = params.name;
  const [v, log] = await Promise.all([api.service(state.env, name), api.changelog(state.env, name, 30)]);
  const s = v.service;
  const tab = query.get('tab') ?? 'connections';
  const broken = v.egress.filter((e) => e.dangling).length;
  const orphans = v.ingress.filter((i) => i.orphan).length;

  const meta = h('div.svc-meta',
    h('span', { gateway: 'Gateway', lambda: 'Lambda', 'client-app': 'Client app' }[s.kind] ?? 'Service', s.team ? [' owned by ', h('b', s.team)] : null),
    s.language ? h('span', h('b', s.language)) : null,
    h('span', 'Version ', h('b', `v${s.version}`), s.commit ? h('span.muted', ` (${s.commit})`) : null),
    h('span', 'Harvested ', h('b', ago(s.harvestedAt))),
    s.repo ? h('span.muted.truncate', s.repo) : null);

  const figures = h('div.figures',
    fig(v.ingress.length, 'Ingress'), fig(v.egress.length, 'Egress'), fig(v.functions.length, 'Functions'),
    fig(broken, 'Broken calls', broken > 0), fig(orphans, 'Never called'), fig(v.openBugs, 'Open bugs', v.openBugs > 0));

  const body = h('div');
  const host = h('div.panel-host');
  const panel = createPanel(host, { onClose: () => setQuery({ ep: null }) });
  async function showEndpoint(id) {
    setQuery({ ep: id });
    try { panel.open(...endpointPanel(await api.endpoint(state.env, name, id), state.env)); }
    catch (err) { panel.open('Endpoint', h('p.small.muted', err.message)); }
  }
  const tabs = h('div.tabs', { role: 'tablist' }, [['connections', 'Connections'], ['functions', `Functions (${v.functions.length})`], ['changes', 'Changes']].map(([id, label]) =>
    h('button', { role: 'tab', 'aria-selected': String(id === tab), on: { click: () => { setQuery({ tab: id }); show(id); } } }, label)));

  function show(id) {
    tabs.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-selected', String(['connections', 'functions', 'changes'][i] === id)));
    fill(body, id === 'functions' ? functionsTab(v, name) : id === 'changes' ? changesTab(log) : connectionsTab(v, name, query, showEndpoint));
  }

  main.append(
    pageHead(titled('service', s.kind, name), s.description ?? null,
      h('a.btn', { href: href('/system', { sel: `svc:${name}` }) }, icon('system'), 'Show on map'),
      h('a.btn', { href: href('/bugs/new', { service: name }) }, icon('bug'), 'Report a bug'),
      h('a.btn.primary', { href: href('/flows', { service: name }) }, icon('flow'), 'Trace a flow')),
    host);
  host.prepend(h('div.content', h('div.page-grid', h('div.svc-head', meta, figures), h('div', tabs, body))));
  show(tab);
  if (query.get('ep')) showEndpoint(query.get('ep'));
}

const fig = (n, label, bad = false) => h('div.figure', { class: bad ? 'bad' : '' }, h('b', String(n ?? 0)), h('span', label));

function connectionsTab(v, name, query, onInfo) {
  const holder = h('div');
  const input = h('input.input', { type: 'search', placeholder: 'Filter endpoints, services, functions', value: query.get('f') ?? '', 'aria-label': 'Filter connections' });
  const draw = () => { fill(holder, switchboard(v, name, input.value.trim().toLowerCase(), onInfo)); setQuery({ f: input.value || null }); };
  input.addEventListener('input', debounce(draw, 120));
  draw();
  return h('div.stack', { style: { gap: 'var(--s4)' } }, h('div.search', icon('search'), input), holder);
}

function functionsTab(v, name) {
  const usedBy = new Map();
  for (const i of v.ingress) usedBy.set(i.handler, [...(usedBy.get(i.handler) ?? []), i]);
  return h('div.box', dataTable({
    rows: v.functions, pageSize: 50, sortKey: 'name',
    columns: [
      { key: 'name', label: 'Function', render: (f) => h('a', { href: href('/flows', { service: name, fn: f.id, scope: 'intra' }) }, f.name) },
      { key: 'file', label: 'Location', render: (f) => h('span.key.muted', f.file ? `${f.file}${f.line ? ':' + f.line : ''}` : '') },
      { key: 'steps', label: 'Steps', num: true },
      { key: 'unresolved', label: 'Gaps', nosort: true, render: (f) => (f.unresolved ?? []).map((u) => h('span.pill.gap', { title: [u.detail, u.candidates?.length ? `candidates: ${u.candidates.join(', ')}` : null].filter(Boolean).join('\n') }, `${u.what}: ${u.reason}`)) },
      { key: 'entry', label: 'Handles', nosort: true, render: (f) => (usedBy.get(f.id) ?? []).slice(0, 3).map((i) => h('div.key', i.bindKey)) },
    ],
  }).el);
}

function changesTab(log) {
  if (!log.length) return h('div.empty', h('p', 'No changes recorded yet.'));
  const summary = (c) => {
    const parts = [];
    for (const [verb, m] of [['added', c.changes.added], ['changed', c.changes.changed], ['removed', c.changes.removed]])
      for (const [list, keys] of Object.entries(m ?? {})) parts.push(`${keys.length} ${list} ${verb}`);
    if (c.changes.created) parts.push('service created');
    if (c.changes.serviceUpdated) parts.push(`updated ${c.changes.serviceUpdated.join(', ')}`);
    return parts.join(', ') || 'no entity changes';
  };
  return h('div.box', h('div.list', { style: { padding: 'var(--s2)' } }, log.map((c) =>
    h('div.list-item', h('span.pill', c.kind), h('span', c.from_version ? `v${c.from_version} to v${c.to_version}` : `v${c.to_version}`),
      h('span.grow.muted.truncate', summary(c)), h('span.xs.muted', `${c.source}, ${ago(c.at)}`)))));
}

