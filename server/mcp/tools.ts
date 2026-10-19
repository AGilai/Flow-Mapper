// MCP tool definitions. Each tool wraps the same store/core functions the REST API uses.

import type { Ctx } from '../context.ts';
import { HttpError } from '../errors.ts';
import { isList, LISTS } from '../schema.ts';
import * as store from '../store/snapshots.ts';
import * as bugs from '../store/bugs.ts';
import { search } from '../../core/search.ts';
import { serviceView } from '../../core/service-view.ts';
import { entryPoints, trace } from '../../core/trace.ts';
import { findPaths } from '../../core/paths.ts';
import { health } from '../../core/health.ts';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (ctx: Ctx, args: any) => unknown;
}

const env = { type: 'string', description: "Environment, default 'default'" };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const envOf = (a: any) => a.env ?? 'default';
const listArg = (l: string) => { if (!isList(l)) throw new HttpError(400, 'BAD_REQUEST', `list must be one of ${LISTS.join(', ')}`); return l; };

export const TOOLS: Tool[] = [
  {
    name: 'search', description: 'Find services, functions, endpoints (by bind key), channels and resources by text.',
    inputSchema: obj({ query: { type: 'string' }, env, limit: { type: 'integer', minimum: 1, maximum: 200 } }, ['query']),
    run: (c, a) => search(c.graph(envOf(a)), a.query, a.limit ?? 30),
  },
  {
    name: 'list_services', description: 'List services with version, team and link-health numbers.',
    inputSchema: obj({ env }),
    run: (c, a) => health(c.graph(envOf(a))).services,
  },
  {
    name: 'get_service', description: "A service's ingress (with callers), egress (with targets), resources, channels and functions.",
    inputSchema: obj({ service: { type: 'string' }, env }, ['service']),
    run: (c, a) => serviceView(c.graph(envOf(a)), a.service) ?? (() => { throw new HttpError(404, 'NOT_FOUND', `service '${a.service}' not found`); })(),
  },
  {
    name: 'list_entry_points', description: 'Ingress points where flows start (public APIs, crons, and anything nothing else calls).',
    inputSchema: obj({ env }),
    run: (c, a) => entryPoints(c.graph(envOf(a))),
  },
  {
    name: 'trace_flow',
    description: "Follow a flow from an ingress or function: ordered calls, DB access, REST calls and async hops across services. scope 'intra' stays inside the service.",
    inputSchema: obj({ service: { type: 'string' }, ingress: { type: 'string' }, fn: { type: 'string' }, scope: { enum: ['intra', 'full'] }, env, maxMessages: { type: 'integer' } }, ['service']),
    run: (c, a) => trace(c.graph(envOf(a)), a, { scope: a.scope, maxMessages: Math.min(a.maxMessages ?? 300, 2000) })
      ?? (() => { throw new HttpError(404, 'NOT_FOUND', 'start point not found (give ingress or fn)'); })(),
  },
  {
    name: 'find_paths', description: 'Service-level paths from one service to another, including through queues and topics.',
    inputSchema: obj({ from: { type: 'string' }, to: { type: 'string' }, env, limit: { type: 'integer' } }, ['from', 'to']),
    run: (c, a) => findPaths(c.graph(envOf(a)), a.from, a.to, Math.min(a.limit ?? 5, 20)),
  },
  {
    name: 'link_health', description: 'Dangling egress, orphan ingress, unbound channels, broken bindings, ambiguous matches and per-service coverage.',
    inputSchema: obj({ env, service: { type: 'string' } }),
    run: (c, a) => {
      const h = health(c.graph(envOf(a)));
      if (!a.service) return h;
      const f = <T extends { service: string }>(xs: T[]) => xs.filter((x) => x.service === a.service);
      return { service: h.services.find((s) => s.service === a.service), items: Object.fromEntries(Object.entries(h.items).map(([k, v]) => [k, f(v as any)])) };
    },
  },
  {
    name: 'changelog', description: 'Recent changes to the map (ingests and edits), newest first.',
    inputSchema: obj({ env, service: { type: 'string' }, limit: { type: 'integer' } }),
    run: (c, a) => store.listChangelog(c.db, envOf(a), { service: a.service, limit: Math.min(a.limit ?? 20, 200) }),
  },
  {
    name: 'ingest_manifest', description: 'Submit a harvester manifest (kind full or delta). See schema/manifest.schema.json.',
    inputSchema: obj({ manifest: { type: 'object' } }, ['manifest']),
    run: (c, a) => { const r = store.ingest(c.db, a.manifest, 'mcp'); c.changed(r.env); return r; },
  },
  {
    name: 'upsert_entity', description: `Create or replace one entity of a service. list: ${LISTS.join(', ')}.`,
    inputSchema: obj({ env, service: { type: 'string' }, list: { enum: [...LISTS] }, entity: { type: 'object' } }, ['service', 'list', 'entity']),
    run: (c, a) => { const r = store.upsertEntity(c.db, envOf(a), a.service, listArg(a.list), a.entity, 'mcp'); c.changed(r.env); return r; },
  },
  {
    name: 'delete_entity', description: 'Delete one entity of a service by id (bindKey for channels).',
    inputSchema: obj({ env, service: { type: 'string' }, list: { enum: [...LISTS] }, key: { type: 'string' } }, ['service', 'list', 'key']),
    run: (c, a) => { const r = store.deleteEntity(c.db, envOf(a), a.service, listArg(a.list), a.key, 'mcp'); c.changed(r.env); return r; },
  },
  {
    name: 'list_bugs', description: 'Bugs sorted by priority. Filter by status/priority (comma lists), service, version, text, or open=true.',
    inputSchema: obj({ status: { type: 'string' }, priority: { type: 'string' }, service: { type: 'string' }, version: { type: 'string' }, q: { type: 'string' }, open: { type: 'boolean' } }),
    run: (c, a) => bugs.listBugs(c.db, a, c.appVersion),
  },
  {
    name: 'get_bug', description: 'One bug with links, attachments, comments and allowed status transitions.',
    inputSchema: obj({ id: { type: 'integer' } }, ['id']),
    run: (c, a) => bugs.getBug(c.db, a.id, c.appVersion),
  },
  {
    name: 'report_bug', description: 'Report a bug in Flow-Mapper. Severity S1 (worst) to S4. Optionally link map entities.',
    inputSchema: obj({
      title: { type: 'string' }, description: { type: 'string' }, steps: { type: 'string' }, severity: { enum: ['S1', 'S2', 'S3', 'S4'] },
      appVersion: { type: 'string' }, env, reporter: { type: 'string' },
      links: { type: 'array', items: obj({ type: { enum: ['service', 'function', 'ingress', 'egress', 'channel', 'resource'] }, service: { type: 'string' }, id: { type: 'string' } }, ['type', 'id']) },
      log: { type: 'string', description: 'Optional log text to attach' },
    }, ['title']),
    run: (c, a) => {
      const { log, ...input } = a;
      const id = bugs.createBug(c.db, c.graph, { ...input, channel: 'mcp' }, c.appVersion);
      if (log) bugs.addAttachment(c.db, c.graph, c.dataDir, id, 'reported.log', 'text/plain', Buffer.from(log));
      return bugs.getBug(c.db, id, c.appVersion);
    },
  },
  {
    name: 'update_bug', description: 'Change status (respecting the workflow), severity, priority override (null clears), assignee, fixedInVersion, resolution or links.',
    inputSchema: obj({
      id: { type: 'integer' }, status: { type: 'string' }, severity: { type: 'string' }, priority: { type: ['string', 'null'] },
      assignee: { type: 'string' }, fixedInVersion: { type: 'string' }, links: { type: 'array' },
      resolution: obj({ type: { enum: ['code', 'map-data', 'config', 'none'] }, ref: { type: 'string' }, note: { type: 'string' } }, ['type']),
      comment: { type: 'string' },
    }, ['id']),
    run: (c, a) => {
      const { id, comment, ...patch } = a;
      if (Object.keys(patch).length) bugs.updateBug(c.db, c.graph, id, patch);
      if (comment) bugs.addComment(c.db, id, 'agent', comment);
      return bugs.getBug(c.db, id, c.appVersion);
    },
  },
];
