// Preview backend, design environments: marks, drafts and draft reads, computed in the browser with the same core/ the server uses
// (core/diff, core/draft-ops, core/item-rows). Drafts and their ops live in memory; Apply needs the server and is refused.
// data (see scripts/build-preview.ts): rows[env] (the environment's item rows), baselines[env], sources[env] = {rows, vanished} (the source now),
// drafts[env] = open drafts with their ops, envMeta.

import { buildIndex } from '../core/graph-index.js';
import { diffEnv } from '../core/diff/index.js';
import { calleeIndex } from '../core/diff/callee.js';
import { rawHash } from '../core/diff/normalise.js';
import { draftChanges, netOps, opRow, overlayRows, validateOpShape } from '../core/draft-ops.js';
import { rowsToExtras, rowsToModel, rowId } from '../core/item-rows.js';

const fail = (message, status = 409) => { const e = new Error(message); e.status = status; throw e; };
const now = () => new Date().toISOString();

export function createDesign(data, baseGraph) {
  const drafts = structuredClone(data.drafts ?? {}), views = new Map(), memo = new Map();
  let reading = { env: null, draft: null };
  const meta = (env) => (data.envMeta ?? []).find((m) => m.name === env);
  const isDesign = (env) => meta(env)?.kind === 'design';
  const list = (env) => (drafts[env] ??= []);
  const find = (env, slug, any = false) => {
    const d = list(env).find((x) => x.slug === slug) ?? fail(`draft '${slug}' in environment '${env}' not found`, 404);
    return d.status === 'open' || any ? d : fail(`draft '${slug}' is ${d.status}: it takes no more changes`);
  };
  const rowsOf = (env) => data.rows?.[env] ?? [];
  const bump = (env) => { for (const k of [...views.keys(), ...memo.keys()]) if (k.startsWith(`${env}|`)) { views.delete(k); memo.delete(k); } };
  const overlay = (env, d) => overlayRows(rowsOf(env), netOps(d.ops));

  /** The environment as the open draft would leave it: graph + extras (DTOs, event DTOs, schemas). Cached until the draft changes. */
  function view(env) {
    const slug = reading.env === env ? reading.draft : null, d = slug && list(env).find((x) => x.slug === slug && x.status === 'open');
    if (!d) return null;
    const key = `${env}|${slug}`;
    if (!views.has(key)) { const rows = overlay(env, d); views.set(key, { g: buildIndex(rowsToModel(env, rows)), x: rowsToExtras(rows) }); }
    return views.get(key);
  }

  const info = (env, d) => {
    const ch = draftChanges(rowsOf(env), netOps(d.ops), d.ops);
    return { id: d.id, slug: d.slug, name: d.name, status: d.status, createdBy: d.createdBy, createdAt: d.createdAt, updatedAt: d.updatedAt, closedAt: d.closedAt ?? null,
      ops: d.ops.length, authors: [...new Set(d.ops.map((o) => o.author))], counts: d.status === 'open' ? ch.counts : { added: 0, removed: 0, changed: 0 } };
  };

  function marks(env, against) {
    if (!isDesign(env)) return diffEnv([], [], { against: 'baseline', source: null, baselineAt: null });
    const slug = reading.env === env ? reading.draft : null, d = slug ? find(env, slug) : null;
    const key = `${env}|${slug ?? ''}|${against}|${d?.ops.length ?? 0}`;
    if (memo.has(key)) return memo.get(key);
    const m = meta(env), cur = d ? overlay(env, d) : rowsOf(env), src = data.sources?.[env];
    if (against === 'source' && (!src || !(data.models ?? {})[m.source])) fail(`the source environment '${m.source}' of '${env}' no longer exists: compare against the baseline instead`);
    const out = diffEnv(against === 'source' ? src.rows : data.baselines[env], cur,
      { against, draft: slug, source: m.source, baselineAt: m.copiedAt, calleeOf: calleeIndex(cur), ...(against === 'source' ? { vanished: new Set(src.vanished) } : {}) });
    memo.set(key, out);
    return out;
  }

  const api = {
    marks: async (env, against) => marks(env, against === 'source' ? 'source' : 'baseline'),
    drafts: async (env) => { if (!isDesign(env)) fail(`environment '${env}' is sealed: it has no drafts`); return list(env).filter((d) => d.status === 'open').map((d) => info(env, d)); },
    createDraft: async (env, name, createdBy = 'anonymous') => {
      if (!isDesign(env)) fail(`environment '${env}' is sealed: it has no drafts`);
      if (!String(name ?? '').trim()) fail('name is required', 422);
      const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'draft';
      let slug = base;
      for (let i = 2; list(env).some((d) => d.slug === slug); i++) slug = `${base}-${i}`;
      const d = { id: Math.max(0, ...Object.values(drafts).flat().map((x) => x.id)) + 1, slug, name: String(name).trim(), status: 'open', createdBy, createdAt: now(), updatedAt: now(), ops: [] };
      list(env).push(d);
      return info(env, d);
    },
    renameDraft: async (env, slug, name) => { const d = find(env, slug); d.name = String(name ?? '').trim() || d.name; return info(env, d); },
    draftChanges: async (env, slug) => { const d = find(env, slug), ch = draftChanges(rowsOf(env), netOps(d.ops), d.ops); return ch; },
    editDraft: async (env, slug, ops, author = 'anonymous') => {
      const d = find(env, slug), env0 = new Map(rowsOf(env).map((r) => [rowId(r), r]));
      if (!Array.isArray(ops) || !ops.length) fail('ops must be a non-empty list of {op, anchor, service?, data?}', 422);
      const next = ops.map((i, n) => {
        const errs = validateOpShape(i);
        if (errs.length) fail(`op ${n}: ${errs[0]}`, 422);
        const r = opRow(i), e = env0.get(rowId(r));
        return { ...i, ...r, seq: Math.max(0, ...d.ops.map((o) => o.seq)) + n + 1, baseHash: e ? rawHash(e.data, r.list) : null, author, byAi: false, at: now() };
      });
      d.ops.push(...next); d.updatedAt = now(); bump(env);
      return { added: next.length, ops: d.ops.length };
    },
    undoDraft: async (env, slug) => { const d = find(env, slug); d.ops.pop(); bump(env); return { ops: d.ops.length }; },
    revertDraftItem: async (env, slug, anchor) => { const d = find(env, slug); d.ops = d.ops.filter((o) => o.anchor !== anchor); bump(env); return { ops: d.ops.length }; },
    discardDraft: async (env, slug) => { const d = find(env, slug); d.status = 'discarded'; d.closedAt = now(); bump(env); return { discarded: slug }; },
    applyDraft: async () => fail('Apply is not available in the preview: it needs the server.'),
  };

  return {
    api,
    /** Which environment and draft the next reads are about (api.js sets it before every call, like `?draft=`). */
    readAs: (env, draft) => { reading = { env, draft }; },
    g: (env) => view(env)?.g ?? baseGraph(env),
    dtosOf: (env) => view(env)?.x.dtos ?? data.dtos?.[env] ?? [],
    eventDtosOf: (env) => view(env)?.x.eventDtos ?? data.eventDtos?.[env] ?? [],
    schemasOf: (env) => view(env)?.x.schemas ?? data.schemas?.[env] ?? [],
  };
}
