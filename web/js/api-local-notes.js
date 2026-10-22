// Preview backend, a flow's Notes (0.34.0): the same rules as server/store/notes.ts, in memory, with the same core/ modules (the sanitizer).
// The bundled rows come from the build (`data.notes[env]`, every version); what the viewer saves is lost on reload.

import { trace } from '../core/trace.js';
import { HASH_TRACE } from '../core/description.js';
import { parseFlowAnchor, cleanName, MAX_AUTHOR } from '../core/comments.js';
import { sanitize, notesTooLong, plainText } from '../core/rich-text.js';

export function createNotes(data, g, U) {
  const fail = (message, status, code, details) => { const e = new Error(message); e.status = status; e.code = code; e.details = details; throw e; };
  const rows = (env) => ((data.notes ??= {})[env] ??= []);
  const mine = (env, anchor) => rows(env).filter((r) => r.anchor === anchor).sort((a, b) => a.version - b.version);
  const anchorOf = (a) => parseFlowAnchor(a) ? a : fail("anchor must be 'flow:<service>/<ingress>'", 400);
  const doc = (r) => ({ anchor: r.anchor, version: r.version, body: sanitize(r.body, { notes: true }), author: r.author, authorId: r.authorId ?? null, createdAt: r.createdAt, restoredFrom: r.restoredFrom ?? null });
  const none = (anchor) => ({ anchor, version: 0, body: '', author: null, authorId: null, createdAt: null, restoredFrom: null });
  const write = (env, i, restoredFrom = null) => {
    const anchor = anchorOf(i?.anchor), f = parseFlowAnchor(anchor);
    if (typeof i.body !== 'string') fail('body is required', 400);
    const body = sanitize(i.body, { notes: true }), long = notesTooLong(body);
    if (long) fail(long, 422);
    if (!trace(g(env), { service: f.service, ingress: f.ingress }, HASH_TRACE)) fail(`flow ${f.service} / ${f.ingress} not found`, 404);
    const author = typeof i.author === 'string' ? cleanName(i.author) : '';
    if (!author) fail('author is required', 400);
    if (author.length > MAX_AUTHOR) fail(`author is longer than ${MAX_AUTHOR} characters`, 400);
    const all = mine(env, anchor), cur = all.at(-1), have = cur?.version ?? 0;
    if (i.baseVersion != null && Number(i.baseVersion) !== have) fail(`the notes are at version ${have}, not ${i.baseVersion}: someone saved since you opened them`, 409, 'STALE_NOTES', { current: cur ? doc(cur) : none(anchor) });
    if (cur && restoredFrom === null && cur.body === body) return { ...doc(cur), unchanged: true };
    const r = { anchor, version: have + 1, body, author, authorId: U.userFor(null, author).id, restoredFrom, createdAt: new Date().toISOString() };
    rows(env).push(r);
    return doc(r);
  };
  return {
    notes: async (env, anchor, version) => {
      const all = mine(env, anchorOf(anchor));
      if (version == null) return all.length ? doc(all.at(-1)) : none(anchor);
      const r = all.find((x) => x.version === Number(version)) ?? fail(`version ${version} of the notes not found`, 404);
      return doc(r);
    },
    notesHistory: async (env, anchor) => {
      const all = mine(env, anchorOf(anchor)), latest = [...all].reverse().slice(0, 30);
      return { anchor, current: all.at(-1)?.version ?? 0, total: all.length, versions: latest.map((r) => ({ version: r.version, author: r.author, authorId: r.authorId ?? null, createdAt: r.createdAt, restoredFrom: r.restoredFrom ?? null, size: plainText(r.body).length })) };
    },
    saveNotes: async (env, i) => write(env, i),
    restoreNotes: async (env, i) => { const r = mine(env, anchorOf(i?.anchor)).find((x) => x.version === Number(i.version)) ?? fail(`version ${i?.version} of the notes not found`, 404); return write(env, { ...i, body: r.body }, r.version); },
  };
}
