// Flow tabs, pure: tab keys (stable, URL-safe), URL encode/decode, open/close/reopen order, "distinct" selection and
// the keyboard map. No DOM. A state is { keys: [...], active: key|null, closed: [{ key, index }] } and is never mutated.
//
// Keys:  entry  `service/ingress`  (+ `~event`) (+ `!intra`)   fn  `fn:service/function` (+ `~event`) (+ `!full`)
//        sub    `queue/handler@origin`               full  `full:service/ingress` (+ `@origin`)
// `origin` is the key of the tab the flow was opened from; it may itself contain `@` (the first `@` splits).

const esc = (s) => String(s).replace(/[%,@~/!\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
const unesc = (s) => decodeURIComponent(s);
const CLOSED_CAP = 20;

// The scope is part of an entry or fn key only when it is not the default (an ingress starts "full", a function "intra").
export const entryKey = (service, ingress, event, scope) => `${esc(service)}/${esc(ingress)}${event ? `~${esc(event)}` : ''}${scope === 'intra' ? '!intra' : ''}`;
export const fnKey = (service, fn, event, scope) => `fn:${esc(service)}/${esc(fn)}${event ? `~${esc(event)}` : ''}${scope === 'full' ? '!full' : ''}`;
export const fullKey = (service, ingress, origin) => `full:${esc(service)}/${esc(ingress)}${origin ? `@${origin}` : ''}`;
/** A delivery (queue + handler) opened from the tab `origin`. */
export const subKey = (row, origin) => `${esc(row.queue)}/${esc(row.handler)}@${origin}`;

/** key -> { key, kind: 'entry'|'fn'|'full'|'sub', service?, ingress?, fn?, event?, queue?, handler?, origin? } | null (not a key) */
export function parseKey(key) {
  try {
    if (typeof key !== 'string' || !key || /[\s,]/.test(key)) return null;
    const at = key.indexOf('@');
    const head = at < 0 ? key : key.slice(0, at), origin = at < 0 ? null : key.slice(at + 1);
    if (at >= 0 && !origin) return null;
    const sc = head.match(/^(.*?)(?:!(intra|full))?$/s), explicit = sc[2] ?? null;
    const [main, ev] = sc[1].split('~');
    const [a, b, ...rest] = main.split('/');
    if (rest.length || !a || !b) return null;
    const event = ev ? unesc(ev) : null;
    if (a.startsWith('full:')) return { key, kind: 'full', service: unesc(a.slice(5)), ingress: unesc(b), origin };
    if (origin) return /:/.test(a) ? { key, kind: 'sub', queue: unesc(a), handler: unesc(b), origin } : null;
    if (a.startsWith('fn:')) return { key, kind: 'fn', service: unesc(a.slice(3)), fn: unesc(b), event, scope: explicit ?? 'intra' };
    return /^[^:]+$/.test(a) ? { key, kind: 'entry', service: unesc(a), ingress: unesc(b), event, scope: explicit ?? 'full' } : null;
  } catch { return null; }
}
/** The same entry or fn tab at another scope (other kinds have none). */
export function withScope(key, scope) {
  const p = parseKey(key);
  return p?.kind === 'entry' ? entryKey(p.service, p.ingress, p.event, scope) : p?.kind === 'fn' ? fnKey(p.service, p.fn, p.event, scope) : key;
}
/** The flow a tab's descriptions belong to: { service, ingress } of its entry point (a sub-flow tab: of the flow it came from), null for a function tab. */
export function flowRoot(key) {
  const p = parseKey(key);
  if (!p) return null;
  if (p.kind === 'sub') return flowRoot(p.origin);
  return p.ingress ? { service: p.service, ingress: p.ingress } : null;
}
export const originOf =(key) => { const at = key.indexOf('@'); return at < 0 ? null : key.slice(at + 1); };
/** Is `key` opened (directly or through other tabs) from `origin`? */
export const descends = (key, origin) => { for (let o = originOf(key); o; o = originOf(o)) if (o === origin) return true; return false; };

// ---- URL ----
/** query (URLSearchParams) -> state. `tabs=` wins; old `service=&ingress=` (or `fn=`, `event=`) links give one tab. */
export function decodeUrl(query) {
  let keys = (query.get('tabs') ?? '').split(',').filter((k) => parseKey(k));
  if (!query.has('tabs')) {
    const service = query.get('service'), ingress = query.get('ingress'), fn = query.get('fn'), event = query.get('event');
    const scope = query.get('scope');
    if (service && ingress) keys = [entryKey(service, ingress, event, scope)];
    else if (service && fn) keys = [fnKey(service, fn, event, scope)];
  }
  keys = [...new Set(keys)];
  const tab = query.get('tab');
  return { keys, active: keys.includes(tab) ? tab : keys[keys.length - 1] ?? null, closed: [] };
}
/** state -> the query patch to set; the old single-flow params are cleared. */
export const encodeUrl = (s) => ({ tabs: s.keys.length ? s.keys.join(',') : null, tab: s.keys.length > 1 ? s.active : null, ingress: null, fn: null, event: null, scope: null });

// ---- order ----
export const emptyState = () => ({ keys: [], active: null, closed: [] });
export const activate = (s, key) => (s.keys.includes(key) ? { ...s, active: key } : s);

/** Open a tab (or just activate it when already open). A sub-flow lands after the last tab opened from its origin; an origin brought back lands before them. */
export function openTab(s, key, { activate: act = true } = {}) {
  if (s.keys.includes(key)) return act ? { ...s, active: key } : s;
  const keys = [...s.keys], origin = originOf(key);
  let at = keys.length;
  if (origin) {
    const last = keys.reduce((n, k, i) => (k === origin || descends(k, origin) ? i : n), -1);
    if (last >= 0) at = last + 1;
  } else {
    const first = keys.findIndex((k) => descends(k, key)); // an origin brought back goes before the tabs opened from it
    if (first >= 0) at = first;
  }
  keys.splice(at, 0, key);
  return { keys, active: act ? key : s.active ?? key, closed: s.closed.filter((c) => c.key !== key) };
}
/** A tab changes key (its scope changed): same place, same active state. */
export const rekey = (s, from, to) => { const sw = (k) => (k === from ? to : k); return s.keys.includes(from) && !s.keys.includes(to) ? { keys: s.keys.map(sw), active: sw(s.active), closed: s.closed } : s; };
/** Close a tab. When it was the active one, the tab to its left comes up (or its origin when that is open). */
export function closeTab(s, key) {
  const index = s.keys.indexOf(key);
  if (index < 0) return s;
  const keys = s.keys.filter((k) => k !== key);
  let active = s.active;
  if (active === key) { const o = originOf(key); active = o && keys.includes(o) ? o : keys[Math.max(0, index - 1)] ?? null; }
  return { keys, active, closed: [{ key, index }, ...s.closed.filter((c) => c.key !== key)].slice(0, CLOSED_CAP) };
}
export const closeOthers = (s, key) => s.keys.filter((k) => k !== key).reduce(closeTab, activate(s, key));
export const closeAll = (s) => s.keys.reduce(closeTab, s);
/** Alt+Shift+T: bring back the last closed tab where it was. */
export function reopenTab(s) {
  const [last, ...closed] = s.closed;
  if (!last) return s;
  if (s.keys.includes(last.key)) return { ...s, closed };
  const keys = [...s.keys];
  keys.splice(Math.min(last.index, keys.length), 0, last.key);
  return { keys, active: last.key, closed };
}
/** [ and ]: previous / next tab, wrapping. */
export function step(s, delta) {
  if (!s.keys.length) return s;
  const i = s.keys.indexOf(s.active);
  return { ...s, active: s.keys[(i + delta + s.keys.length) % s.keys.length] };
}
/** 1 to 9: tab N (9 is the last tab when there are more, as in browsers). */
export const nth = (s, n) => (!s.keys.length ? s : { ...s, active: s.keys[n === 9 ? s.keys.length - 1 : Math.min(n - 1, s.keys.length - 1)] });

// ---- sub-flows ----
/** The row of an async tree a sub-flow key points at: a fresh (not "seen") row of that queue and handler. */
export const findRow = (rows, queue, handler) => rows.find((r) => r.queue === queue && r.handler === handler && !r.seenIn && !r.noHandler && r.ingress)
  ?? rows.find((r) => r.queue === queue && r.handler === handler && r.ingress) ?? null;
/** "Open all distinct": one row per distinct consumer (queue + handler), rows that start a flow only. */
export function distinctRows(rows) {
  const seen = new Set();
  return rows.filter((r) => { if (r.seenIn || r.noHandler || !r.ingress) return false; const k = `${r.queue}/${r.handler}`; return seen.has(k) ? false : (seen.add(k), true); });
}
/** The groups and flat rows of the flows a row starts: what a sub-flow tab lists under its diagram. */
export function subTree(row) {
  const rows = [], walk = (gs) => gs.forEach((g) => g.rows.forEach((r) => { rows.push(r); walk(r.groups); }));
  walk(row.groups);
  return { groups: row.groups, rows };
}
/** The group (publish) a row sits in, anywhere in a tree. */
export function groupOfRow(tree, row) {
  const find = (gs) => { for (const g of gs) { if (g.rows.includes(row)) return g; for (const r of g.rows) { const f = find(r.groups); if (f) return f; } } return null; };
  return find(tree.groups);
}

// ---- keyboard ----
/** A keydown -> { type: 'prev'|'next'|'jump'|'close'|'reopen', n? } | null. Never Escape; never inside a form field. */
export function keyAction(e) {
  const t = e.target;
  if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return null;
  if (e.ctrlKey || e.metaKey) return null;
  if (e.altKey) {
    if (e.code === 'KeyW' && !e.shiftKey) return { type: 'close' };
    if (e.code === 'KeyT' && e.shiftKey) return { type: 'reopen' };
    return null;
  }
  if (e.shiftKey) return null;
  if (e.key === '[') return { type: 'prev' };
  if (e.key === ']') return { type: 'next' };
  if (/^[1-9]$/.test(e.key)) return { type: 'jump', n: Number(e.key) };
  return null;
}
