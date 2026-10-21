// Preview backend, design environments: marks, references, drafts and draft reads, computed in the browser with the same core/ the server uses
// (core/diff, core/draft-ops, core/item-rows, core/references). Drafts and their ops live in memory; Apply needs the server and is refused.
// Imports, edit forms, calls and flow names are in api-local-edits.js.
// data (see scripts/build-preview.ts): rows[env] (item rows of every design and of every environment a design was taken from), baselines[env],
// drafts[env] = open drafts with their ops, flowTexts[env], envMeta.

import { buildIndex } from '../core/graph-index.js';
import { diffEnv } from '../core/diff/index.js';
import { calleeIndex } from '../core/diff/callee.js';
import { sourceNow } from '../core/diff/source-now.js';
import { rawHash } from '../core/diff/normalise.js';
import { applyOp, draftChanges, netOps, opRow, overlayRows, validateOpShape } from '../core/draft-ops.js';
import { designIssues } from '../core/design-rules.js';
import { importBaseline } from '../core/import-baseline.js';
import { originsOf, referencesOf } from '../core/references.js';
import { decorateDesignTrace } from '../core/flow-refs.js';
import { overlayText } from '../core/flow-text.js';
import { rowsToExtras, rowsToModel, rowId } from '../core/item-rows.js';
import { createEdits } from './api-local-edits.js';

const fail = (message, status = 409) => { const e = new Error(message); e.status = status; throw e; };
const now = () => new Date().toISOString();

