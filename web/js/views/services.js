// Services: searchable, sortable table of every service with size and link health.

import { h, debounce } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { go, setQuery } from '../router.js';
import { pageHead } from '../components/page.js';
import { dataTable } from '../components/table.js';
import { ago, coverageBar } from '../format.js';

export async function render({ main, query }) {
  const [services, sys] = await Promise.all([api.services(state.env), api.system(state.env)]);
  const stats = new Map(sys.nodes.filter((n) => n.stats).map((n) => [n.label, n.stats]));
  const rows = services.filter((s) => s.kind !== 'infra').map((s) => ({
    ...s, ...(stats.get(s.name) ?? {}), coverage: s.health?.coverage ?? null, dangling: s.health?.dangling ?? 0, orphans: s.health?.orphans ?? 0,
  }));
  const teams = [...new Set(rows.map((r) => r.team).filter(Boolean))].sort();
  let q = query.get('q') ?? '', team = query.get('team') ?? '';

  const table = dataTable({
    rows: [], pageSize: 50, sortKey: 'name', onRow: (r) => go(`/services/${encodeURIComponent(r.name)}`),
    columns: [
      { key: 'name', label: 'Service', render: (r) => h('div.stack', { style: { gap: 0 } }, h('b', r.name), h('span.xs.muted', [r.kind === 'gateway' ? 'gateway' : null, r.language].filter(Boolean).join(', '))) },
      { key: 'team', label: 'Team' },
      { key: 'version', label: 'Version', num: true, render: (r) => `v${r.version}` },
      { key: 'ingress', label: 'Ingress', num: true },
      { key: 'egress', label: 'Egress', num: true },
      { key: 'functions', label: 'Functions', num: true },
      { key: 'coverage', label: 'Resolved calls', render: (r) => coverageBar(r.coverage), sort: (r) => r.coverage ?? 2 },
      { key: 'dangling', label: 'Broken', num: true, render: (r) => (r.dangling ? h('span', { style: { color: 'var(--bad)', fontWeight: 600 } }, String(r.dangling)) : '0') },
      { key: 'orphans', label: 'Never called', num: true },
      { key: 'harvestedAt', label: 'Harvested', render: (r) => h('span.small.muted', ago(r.harvestedAt)) },
    ],
  });

  const filter = () => {
    const n = q.trim().toLowerCase();
    table.setRows(rows.filter((r) => (!team || r.team === team) && (!n || r.name.includes(n) || (r.team ?? '').includes(n) || (r.tags ?? []).some((t) => t.includes(n)))));
    setQuery({ q: q || null, team: team || null });
  };
  const search = h('input.input', { type: 'search', placeholder: 'Filter services', value: q, 'aria-label': 'Filter services',
    on: { input: debounce((e) => { q = e.target.value; filter(); }) } });

  main.append(
    pageHead('Services', `${rows.length} services in ${state.env}`,
      h('div.search', icon('search'), search),
      h('select.select', { 'aria-label': 'Team', on: { change: (e) => { team = e.target.value; filter(); } } },
        h('option', { value: '' }, 'All teams'), teams.map((t) => h('option', { value: t, selected: t === team }, t)))),
    h('div.content', h('div.box', table.el)));
  filter();
}
