// Preview backend, action items under a flow (0.29.0): the same rules as server/store/action-items.ts, in memory, with the same core/ modules
// (the field rules, the event rule). The bundled rows come from the build (`data.actionItems[env] = {items, events}`); what the viewer does is
// lost on reload. Numbers are never reused within a session either (`used` remembers the highest number per anchor).

import { trace } from '../core/trace.js';
import { HASH_TRACE, isStepKey, hasStep } from '../core/description.js';
import { parseFlowAnchor, MAX_AUTHOR, cleanName } from '../core/comments.js';
import { checkFields, eventFor, isOpen } from '../core/action-items.js';

export function createActionItems(data, g) {
  const fail = (message, status, code = 'VALIDATION') => { const e = new Error(message); e.status = status; e.code = code; throw e; };
  const store = (env) => ((data.actionItems ??= {})[env] ??= { items: [], events: [] });
  const used = new Map();
  const nextNumber = (env, anchor) => {
    const k = `${env}|${anchor}`, top = Math.max(used.get(k) ?? 0, ...store(env).items.filter((i) => i.anchor === anchor).map((i) => i.number));
    used.set(k, top + 1);
    return top + 1;
  };
  const actor = (a) => { const s = typeof a === 'string' ? cleanName(a) : ''; if (!s) fail('actor is required', 400); if (s.length > MAX_AUTHOR) fail(`actor is longer than ${MAX_AUTHOR} characters`, 400); return s; };
  const fields = (i, partial) => { const r = checkFields(i, partial, cleanName, MAX_AUTHOR); if (r.error) fail(r.error, 400); return r.value; };
  const flow = (anchor) => parseFlowAnchor(anchor) ?? fail("anchor must be 'flow:<service>/<ingress>'", 400);
  const stepOf = (env, f, step) => {
    if (step == null) return null;
    const t = trace(g(env), { service: f.service, ingress: f.ingress }, HASH_TRACE) ?? fail(`flow ${f.service} / ${f.ingress} not found`, 404, 'NOT_FOUND');
    if (!isStepKey(step) || !hasStep(t, step)) fail(`step '${step}' is not in the flow`, 400);
    return step;
  };
  const find = (env, id) => store(env).items.find((x) => x.id === Number(id)) ?? fail(`action item ${id} not found`, 404, 'NOT_FOUND');
  const note = (env, item, kind, by, at) => store(env).events.push({ id: Math.max(0, ...store(env).events.map((e) => e.id)) + 1, itemId: item.id, number: item.number, kind, actor: by, at, commentId: item.commentId });
  return {
    actionItems: async (env, anchor) => {
      flow(anchor);
      const items = store(env).items.filter((i) => i.anchor === anchor).sort((a, b) => a.number - b.number);
      return structuredClone({ items, events: store(env).events.filter((e) => items.some((i) => i.id === e.itemId)), next: Math.max(used.get(`${env}|${anchor}`) ?? 0, 0, ...items.map((i) => i.number)) + 1 });
    },
    actionCounts: async (env) => { const o = {}; for (const i of store(env).items) if (isOpen(i.status)) o[i.anchor] = (o[i.anchor] ?? 0) + 1; return o; },
    addActionItem: async (env, i) => {
      const f = flow(i?.anchor), by = actor(i.actor), v = fields(i, false);
      if (!trace(g(env), { service: f.service, ingress: f.ingress }, HASH_TRACE)) fail(`flow ${f.service} / ${f.ingress} not found`, 404, 'NOT_FOUND');
      const step = stepOf(env, f, i.step), status = v.status ?? 'open', now = new Date().toISOString();
      const row = { id: Math.max(0, ...store(env).items.map((x) => x.id)) + 1, anchor: i.anchor, number: nextNumber(env, i.anchor), owner: v.owner, description: v.description, status, due: v.due ?? null, step,
        commentId: i.commentId ?? null, source: 'human', createdBy: by, updatedBy: by, createdAt: now, updatedAt: now, closedAt: isOpen(status) ? null : now };
      store(env).items.push(row); note(env, row, 'created', by, now);
      return structuredClone(row);
    },
    editActionItem: async (env, id, p) => {
      const r = find(env, id), by = actor(p?.actor), v = fields(p, true), now = new Date().toISOString();
      const step = p.step === undefined ? r.step : stepOf(env, flow(r.anchor), p.step), status = v.status ?? r.status, kind = eventFor(r.status, status);
      Object.assign(r, { owner: v.owner ?? r.owner, description: v.description ?? r.description, status, due: v.due === undefined ? r.due : v.due, step, updatedBy: by, updatedAt: now, closedAt: kind === 'reopened' ? null : kind ? now : r.closedAt });
      if (kind) note(env, r, kind, by, now);
      return structuredClone(r);
    },
    deleteActionItem: async (env, id, a) => {
      const r = find(env, id);
      if (actor(a) !== r.createdBy) fail('only the creator can delete an action item', 403, 'NOT_CREATOR');
      const s = store(env); s.items = s.items.filter((x) => x !== r); s.events = s.events.filter((e) => e.itemId !== r.id);
      return { deleted: r.id };
    },
  };
}
