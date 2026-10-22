// In-browser backend for the static preview build. Runs the shared core/ modules against bundled
// data (globalThis.FLOW_PREVIEW = {version, models: {env: Model}, dtos, eventDtos, schemas: {env: [...]}, bugs: [Bug]}). Bug edits stay in memory.

import { buildIndex } from '../core/graph-index.js';
import { systemGraph } from '../core/system-graph.js';
import { serviceView } from '../core/service-view.js';
import { entryPoints, trace } from '../core/trace.js';
import { flowCounts, markedReached } from '../core/flow-counts.js';
import { flowsThrough } from '../core/flows-through.js';
import { refsReached } from '../core/flow-refs.js';
import { decorateEntries } from '../core/flow-text.js';
import { findPaths } from '../core/paths.js';
import { search } from '../core/search.js';
import { health } from '../core/health.js';
import { impact, suggestPriority } from '../core/impact.js';
import { endpointInfo } from '../core/endpoint-info.js';
import { inventory } from '../core/inventory.js';
import { listClients, storeWithClients } from '../core/clients.js';
import { instanceView, keysView, resolveInstance } from '../core/instances.js';
import { exchangeView, resolveExchange } from '../core/amqp-exchange.js';
import { keySummary } from '../core/keys.js';
import { channelView } from '../core/channels.js';
import { eventView } from '../core/events.js';
import { eventFlow } from '../core/event-flow.js';
import { flowDescriptions, HASH_TRACE } from '../core/description.js';
import { exportMermaid } from '../core/mermaid-export.js';
import { envApi } from './api-local-envs.js';
import { createDesign } from './api-local-design.js';
import { createComments } from './api-local-comments.js';
import { createUsers } from './api-local-users.js';
import { createMentions } from './api-local-mentions.js';
import { createActionItems } from './api-local-action-items.js';

const data = globalThis.FLOW_PREVIEW;
const indexes = new Map();
const base = (env) => { if (!indexes.has(env)) indexes.set(env, buildIndex(data.models[env])); return indexes.get(env); };
const D = createDesign(data, base); // marks, drafts and the reads of a design environment as an open draft would leave it
const g = D.g;
export const readAs = D.readAs;
const bugs = data.bugs.map((b) => structuredClone(b));
const OPEN = ['open', 'triaged', 'in_progress'];
const clone = (x) => structuredClone(x);
const now = () => new Date().toISOString();

const TRANSITIONS = {
  open: ['triaged', 'in_progress', 'wont_fix', 'duplicate'], triaged: ['open', 'in_progress', 'wont_fix', 'duplicate'],
  in_progress: ['triaged', 'fixed', 'wont_fix'], fixed: ['verified', 'in_progress'], verified: ['closed', 'in_progress'],
  closed: ['open'], wont_fix: ['open'], duplicate: ['open'],
};
const fail = (message) => { const e = new Error(message); e.status = 422; throw e; };
const find = (id) => bugs.find((b) => b.id === Number(id)) ?? fail(`bug #${id} not found`);
function rescore(b) {
  const imp = impact(g(b.env), b.links);
  b.impact = imp.flows;
  if (!b.priorityOverride) b.priority = suggestPriority(b.severity, imp.flows, imp.totalFlows);
  b.allowedTransitions = TRANSITIONS[b.status];
  b.needsVerification = b.status === 'fixed' && !!b.fixedInVersion;
}

/** A copied endpoint has no functions: the same 409 the server gives (NO_HANDLER) instead of a bare not-found. */
function noStart(env, q) {
  const ing = q.ingress && g(env).ingress.get(`${q.service}:${q.ingress}`);
  if (!ing || g(env).fns.get(`${q.service}:${ing.handler}`)) return fail('start point not found');
  const anchor = `ing:${q.service}/${ing.id}`, ref = D.refsOf(env).endpoints[anchor], source = ref?.source ?? D.source(env);
  const e = new Error(ref ? `This endpoint is a reference: its behaviour lives in ${source}` : `This endpoint's behaviour lives in ${source}: ${env} holds the endpoint, not the functions behind it`);
  e.status = 409; e.code = 'NO_HANDLER'; e.details = { source, service: q.service, ingress: ing.id, reference: !!ref, anchor };
  throw e;
}

