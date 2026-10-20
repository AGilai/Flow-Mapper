// The Keys section of the instance page. Keys are not loaded with the page (an instance can hold thousands):
// a button loads them all or one database (the db filter runs on the server). Then: segmented db control with
// counts, a search, a Problems toggle, groups by owner (No harvested writer and Shared first), rows that expand in place.

import { h, debounce, fill } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { opsText } from '../format.js';
import { serviceLink } from './inventory-links.js';
import { keyRow } from './instance-key-row.js';

const CAP = 300; // rows drawn at once
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const sumOps = (rows) => (rows.some((r) => r.opsPerHour != null) ? rows.reduce((a, r) => a + (r.opsPerHour ?? 0), 0) : null);
/** The loaded groups narrowed by the search text and the Problems toggle (db is already narrowed by the server). */
export function narrow(groups, { q, problems }) {
  const n = q.trim().toLowerCase();
  return groups.map((g) => ({ ...g, rows: g.rows.filter((r) => (!problems || r.problem) && (!n || r.keyTemplate.toLowerCase().includes(n))) })).filter((g) => g.rows.length);
}

export function keysSection(v) {
  const sum = v.keys.summary;
  const st = { db: null, q: '', problems: false, data: null, shown: CAP };
  const body = h('div'), hint = h('span.hint'), right = h('span', { style: { marginLeft: 'auto' } });
  const el = h('section.flow-section#keys', h('header', h('h2', 'Keys'), hint, right), body);
  const rowEls = new Map();

  const dbText = () => sum?.dbs.map((d) => `db${d.db} ${d.templates}`).join(', ');
  const idle = () => {
    right.replaceChildren();
    hint.textContent = sum ? `${plural(sum.templates, 'key template')} · ${dbText()} · loaded on request` : 'none reported';
    fill(body, !sum
      ? h('div.ri-lazy', h('p', 'No key templates have been reported for this instance. A harvester pushes them with ', h('code', `PUT /api/envs/${state.env}/resources/${v.key}/keys`), ' (see the harvester guide).'))
      : h('div.ri-lazy',
        h('p', 'Key templates are not loaded with the page: an instance can hold thousands. Load them all, or one database at a time, grouped by the service that writes them.'),
        h('button.btn.primary', { type: 'button', on: { click: () => load(null) } }, 'Load keys'),
        sum.dbs.length > 1 ? h('button.btn', { type: 'button', on: { click: () => load(sum.dbs[0].db) } }, `Load db${sum.dbs[0].db} only`) : null));
  };

  async function load(db, then) {
    st.db = db;
    fill(body, h('div.ri-lazy', h('p', 'Loading keys…')));
    try { st.data = await api.instanceKeys(state.env, v.key, { db }); } catch (err) { fill(body, h('div.ri-lazy', h('p', `Could not load the keys: ${err.message}`), h('button.btn', { type: 'button', on: { click: () => load(db) } }, 'Try again'))); return; }
    st.shown = CAP;
    draw();
    then?.();
  }

  const dbButton = (db, label, n) => h('button', { type: 'button', 'aria-pressed': String(st.db === db), on: { click: () => load(db) } }, label, h('small', String(n)));

  const list = h('div');
  let problemsBtn;
  function draw() {
    const d = st.data, s = d.summary;
    const inDb = st.db == null ? s.problemCount : (s.dbs.find((x) => x.db === st.db)?.problems ?? 0);
    right.replaceChildren(h('button.btn.ghost', { type: 'button', on: { click: () => load(st.db) } }, 'Reload'));
    hint.textContent = d.source === 'inline' ? 'from the top templates the harvester inlined (details.keys)' : `grouped by the service that writes them${d.version ? ` · push ${d.version}` : ''}`;
    problemsBtn = h('button', { type: 'button', 'aria-pressed': String(st.problems), on: { click: () => { st.problems = !st.problems; problemsBtn.setAttribute('aria-pressed', String(st.problems)); st.shown = CAP; drawList(); } } },
      'Problems', h('small', `${inDb} in ${st.db == null ? 'all dbs' : 'db' + st.db}`));
    fill(body,
      h('div.ri-toolbar',
        h('div.seg', { role: 'group', 'aria-label': 'Database' }, dbButton(null, 'All', s.templates), s.dbs.map((x) => dbButton(x.db, `db${x.db}`, x.templates))),
        h('input.input', { type: 'search', placeholder: 'Search key templates', value: st.q, 'aria-label': 'Search key templates', on: { input: debounce((e) => { st.q = e.target.value; st.shown = CAP; drawList(); }) } }),
        h('div.seg', { role: 'group', 'aria-label': 'Problems' }, problemsBtn)),
      h('div.ri-kgrid.ri-hd', h('span'), h('span', 'Key template'), h('span', 'DB'), h('span', 'Commands'), h('span', 'Ops/h'), h('span', 'TTL'), h('span', 'Also read by')),
      list,
      h('div.ri-legend', h('span', 'Bold commands write; the rest read'), h('span', 'An owner is the service that writes the template'), h('span', 'A shared key is one row, listed once, not under each writer')));
    drawList();
  }

  function drawList() {
    rowEls.clear();
    const groups = narrow(st.data.groups, st);
    const total = groups.reduce((a, g) => a + g.rows.length, 0);
    let budget = st.shown;
    const out = groups.map((g) => {
      const rows = g.rows.slice(0, Math.max(budget, 0));
      budget -= rows.length;
      const ops = sumOps(g.rows);
      return rows.length ? h('div.ri-group', { class: g.kind === 'owner' ? '' : 'warn' },
        h('div.ri-gh', h('span.ri-name', g.kind === 'owner' ? serviceLink(g.owner) : g.label),
          h('span.xs', g.kind === 'owner' ? `writes ${plural(g.rows.length, 'template')}${ops != null ? ` · ${opsText(ops)} ops/h` : ''}` : plural(g.rows.length, 'template'))),
        rows.map((r) => { const e = keyRow(r); rowEls.set(`${r.dbIndex}\u0000${r.keyTemplate}`, e); return e; })) : null;
    });
    fill(list, total ? out : h('p.ri-lazy', { style: { color: 'var(--muted)' } }, st.problems ? 'No problem rows here.' : 'No key template matches.'),
      total > st.shown ? h('div.ri-more', `Showing ${st.shown} of ${total} key templates. Pick a database or search to narrow the list.`,
        h('button.btn', { type: 'button', on: { click: () => { st.shown += CAP; drawList(); } } }, 'Show more')) : null);
  }

  /** Load everything (clearing the filters) if needed, then open and highlight one row. */
  async function show({ keyTemplate, dbIndex }) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!st.data || st.db != null) { st.q = ''; st.problems = false; await load(null); }
    if (st.q || st.problems) { st.q = ''; st.problems = false; draw(); }
    const row = rowEls.get(`${dbIndex}\u0000${keyTemplate}`) ?? (st.shown < 1e9 && (st.shown = 1e9, drawList(), rowEls.get(`${dbIndex}\u0000${keyTemplate}`)));
    if (!row) return;
    row.open = true;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 2500);
  }

  idle();
  return { el, show };
}
