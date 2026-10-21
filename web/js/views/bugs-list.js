// Bugs: prioritized list with filters. Priority = severity + how many flows the linked parts of the map carry.

import { h, debounce } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { go, href, setQuery } from '../router.js';
import { openBugDialog } from '../components/bug-dialog.js';
import { pageHead } from '../components/page.js';
import { dataTable } from '../components/table.js';
import { ago, priorityPill, statusPill } from '../format.js';

const VIEWS = [['open', 'Open'], ['fixed', 'Awaiting verification'], ['done', 'Done'], ['all', 'All']];
const STATUS_FOR = { open: 'open,triaged,in_progress', fixed: 'fixed', done: 'verified,closed,wont_fix,duplicate', all: '' };

export async function render({ main, query }) {
  const f = { view: query.get('view') ?? 'open', priority: query.get('priority') ?? '', version: query.get('version') ?? '', q: query.get('q') ?? '' };
  const [all, stats] = await Promise.all([api.bugs({ limit: 1000 }), api.bugStats()]);
  const versions = Object.keys(stats.byVersion ?? {}).sort().reverse();
  const open = all.filter((b) => ['open', 'triaged', 'in_progress'].includes(b.status));

  const table = dataTable({
    rows: [], pageSize: 30, onRow: (b) => go(`/bugs/${b.id}`), empty: 'No bugs match these filters.',
    columns: [
      { key: 'priority', label: 'Priority', render: (b) => priorityPill(b.priority), sort: (b) => b.priority + String(9999 - b.impact).padStart(4, '0') },
      { key: 'title', label: 'Bug', render: (b) => h('div.stack', { style: { gap: '2px' } }, h('b', b.title),
        h('span.xs.muted', `#${b.id} reported by ${b.reporter} via ${b.channel} on v${b.appVersion}`)) },
      { key: 'status', label: 'Status', render: (b) => h('div.stack', { style: { gap: '4px', alignItems: 'flex-start' } }, statusPill(b.status), b.needsVerification ? h('span.xs', { style: { color: 'var(--warn)' } }, 'ready to verify') : null) },
      { key: 'severity', label: 'Severity' },
      { key: 'impact', label: 'Flows affected', num: true },
      { key: 'assignee', label: 'Assignee', render: (b) => b.assignee ?? h('span.muted', 'nobody') },
      { key: 'updatedAt', label: 'Updated', render: (b) => h('span.small.muted', ago(b.updatedAt)) },
    ],
  });

  function apply() {
    const st = STATUS_FOR[f.view]?.split(',').filter(Boolean) ?? [];
    const q = f.q.trim().toLowerCase();
    table.setRows(all.filter((b) => (!st.length || st.includes(b.status)) && (!f.priority || b.priority === f.priority)
      && (!f.version || b.appVersion === f.version || b.fixedInVersion === f.version) && (!q || b.title.toLowerCase().includes(q) || String(b.id) === q)));
    setQuery({ view: f.view === 'open' ? null : f.view, priority: f.priority || null, version: f.version || null, q: f.q || null });
  }

  const seg = h('div.seg', { role: 'group', 'aria-label': 'Status' }, VIEWS.map(([id, label]) =>
    h('button', { 'aria-pressed': String(f.view === id), on: { click: (e) => { f.view = id; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); apply(); } } }, label)));

  main.append(
    pageHead('Bugs', `Running v${state.version}. Report Flow-Mapper problems here, through the API or from an agent over MCP.`,
      h('button.btn.primary', { type: 'button', on: { click: (e) => openBugDialog(e.currentTarget) } }, icon('plus'), 'Report a bug')),
    h('div.content', h('div.page-grid',
      h('div.figures',
        fig(open.length, 'Open'), fig(open.filter((b) => b.priority === 'P0').length, 'P0 open', open.some((b) => b.priority === 'P0')),
        fig(open.filter((b) => b.priority === 'P1').length, 'P1 open'), fig(all.filter((b) => b.needsVerification).length, 'Ready to verify'),
        fig(open.filter((b) => !b.assignee).length, 'Unassigned')),
      h('div.box',
        h('div.box-head', { style: { flexWrap: 'wrap' } }, seg,
          h('select.select', { 'aria-label': 'Priority', on: { change: (e) => { f.priority = e.target.value; apply(); } } },
            h('option', { value: '' }, 'Any priority'), ['P0', 'P1', 'P2', 'P3'].map((p) => h('option', { value: p, selected: p === f.priority }, p))),
          h('select.select', { 'aria-label': 'Version', on: { change: (e) => { f.version = e.target.value; apply(); } } },
            h('option', { value: '' }, 'Any version'), versions.map((v) => h('option', { value: v, selected: v === f.version }, `v${v}`))),
          h('span.spacer'),
          h('div.search', icon('search'), h('input.input', { type: 'search', placeholder: 'Search bugs', value: f.q, 'aria-label': 'Search bugs',
            on: { input: debounce((e) => { f.q = e.target.value; apply(); }) } }))),
        table.el))));
  apply();
}

const fig = (n, label, bad = false) => h('div.figure', { class: bad ? 'bad' : '' }, h('b', String(n)), h('span', label));
