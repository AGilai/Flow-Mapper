// Inventory > Drivers (#130, frame 29): which client package and version each component uses, per store type.
// URL: #/inventory?tab=drivers&store=redis&group=package|component&q=mongoose%20%3C%206&mixed=1&c=<component>.
// Everything is computed in the browser from the client rows (core/drivers.ts), so the static preview works too.

import { h, fill } from '../dom.js';
import { icon } from '../icons.js';
import { href, setQuery } from '../router.js';
import { driverEntries, baselinesOf, driverTable, unresolvedItems, entryPasses, unresolvedPasses, componentsPerKind, chooseStore } from '../../core/drivers.js';
import { parseDriverQuery, formatDriverQuery, compareVersions, parseVersion } from '../../core/versions.js';
import { verdictOf } from '../../core/driver-verdict.js';
import { typeOf, typeOrder, kindLabel } from './drivers-kinds.js';
import { storePicker, groupSwitch, queryBar, syntaxHint } from './drivers-bar.js';
import { packageTable } from './drivers-table.js';
import { componentMatrix } from './drivers-matrix.js';
import { componentDrivers } from './drivers-drawer.js';
import { emptyNone, notice } from './drivers-empty.js';
import { exportMenu } from './drivers-export.js';
import { legend, unresolvedSection, outsideLine } from '../components/drivers-parts.js';

const uniq = (a) => [...new Set(a)].sort((x, y) => x.localeCompare(y));

/** Data of the page from the API's client rows: entries (drivers with a major), baselines and unresolved items, per folded store type. */
export function driverData(rows) {
  const norm = rows.map((r) => ({ ...r, kind: typeOf(r.kind) }));
  const entries = driverEntries(norm), unresolved = unresolvedItems(norm);
  return { entries, unresolved, base: baselinesOf(entries), counts: componentsPerKind(entries, unresolved) };
}