export function createDesign(data, baseGraph) {
  const drafts = structuredClone(data.drafts ?? {}), views = new Map(), memo = new Map();
  const names = {}; // flow names set in the preview, by env: Map `<service>/<ingress>` -> name ('' = removed)
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
  const openDraft = (env) => { const slug = reading.env === env ? reading.draft : null; return slug ? list(env).find((x) => x.slug === slug && x.status === 'open') ?? null : null; };

  /** The environment as the open draft would leave it: graph + extras (DTOs, event DTOs, schemas). Cached until the draft changes. */
  function view(env) {
    const d = openDraft(env);
    if (!d) return null;
    const key = `${env}|${d.slug}`;
    if (!views.has(key)) { const rows = overlay(env, d); views.set(key, { g: buildIndex(rowsToModel(env, rows)), x: rowsToExtras(rows) }); }
    return views.get(key);
  }

  /** The baseline (with what the draft's imports brought) and the current rows of a design, with or without a draft. */
  function parts(env, d) {
    const stored = data.baselines?.[env] ?? [], cur = d ? overlay(env, d) : rowsOf(env);
    const imported = d ? importBaseline(d.ops, new Set(cur.map(rowId))) : [];
    const own = new Set(imported.map(rowId));
    return { stored, imported, cur, base: imported.length ? [...stored.filter((r) => !own.has(rowId(r))), ...imported] : stored };
  }
  const memoed = (key, make) => { if (!memo.has(key)) memo.set(key, make()); return memo.get(key); };
  const noRefs = { endpoints: {}, components: {}, origins: {} };
  /** References of the design as read now (the open draft laid over it); none for a sealed environment. */
  const refsOf = (env) => {
    if (!isDesign(env)) return noRefs;
    const d = openDraft(env);
    return memoed(`${env}|${d?.slug ?? ''}|refs|${d?.ops.length ?? 0}`, () => { const p = parts(env, d); return referencesOf(p.cur, originsOf(p.stored, p.imported), meta(env).copiedAt); });
  };

  const info = (env, d) => {
    const ch = draftChanges(rowsOf(env), netOps(d.ops), d.ops);
    return { id: d.id, slug: d.slug, name: d.name, status: d.status, createdBy: d.createdBy, createdAt: d.createdAt, updatedAt: d.updatedAt, closedAt: d.closedAt ?? null,
      ops: d.ops.length, authors: [...new Set(d.ops.map((o) => o.author))], counts: d.status === 'open' ? ch.counts : { added: 0, removed: 0, changed: 0 } };
  };

  function marks(env, against) {
    if (!isDesign(env)) return { ...diffEnv([], [], { against: 'baseline', source: null, baselineAt: null }), refs: noRefs };
    const slug = reading.env === env ? reading.draft : null, d = slug ? find(env, slug) : null;
    const key = `${env}|${slug ?? ''}|${against}|${d?.ops.length ?? 0}`;
    return memoed(key, () => {
      const m = meta(env), p = parts(env, d);
      if (against === 'source' && !(data.models ?? {})[m.source]) fail(`the source environment '${m.source}' of '${env}' no longer exists: compare against the baseline instead`);
      const now = against === 'source' ? sourceNow(new Map(p.base.map((r) => [r.sourceEnv, data.rows?.[r.sourceEnv] ?? null])), p.base, m.copiedAt) : null;
      return { ...diffEnv(now ? now.rows : p.base, p.cur,
        { against, draft: slug, source: m.source, baselineAt: m.copiedAt, calleeOf: calleeIndex(p.cur), ...(now ? { vanished: now.vanished } : {}) }), refs: refsOf(env) };
    });
  }

  /** Validate and append ops (all or nothing, like the server's appendOps): shape, then the design rules over the whole request. */
  function append(env, d, ops, author = 'anonymous', origins = [], byAi = false) {
    const env0 = new Map(rowsOf(env).map((r) => [rowId(r), r])), rows = new Map(overlay(env, d).map((r) => [rowId(r), r]));
    if (!Array.isArray(ops) || !ops.length) fail('ops must be a non-empty list of {op, anchor, service?, data?}', 422);
    const at = now(), first = new Map(d.ops.map((o) => [rowId(o), o.baseHash]));
    const next = ops.map((i, n) => {
      const errs = validateOpShape(i);
      if (errs.length) fail(`op ${n}: ${errs[0]}`, 422);
      const r = opRow(i);
      if (r.list === 'channels' && !r.service) r.service = [...rows.values()].find((x) => x.list === 'channels' && x.key === r.key)?.service ?? '';
      const e = env0.get(rowId(r)), id = rowId(r);
      if (!first.has(id)) first.set(id, e ? rawHash(e.data, r.list) : null);
      const op = { ...i, ...r, seq: Math.max(0, ...d.ops.map((o) => o.seq)) + n + 1, baseHash: first.get(id), author, byAi, at, ...(origins[n] ? { origin: origins[n] } : {}) };
      applyOp(rows, op);
      return op;
    });
    const issues = designIssues(rows, next.flatMap((o, index) => (o.op === 'upsert' ? [{ index, service: o.service, list: o.list, key: o.key }] : [])), (meta(env).groups ?? []).map((g) => g.key));
    if (issues.length) { const e = new Error(issues[0].message); e.status = 422; e.code = issues[0].code; throw e; }
    const from = d.ops.length ? Math.max(...d.ops.map((o) => o.seq)) + 1 : 1;
    d.ops.push(...next); d.updatedAt = at; bump(env);
    return { from, to: from + next.length - 1, counts: draftChanges(rowsOf(env), netOps(d.ops), d.ops).counts };
  }

  /** Flow names and descriptions, as the draft would leave them: the stored ones, the preview's own renames, the draft's flow ops. */
  function texts(env) {
    const out = new Map(data.flowTexts?.[env] ?? []);
    for (const [k, n] of Object.entries(names[env] ?? {})) { const t = overlayText({ name: n }, out.get(k)); if (t) out.set(k, t); else out.delete(k); }
    const d = openDraft(env);
    if (d) for (const [k, op] of rowsToExtras(overlay(env, d)).flows) { const t = overlayText(op, out.get(k)); if (t) out.set(k, t); else out.delete(k); }
    return out;
  }

  const viewGraph = (env) => view(env)?.g ?? baseGraph(env);
  const edits = createEdits({ data, baseGraph, viewGraph, meta, isDesign, find, overlay, append, refsOf, texts, names });

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
    editDraft: async (env, slug, ops, author = 'anonymous') => { const d = find(env, slug), r = append(env, d, ops, author); return { added: r.to - r.from + 1, ops: d.ops.length }; },
    undoDraft: async (env, slug) => { const d = find(env, slug); d.ops.pop(); bump(env); return { ops: d.ops.length }; },
    revertDraftItem: async (env, slug, anchor) => { const d = find(env, slug); d.ops = d.ops.filter((o) => o.anchor !== anchor); bump(env); return { ops: d.ops.length }; },
    discardDraft: async (env, slug) => { const d = find(env, slug); d.status = 'discarded'; d.closedAt = now(); bump(env); return { discarded: slug }; },
    applyDraft: async () => fail('Apply is not available in the preview: it needs the server.'),
    ...edits.api,
  };

  return {
    api,
    /** Which environment and draft the next reads are about (api.js sets it before every call, like `?draft=`). */
    source: (env) => meta(env)?.source ?? 'another environment',
    readAs: (env, draft) => { reading = { env, draft }; },
    g: viewGraph,
    dtosOf: (env) => view(env)?.x.dtos ?? data.dtos?.[env] ?? [],
    eventDtosOf: (env) => view(env)?.x.eventDtos ?? data.eventDtos?.[env] ?? [],
    schemasOf: (env) => view(env)?.x.schemas ?? data.schemas?.[env] ?? [],
    isDesign, refsOf, texts,
    /** A trace as the server answers it: the flow name on `start`, and in a design the reference decoration. */
    traceOut: (env, t, g) => {
      const name = t.start.ingress ? texts(env).get(`${t.start.service}/${t.start.ingress}`)?.name : undefined;
      const named = name ? { ...t, start: { ...t.start, name } } : t;
      return isDesign(env) ? decorateDesignTrace(named, refsOf(env), (s) => g.services.get(s)?.kind) : named;
    },
  };
}
