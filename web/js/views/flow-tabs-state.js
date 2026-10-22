// Flow tabs, pure: tab keys (stable, URL-safe), URL encode/decode, open/close/reopen order, "distinct" selection and
// the keyboard map. No DOM. A state is { keys: [...], active: key|null, closed: [{ key, index }] } and is never mutated.
//
// The key format (with its optional `env|` prefix) is in flow-tab-keys.js, re-exported here.

import { qual, unqual, parseKey, entryKey, fnKey, originOf, descends, envOfKey } from './flow-tab-keys.js';
export * from './flow-tab-keys.js';

const CLOSED_CAP = 20;
/** The most tabs open at once (0.33.3): every opener checks `canOpen` first and tells the viewer when it says no. Tabs of every environment count. */
export const TAB_CAP = 10;

// ---- URL ----
/** The distinct, valid keys of a link: `tabs=` wins; old `service=&ingress=` (or `fn=`, `event=`) links give one tab. Before the cap.
 *  `env`: the page's environment; keys without a prefix are qualified with it (null: left as written). */
export function urlKeys(query, env = null) {
  let keys = (query.get('tabs') ?? '').split(',').filter((k) => parseKey(k));
  if (!query.has('tabs')) {
    const service = query.get('service'), ingress = query.get('ingress'), fn = query.get('fn'), event = query.get('event');
    const scope = query.get('scope');
    if (service && ingress) keys = [entryKey(service, ingress, event, scope)];
    else if (service && fn) keys = [fnKey(service, fn, event, scope)];
  }
  return [...new Set(keys.map((k) => qual(env, k)))];
}
/** query (URLSearchParams) -> state, at most TAB_CAP tabs: the first ones in URL order, but a `tab=` past the last slot takes it, so the link still shows its flow. */
export function decodeUrl(query, env = null) {
  let keys = urlKeys(query, env);
  const t = query.get('tab'), tab = t && parseKey(t) ? qual(env, t) : t;
  if (keys.length > TAB_CAP) keys = keys.indexOf(tab) >= TAB_CAP ? [...keys.slice(0, TAB_CAP - 1), tab] : keys.slice(0, TAB_CAP);
  return { keys, active: keys.includes(tab) ? tab : keys[keys.length - 1] ?? null, closed: [] };
}
/** state -> the query patch to set; the old single-flow params are cleared. A key of the page's environment `env` is written without its prefix, any other with it. */
export const encodeUrl = (s, env = null) => ({ tabs: s.keys.length ? s.keys.map((k) => unqual(k, env)).join(',') : null, tab: s.keys.length > 1 ? unqual(s.active, env) : null, ingress: null, fn: null, event: null, scope: null });
/** How many of the tabs in a link are of environment `env` (the page's env is `pageEnv`: unprefixed keys are its): the delete dialog warns about them. */
export const tabsInEnv = (query, env, pageEnv) => decodeUrl(query, pageEnv).keys.filter((k) => envOfKey(k) === env).length;
/** The `tabs=` / `tab=` patch that keeps the same tabs when the page's environment goes from `from` to `to` (the URL reads unprefixed keys as the page's own). */
export const retarget = (query, from, to) => encodeUrl(decodeUrl(query, from), to);

// ---- order ----
export const emptyState = () => ({ keys: [], active: null, closed: [] });
export const activate = (s, key) => (s.keys.includes(key) ? { ...s, active: key } : s);

const scopeless = (k) => k.replace(/!(intra|full)$/, '');
/** The open tab that shows the same flow as `key` (exact, else the same entry or function at the other scope), or null. */
export const findOpen = (s, key) => (s.keys.includes(key) ? key : s.keys.find((k) => scopeless(k) === scopeless(key)) ?? null);
/** Can `key` get a tab: it is open already (opening switches to it) or there is a free slot. */
export const canOpen = (s, key) => s.keys.length < TAB_CAP || !!findOpen(s, key);
export const freeSlots = (s) => Math.max(0, TAB_CAP - s.keys.length);
/** "Open all distinct": of `keys`, which open (one that is open already costs no slot), how many are new tabs and how many are skipped for lack of room. */
export function fitKeys(s, keys) {
  let room = freeSlots(s);
  const take = keys.filter((k) => s.keys.includes(k) || (room > 0 && room--));
  return { take, skipped: keys.length - take.length, opened: take.filter((k) => !s.keys.includes(k)).length };
}
/** A plain click on a list row: the flow takes the active tab's place (same position; the old key goes onto the closed stack). No tabs: the first tab. Open elsewhere: switch to it. */
export function replaceActive(s, key) {
  if (!s.keys.length || !s.active) return openTab(s, key);
  const open = findOpen(s, key);
  if (open) return open === s.active ? s : { ...s, active: open };
  const index = s.keys.indexOf(s.active);
  const keys = s.keys.map((k, i) => (i === index ? key : k));
  return { keys, active: key, closed: [{ key: s.active, index }, ...s.closed.filter((c) => c.key !== key)].slice(0, CLOSED_CAP) };
}
/** The "Tab" button: a new tab, or a switch to the tab that already shows the flow. */
export const addTab = (s, key) => { const open = findOpen(s, key); return open ? activate(s, open) : openTab(s, key); };

/** Open a tab (or just activate it when already open). At the cap nothing opens: callers check `canOpen` first, to say why. A sub-flow lands after the last tab opened from its origin; an origin brought back lands before them. */
export function openTab(s, key, { activate: act = true } = {}) {
  if (s.keys.includes(key)) return act ? { ...s, active: key } : s;
  if (s.keys.length >= TAB_CAP) return s;
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
  if (s.keys.length >= TAB_CAP) return s;
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
