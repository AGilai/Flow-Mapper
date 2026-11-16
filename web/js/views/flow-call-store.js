// The call notes of an environment on the page (frame 28g): one read of every call note (`/notes/calls`), kept per env and shared by every tab, so the caption bar,
// its hover preview and the diagram's markers agree. A call is named by what its step shows (core/call-notes.ts): `from`, `to`, and the label. Saving writes a new
// version (the Notes storage keeps them all) and tells the watchers; the list is read again when the window gets focus (the UI has no push channel).

import { api } from '../api.js';
import { callAnchor, parseCall, serializeCall, hasCall } from '../../core/call-notes.js';
import { ensureUser } from '../users/signin.js';

const stores = new Map();
/** The call a step stands for: the names its arrow shows and its label. */
export const callOf = (st) => { const op = typeof st?.label === 'string' ? st.label.trim() : ''; return st?.from && st?.to && op ? { from: String(st.from), to: String(st.to), op } : null; }; // null: a step with no name to keep a note under

/** callStore(env) -> { of(call) -> { version, note } | null, loaded(), watch(fn) -> stop, refresh(), save(call, fields) -> Promise } */
export function callStore(env) {
  if (stores.has(env)) return stores.get(env);
  const rows = new Map(), subs = new Set();
  let loaded = false;
  const tell = () => subs.forEach((f) => f());
  async function refresh() {
    try {
      const all = await api.callNotes(env);
      rows.clear();
      for (const [a, r] of Object.entries(all ?? {})) { const note = parseCall(r.body); if (hasCall(note)) rows.set(a, { version: r.version, note }); }
      loaded = true; tell();
    } catch { /* the bar still shows the step line */ }
  }
  const s = {
    of: (call) => (call ? rows.get(callAnchor(call.from, call.to, call.op)) ?? null : null),
    loaded: () => loaded,
    watch: (f) => { subs.add(f); return () => subs.delete(f); },
    refresh,
    async save(call, fields) {
      const anchor = callAnchor(call.from, call.to, call.op), body = serializeCall(fields);
      const user = await ensureUser('Sign in to save call notes. There are no passwords yet: picking a user only labels what you write.');
      const d = await api.saveNotes(env, { anchor, body, baseVersion: rows.get(anchor)?.version ?? 0, author: user.name }).catch((e) => {
        if (e.code === 'STALE_NOTES') return api.saveNotes(env, { anchor, body, baseVersion: e.details?.current?.version ?? null, author: user.name }); // a call note is short: what the viewer wrote wins, the old text stays in History
        throw e;
      });
      const note = parseCall(d.body);
      if (hasCall(note)) rows.set(anchor, { version: d.version, note }); else rows.delete(anchor);
      tell(); return d;
    },
  };
  stores.set(env, s); refresh();
  addEventListener('focus', () => { if (document.visibilityState !== 'hidden') refresh(); });
  return s;
}