const U = createUsers(data);
export const api = {
  version: async () => ({ version: data.version }),
  envs: async () => Object.keys(data.models),
  ...envApi(data, g),
  ...U,
  ...createMentions(data),
  ...createComments(data, g, U),
  ...createActionItems(data, g, U),
  ...D.api,
  services: async (env) => {
    const h = new Map(health(g(env)).services.map((s) => [s.service, s]));
    return g(env).model.services.map((s) => ({ ...s, health: h.get(s.name) }));
  },
  system: async (env) => systemGraph(g(env)),
  service: async (env, name) => {
    const v = serviceView(g(env), name);
    if (!v) fail(`service '${name}' not found`);
    return { ...v, openBugs: bugs.filter((b) => OPEN.includes(b.status) && b.links.some((l) => l.id === name || l.service === name)).length };
  },
  entryPoints: async (env) => {
    const refs = D.refsOf(env), design = D.isDesign(env);
    return decorateEntries(entryPoints(g(env)), D.texts(env), design ? refs : undefined, design ? refsReached(g(env), refs) : undefined, design ? markedReached(g(env)) : undefined);
  },
  flowsThrough: async (env, services) => {
    const hit = flowsThrough(g(env), services), refs = D.refsOf(env), design = D.isDesign(env);
    return decorateEntries(entryPoints(g(env)).filter((e) => hit.has(`${e.service}:${e.id}`)), D.texts(env), design ? refs : undefined, design ? refsReached(g(env), refs) : undefined, design ? markedReached(g(env)) : undefined);
  },
  flowCounts: async (env) => { const t = D.texts(env); return flowCounts(g(env)).map((c) => (t.get(`${c.service}/${c.ingress}`)?.name ? { ...c, name: t.get(`${c.service}/${c.ingress}`).name } : c)); },
  inventory: async (env) => inventory(g(env), D.eventDtosOf(env).map((d) => d.event), new Map((data.keys?.[env] ?? []).map((k) => [k.instance, keySummary(k.entries)]))),
  instance: async (env, id) => {
    const key = resolveInstance(g(env), id), k = (data.keys?.[env] ?? []).find((x) => x.instance === key);
    if (!key && resolveExchange(g(env), id) != null) return exchangeView(g(env), id);
    return (key && instanceView(g(env), key, k?.entries ?? [], k?.meta ?? null)) ?? fail(`Redis instance '${id}' not found`);
  },
  instanceKeys: async (env, id, f = {}) => {
    const key = resolveInstance(g(env), id), k = (data.keys?.[env] ?? []).find((x) => x.instance === key);
    return (key && keysView(g(env), key, k?.entries ?? [], k?.meta ?? null, { db: f.db === '' || f.db == null ? undefined : Number(f.db), q: f.q, problems: !!f.problems, service: f.service || undefined })) ?? fail(`Redis instance '${id}' not found`);
  },
  clients: async (env, f = {}) => listClients(g(env), f),
  store: async (env, key) => ({ ...(storeWithClients(g(env), key) ?? fail(`data store '${key}' not found`)), schemas: D.schemasOf(env).filter((s) => s.key === key) }),
  channel: async (env, key) => channelView(g(env), key) ?? fail(`channel '${key}' not found`),
  eventType: async (env, type) => ({ ...(eventView(g(env), type) ?? fail(`event type '${type}' not found`)), flow: eventFlow(g(env), type), dto: D.eventDtosOf(env).find((d) => d.event === type) ?? null }),
  endpoint: async (env, service, ingress) => endpointInfo(g(env), service, ingress,
    D.dtosOf(env).filter((d) => d.service === service && d.ingress === ingress), D.eventDtosOf(env)) ?? fail('endpoint not found'),
  trace: async (env, q) => {
    const t = trace(g(env), q, { scope: q.scope, maxMessages: q.maxMessages ?? 500, expand: q.expand?.split(',').filter(Boolean), frontier: q.frontier === '1' || q.frontier === true });
    return t ? D.traceOut(env, t, g(env)) : noStart(env, q);
  },
  descriptions: async (env, service, ingress) => {
    const t = trace(g(env), { service, ingress }, HASH_TRACE) ?? fail('flow not found');
    return flowDescriptions(t, service, ingress, (data.descriptions?.[env] ?? []).filter((r) => r.service === service && r.ingress === ingress));
  },
  putDescription: async (env, { service, ingress, callee = '', text, title, editedBy }) => { // the human record, in memory (a title only on a step; omitted keeps the stored one)
    const rows = (data.descriptions ??= {})[env] ??= [];
    const at = rows.findIndex((r) => r.service === service && r.ingress === ingress && r.callee === callee && r.source === 'human');
    const old = at >= 0 ? rows[at].title ?? null : null;
    if (at >= 0) rows.splice(at, 1);
    const ttl = !callee.startsWith('#step:') ? null : title === undefined ? old : String(title ?? '').trim().slice(0, 80) || null, body = String(text).trim();
    if (body || ttl) rows.push({ service, ingress, callee, source: 'human', text: body, title: ttl, author: editedBy ?? 'preview', model: null, traceHash: null, updatedAt: now() });
    return api.descriptions(env, service, ingress);
  },
  /** A flow as Mermaid text (export works in the preview; import needs the server). */
  mermaid: async (env, service, ingress) => {
    const t = trace(g(env), { service, ingress }, HASH_TRACE) ?? fail('flow not found'), text = D.texts(env).get(`${service}/${ingress}`);
    return exportMermaid(t, { name: text?.name, description: text?.description, descriptions: await api.descriptions(env, service, ingress) });
  },
  mermaidPreview: async () => fail('Importing Mermaid is not available in the preview: it needs the server.'),
  mermaidImport: async () => fail('Importing Mermaid is not available in the preview: it needs the server.'),
  undoMermaid: async () => fail('Importing Mermaid is not available in the preview: it needs the server.'),
  paths: async (env, from, to) => findPaths(g(env), from, to),
  search: async (env, q, limit) => search(g(env), q, limit, new Map([...D.texts(env)].flatMap(([k, t]) => (t.name ? [[k, t.name]] : [])))),
  health: async (env) => health(g(env)),
  changelog: async () => [],
  bugs: async (f = {}) => clone(bugs.filter((b) => !f.open || OPEN.includes(b.status))
    .sort((a, b) => a.priority.localeCompare(b.priority) || b.impact - a.impact)),
  bugStats: async () => ({ byVersion: Object.fromEntries(bugs.map((b) => [b.appVersion, 1])) }),
  bug: async (id) => clone(find(id)),
  createBug: async (input) => {
    if (!input.title?.trim()) fail('title is required');
    const b = {
      id: Math.max(0, ...bugs.map((x) => x.id)) + 1, title: input.title.trim(), description: input.description ?? '', steps: input.steps ?? '',
      status: 'open', severity: input.severity ?? 'S3', priorityOverride: false, appVersion: input.appVersion ?? data.version,
      fixedInVersion: null, env: input.env ?? Object.keys(data.models)[0], reporter: input.reporter ?? 'anonymous', assignee: null,
      channel: 'web', resolution: null, createdAt: now(), updatedAt: now(), links: input.links ?? [], attachments: [], comments: [],
    };
    rescore(b);
    bugs.push(b);
    return clone(b);
  },
  updateBug: async (id, patch) => {
    const b = find(id);
    if (patch.status && patch.status !== b.status) {
      if (!TRANSITIONS[b.status].includes(patch.status)) fail(`cannot move from ${b.status} to ${patch.status}`);
      if (patch.status === 'fixed' && !(patch.fixedInVersion || b.fixedInVersion)) fail('fixedInVersion is required to mark a bug fixed');
    }
    if (patch.priority === null) { b.priorityOverride = false; delete patch.priority; }
    else if (patch.priority) b.priorityOverride = true;
    Object.assign(b, patch, { updatedAt: now() });
    rescore(b);
    return clone(b);
  },
  comment: async (id, author, body) => {
    const b = find(id);
    b.comments.push({ id: b.comments.length + 1, author, body, createdAt: now() });
    return clone(b);
  },
  attach: async () => fail('Log upload is not available in the preview.'),
};
