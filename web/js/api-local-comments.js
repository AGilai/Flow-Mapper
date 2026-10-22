// Preview backend, comments under a flow (0.27.0): the same rules as server/store/comments.ts, in memory, with the same core/ modules
// (the sanitizer, the thread builder). The bundled rows come from the build (`data.comments[env]`); what the viewer posts is lost on reload.

import { trace } from '../core/trace.js';
import { HASH_TRACE, isStepKey, hasStep, stepKeys } from '../core/description.js';
import { buildThread, parseFlowAnchor, MAX_AUTHOR, cleanName } from '../core/comments.js';
import { sanitize, tooLong, plainText } from '../core/rich-text.js';

export function createComments(data, g, U) {
  const fail = (message, status) => { const e = new Error(message); e.status = status; throw e; };
  const rows = (env) => ((data.comments ??= {})[env] ??= []);
  const author = (a) => { const s = typeof a === 'string' ? cleanName(a) : ''; if (!s) fail('author is required', 400); if (s.length > MAX_AUTHOR) fail(`author is longer than ${MAX_AUTHOR} characters`, 400); return s; };
  const body = (b) => { if (typeof b !== 'string') fail('body is required', 400); const s = sanitize(b); if (!plainText(s)) fail('the comment is empty', 422); const l = tooLong(s); if (l) fail(l, 422); return s; };
  const mine = (env, id, a) => {
    const r = rows(env).find((x) => x.id === Number(id) && !x.deletedAt) ?? fail(`comment ${id} not found`, 404);
    if (author(a) !== r.author) fail('only the author can change a comment', 403);
    return r;
  };
  return {
    comments: async (env, anchor) => { if (!parseFlowAnchor(anchor)) fail("anchor must be 'flow:<service>/<ingress>'", 400); return buildThread(anchor, rows(env).filter((r) => r.anchor === anchor)); },
    commentCounts: async (env) => { const o = {}; for (const r of rows(env)) if (!r.deletedAt && r.parentId == null && !r.resolvedAt) o[r.anchor] = (o[r.anchor] ?? 0) + 1; return o; },
    addComment: async (env, i) => {
      const f = parseFlowAnchor(i?.anchor) ?? fail("anchor must be 'flow:<service>/<ingress>'", 400), a = author(i.author), b = body(i.body);
      const t = trace(g(env), { service: f.service, ingress: f.ingress }, HASH_TRACE) ?? fail(`flow ${f.service} / ${f.ingress} not found`, 404);
      const step = i.step ?? null;
      if (step !== null && (!isStepKey(step) || !hasStep(t, step))) fail(`step '${step}' is not in the flow`, 400);
      let steps = null; // 0.34.0: a range of 2+ steps (keys, from before to), instead of a step; top comments only
      if (i.steps != null) {
        const keys = stepKeys(t.messages), a2 = keys.indexOf(i.steps?.from), b2 = keys.indexOf(i.steps?.to);
        if (step !== null || i.parentId != null) fail('give step or steps, not both, and not on a reply', 400);
        if (a2 < 0 || b2 < 0) fail('steps must be { from, to }: two step keys of the flow', 400);
        if (a2 >= b2) fail('steps.from must come before steps.to in the flow (a range is 2 or more steps)', 400);
        steps = { from: i.steps.from, to: i.steps.to };
      }
      let parentId = null;
      if (i.parentId != null) {
        const p = rows(env).find((x) => x.id === Number(i.parentId) && x.anchor === i.anchor) ?? fail(`comment ${i.parentId} not found`, 404);
        if (p.deletedAt) fail('the comment you reply to was deleted', 422);
        parentId = p.parentId ?? p.id;
      }
      const r = { id: Math.max(0, ...rows(env).map((x) => x.id)) + 1, anchor: i.anchor, step, stepsFrom: steps?.from ?? null, stepsTo: steps?.to ?? null, parentId, author: a, authorId: U.userFor(null, a).id, body: b, createdAt: new Date().toISOString(), editedAt: null, deletedAt: null, externalId: null, externalSource: null, authorExternalId: null, resolvedAt: null, resolvedBy: null };
      rows(env).push(r);
      return structuredClone(r);
    },
    editComment: async (env, id, i) => { const r = mine(env, id, i?.author); r.body = body(i.body); r.editedAt = new Date().toISOString(); return structuredClone(r); },
    resolveComment: async (env, id, i) => { // anyone, top comments only (the server's rule); the replies follow the thread
      const r = rows(env).find((x) => x.id === Number(id) && !x.deletedAt) ?? fail(`comment ${id} not found`, 404), by = author(i?.actor);
      if (r.parentId != null) fail('a reply cannot be resolved on its own: resolve its top comment', 400);
      r.resolvedAt = i.resolved ? new Date().toISOString() : null; r.resolvedBy = i.resolved ? by : null;
      return { ...structuredClone(r), resolved: !!r.resolvedAt };
    },
    deleteComment: async (env, id, a) => { const r = mine(env, id, a); r.deletedAt = new Date().toISOString(); r.body = ''; return { deleted: r.id }; },
  };
}
