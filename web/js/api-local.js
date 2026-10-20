// In-browser backend for the static preview build. Runs the shared core/ modules against bundled
// data (globalThis.FLOW_PREVIEW = {version, models: {env: Model}, dtos, eventDtos, schemas: {env: [...]}, bugs: [Bug]}). Bug edits stay in memory.

import { buildIndex } from '../core/graph-index.js';
import { systemGraph } from '../core/system-graph.js';
import { serviceView } from '../core/service-view.js';
import { entryPoints, trace } from '../core/trace.js';
import { findPaths } from '../core/paths.js';
import { search } from '../core/search.js';
import { health } from '../core/health.js';
import { impact, suggestPriority } from '../core/impact.js';
import { endpointInfo } from '../core/endpoint-info.js';
import { inventory } from '../core/inventory.js';
import { listClients, storeWithClients } from '../core/clients.js';
import { channelView } from '../core/channels.js';
import { eventView } from '../core/events.js';
import { eventFlow } from '../core/event-flow.js';

const data = globalThis.FLOW_PREVIEW;
const indexes = new Map();
const g = (env) => { if (!indexes.has(env)) indexes.set(env, buildIndex(data.models[env])); return indexes.get(env); };
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

export const api = {
  version: async () => ({ version: data.version }),
  envs: async () => Object.keys(data.models),
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
  entryPoints: async (env) => entryPoints(g(env)),
  inventory: async (env) => inventory(g(env), (data.eventDtos?.[env] ?? []).map((d) => d.event)),
  clients: async (env, f = {}) => listClients(g(env), f),
  store: async (env, key) => ({ ...(storeWithClients(g(env), key) ?? fail(`data store '${key}' not found`)), schemas: (data.schemas?.[env] ?? []).filter((s) => s.key === key) }),
  channel: async (env, key) => channelView(g(env), key) ?? fail(`channel '${key}' not found`),
  eventType: async (env, type) => ({ ...(eventView(g(env), type) ?? fail(`event type '${type}' not found`)), flow: eventFlow(g(env), type), dto: (data.eventDtos?.[env] ?? []).find((d) => d.event === type) ?? null }),
  endpoint: async (env, service, ingress) => endpointInfo(g(env), service, ingress,
    (data.dtos?.[env] ?? []).filter((d) => d.service === service && d.ingress === ingress), data.eventDtos?.[env] ?? []) ?? fail('endpoint not found'),
  trace: async (env, q) => trace(g(env), q, { scope: q.scope, maxMessages: q.maxMessages ?? 500, expand: q.expand?.split(',').filter(Boolean), frontier: q.frontier === '1' || q.frontier === true }) ?? fail('start point not found'),
  paths: async (env, from, to) => findPaths(g(env), from, to),
  search: async (env, q, limit) => search(g(env), q, limit),
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