/** `rows`: ClientRow[]; `env`, `envs`: this environment and all of them (the empty state looks for data in the others); `query`: URLSearchParams; `panel`: the page's info panel (the drawer); `onClose(fn)` registers what runs when the panel closes. Returns the element. */
export function driversView({ rows, env = '', envs = [], query, panel, onClose }) {
  const data = driverData(rows), { entries, unresolved, base, counts } = data;
  const types = typeOrder([...counts.keys()]).map((id) => ({ id, n: counts.get(id) ?? 0 }));
  const pick = chooseStore(query.get('store'), counts, types.map((t) => t.id));
  let moved = pick.from ? notice(kindLabel(pick.from), env, kindLabel(pick.store)) : null; // the URL asked for a store type without data here: say why another one opened
  const s = { store: pick.store, group: query.get('group') === 'component' ? 'component' : 'package', q: query.get('q') ?? '', mixed: query.get('mixed') === '1', c: query.get('c') ?? '' };
  const expanded = new Set();
  const el = h('div.drv', { 'data-qa': 'drivers' });
  let curInput = null;

  const url = () => setQuery({ tab: 'drivers', store: s.store, group: s.group === 'package' ? null : s.group, q: s.q || null, mixed: s.mixed ? 1 : null, c: s.c || null });
  const change = (patch) => { if (patch.store != null) moved = null; Object.assign(s, patch); url(); draw(); };
  if (pick.from) url();
  const open = (service) => change({ c: service });
  onClose(() => { if (s.c) { s.c = ''; url(); draw(); } });

  function drawer() {
    if (!s.c) return panel.close?.();
    const showInTable = (kind) => change({ store: typeOf(kind), group: 'package', q: s.c, c: '' });
    panel.open(h('div', h('div.ep-title.mono', { style: { fontWeight: 600 } }, s.c), h('a.small', { href: href(`/services/${encodeURIComponent(s.c)}`) }, 'Open component page ', icon('external'))),
      ...componentDrivers(s.c, { entries, unresolved, base, showInTable }));
  }

  function draw() {
    const pkgMode = s.group === 'package', label = kindLabel(s.store);
    const inKind = (x) => !pkgMode || x.kind === s.store;
    const ents = entries.filter(inKind), unr = unresolved.filter(inKind);
    const vocab = { packages: uniq([...ents.map((e) => e.package), ...unr.map((u) => u.package).filter(Boolean)]), components: uniq([...ents, ...unr].map((x) => x.service)) };
    const query = parseDriverQuery(s.q, vocab), f = { query, mixedOnly: s.mixed };
    const shownE = ents.filter((e) => entryPasses(e, f)), unrIn = unr.filter((u) => unresolvedPasses(u, f)), unrOut = unr.filter((u) => !unresolvedPasses(u, f));
    const vers = [...new Map(ents.filter((e) => !query.package || e.package === query.package).map((e) => [e.version, e])).values()].sort((a, b) => compareVersions(parseVersion(b.version), parseVersion(a.version)));
    const verOpts = [...uniq([...new Set(vers.map((e) => e.major))].map(String)).sort((a, b) => b - a).map((m) => [`${m}.x`, `${m}.x`]), ...vers.map((e) => [e.version, e.version])];
    const bar = queryBar({ vocab, versions: verOpts, s, on: change });
    bar.row.append(h('span.grow'), exportMenu(rows, () => ({ env, store: s.store, group: s.group, q: s.q, mixed: s.mixed })));
    const qtext = formatDriverQuery(query) || (s.mixed ? 'mixed majors' : '');
    const filtered = !!(s.q || s.mixed);
    const parts = [h('div.dv-row.top', storePicker(types, s.store, (id) => change({ store: id, group: 'package', q: '', mixed: false, c: '' }), !pkgMode), h('span.grow'), groupSwitch(s.group, (g) => change({ group: g }))), pkgMode ? moved : null];
    let body;
    if (pkgMode) {
      const table = driverTable(shownE, s.store, base);
      const none = !counts.get(s.store);
      const empty = !none && !table.packages.length && !unrIn.length;
      parts.push(empty ? null : h('p.dv-vd', none ? [h('b', `${label}: no client data yet. `), 'No harvester has reported clients for this store type in this environment.']
        : verdictOf(label, qtext, table, unrIn.length, unrOut.length).map((g) => (g.s ? h(g.s === 'b' ? 'b' : `span.${g.s}`, g.t) : g.t))), none ? null : bar.row, filtered ? syntaxHint() : null);
      body = none ? emptyNone(label, { types, env, envs, dataOf: driverData, go: (id) => change({ store: id, group: 'package', q: '', mixed: false, c: '' }) }) : !table.packages.length && !unrIn.length ? emptyQuery(label, qtext, query, ents, change) : table.packages.length ? packageTable(table, { unresolved: unr, open, expanded, onToggle: (k) => { expanded.has(k) ? expanded.delete(k) : expanded.add(k); draw(); } }) : null;
      parts.push(body, none ? null : outsideLine(unrOut, () => change({ q: '', mixed: false })), none || empty ? null : legend(), none ? null : unresolvedSection(unrIn, { open, note: unr.length ? null : 'No unresolved entries in this store type.' }), filtered ? others(s, change) : null);
    } else {
      const kinds = types.filter((t) => t.n).map((t) => t.id);
      parts.push(h('p.dv-vd', h('b', `By component: ${new Set([...shownE, ...unrIn].map((x) => x.service)).size} components use a driver in ${kinds.map(kindLabel).join(' or ')}. `), 'Each cell lists package and version per store type, with the same amber and red rule as the package table. Click a row for the full view.'),
        bar.row, filtered ? syntaxHint() : null, componentMatrix({ entries: shownE, unresolved: unrIn, base }, kinds, { open, selected: s.c }),
        h('div.s.mu', 'Only components with a client in a listed store type appear. Sorted by name.'));
    }
    const hadFocus = curInput && document.activeElement === curInput;
    curInput = bar.input;
    fill(el, parts);
    drawer();
    if (hadFocus) bar.input.focus();
  }
  draw();
  return el;
}

function emptyQuery(label, qtext, query, ents, change) {
  const pkg = query.package && ents.filter((e) => e.package === query.package);
  const vs = pkg ? [...new Map(pkg.map((e) => [e.version, e])).values()] : [];
  return h('div.dv-card', h('div.dv-empty', icon('search'), h('b', `No ${qtext || 'match'} in ${label}`),
    pkg?.length ? h('span', `${query.package} has ${vs.length === 1 ? '1 version' : `${vs.length} versions`} here: ${vs.map((e) => `${e.version} (${[...new Set(pkg.filter((x) => x.version === e.version).map((x) => x.service))].join(', ')})`).join('; ')}.`) : h('span', `Nothing in ${label} matches.`),
    h('span', pkg?.length ? [h('a', { href: '#', on: { click: (e) => { e.preventDefault(); change({ q: query.package, mixed: false }); } } }, `Show ${query.package}`), ' · '] : null,
      h('a', { href: '#', on: { click: (e) => { e.preventDefault(); change({ q: '', mixed: false }); } } }, 'Clear filters'))));
}

function others(s, change) {
  const go = (q, mixed = false) => (e) => { e.preventDefault(); change({ q, mixed }); };
  return h('div.dv-others', h('span.lbl', 'Other queries'), h('a', { href: '#', on: { click: go('redis 3') } }, 'who still uses redis v3'), h('code', 'redis 3'),
    h('a', { href: '#', on: { click: go('', true) } }, 'components on 2+ majors'),
    h('div.s.mu', 'A query is just a string in the URL: ', h('code', `#/inventory?tab=drivers&store=${s.store}${s.q ? '&q=' + encodeURIComponent(s.q) : ''}`)));
}
