// What the entry-point list filters by, pure (0.26.0): the text box, "Changed only" (#61), and the two checkbox groups Subsystem and Component.
// The URL keeps `subsystems=a,b`, `components=x,y` and `changed=1|all`; a parameter is left out when it would select everything, so links stay short.
// A selection is a Set, or null for "all". Components with no `groupPath` are the subsystem "(none)" (key '').

export const NONE = '';
export const NONE_LABEL = '(none)';
export const topOf = (groupPath) => String(groupPath ?? '').split('/')[0];

/** Selection from a URL parameter: null (absent: all) or a Set; `-` is the "(none)" subsystem alone. */
export function parseSel(param) {
  if (param == null || param === '') return null;
  if (param === '-none-') return new Set();
  return new Set(String(param).split(',').map((x) => (x === '-' ? NONE : x)).filter((x, i, a) => a.indexOf(x) === i));
}
/** The parameter value for a selection of `all` options: '' when everything (or nothing is known) is selected. */
export function encodeSel(sel, all) {
  if (!sel || all.every((k) => sel.has(k))) return null;
  return [...sel].map((x) => (x === NONE ? '-' : x)).join(',') || '-none-';
}

/** The subsystem rows: [{ key, label, count }] in the environment's order, then others by name; `count` = entry points. */
export function subsystemRows(points, groupOf, groups = []) {
  const counts = new Map();
  for (const p of points) { const k = topOf(groupOf.get(p.service)); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const order = [...new Set(groups.map((g) => topOf(g.key)))], label = (k) => groups.find((g) => g.key === k)?.label ?? (k === NONE ? NONE_LABEL : k);
  const keys = [...counts.keys()].sort((a, b) => (a === NONE) - (b === NONE) || (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
  return keys.map((key) => ({ key, label: label(key), count: counts.get(key) }));
}

/** The component rows of the selected subsystems: [{ name, count }] by name. */
export function componentRows(points, groupOf, subs) {
  const counts = new Map();
  for (const p of points) if (!subs || subs.has(topOf(groupOf.get(p.service)))) counts.set(p.service, (counts.get(p.service) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

/** "All", "platform, network" (up to 2) or "3 of 5". */
export function summaryText(sel, rows) {
  const keys = rows.map((r) => r.key ?? r.name);
  if (!sel || keys.every((k) => sel.has(k))) return 'All';
  const on = keys.filter((k) => sel.has(k));
  if (!on.length) return 'None';
  return on.length <= 2 ? on.map((k) => rows.find((r) => (r.key ?? r.name) === k)?.label ?? k).join(', ') : `${on.length} of ${keys.length}`;
}

/** "platform · 3 of 9": what the collapsed list strip says about the filters (nothing when nothing is applied). */
export function filterSummary({ subs, comps, subRows, compRows, changed, q }) {
  const parts = [subs ? `subsystems ${summaryText(subs, subRows)}` : null, comps ? `components ${summaryText(comps, compRows)}` : null, changed ? 'changed' : null, q ? `"${q}"` : null].filter(Boolean);
  return parts.join(' · ');
}

/** The mark of an entry point (design marks), or null. */
export const markOfPoint = (marks, p) => marks?.markOf?.(`ing:${p.service}/${p.id}`) ?? null;

/** The points that pass every filter. `changed`: null | '1' (New or Changed) | 'all' (also Removed: those are ghosts, listed by `removedPoints`). */
export function filterPoints(points, { q = '', subs = null, comps = null, changed = null, marks = null, groupOf = new Map() } = {}) {
  const t = q.trim().toLowerCase();
  return points.filter((p) => {
    if (t && !(p.bindKey.toLowerCase().includes(t) || p.service.includes(t) || p.handler.toLowerCase().includes(t) || (p.name ?? '').toLowerCase().includes(t) || (p.summary ?? '').toLowerCase().includes(t))) return false;
    if (subs && !subs.has(topOf(groupOf.get(p.service)))) return false;
    if (comps && !comps.has(p.service)) return false;
    if (changed) { const m = markOfPoint(marks, p)?.mark; if (m !== 'new' && m !== 'changed') return false; }
    return true;
  });
}

/** The removed endpoints (ghosts of the marks) in the selected components, for "Changed only, and removed". */
export function removedPoints(marks, { subs = null, comps = null, groupOf = new Map(), q = '' } = {}) {
  const t = q.trim().toLowerCase();
  return (marks?.ghostsUnder?.('ing:') ?? []).filter((g) => g.service && (!subs || subs.has(topOf(groupOf.get(g.service)))) && (!comps || comps.has(g.service)) && (!t || `${g.service} ${g.label}`.toLowerCase().includes(t)));
}
