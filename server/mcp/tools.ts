// MCP tool definitions. Each tool wraps the same store/core functions the REST API uses.

import type { Ctx } from '../context.ts';
import { HttpError } from '../errors.ts';
import { isList, LISTS } from '../schema.ts';
import * as store from '../store/snapshots.ts';
import * as bugs from '../store/bugs.ts';
import * as dtos from '../store/dtos.ts';
import { endpointInfo } from '../../core/endpoint-info.ts';
import { eventTypes, eventView } from '../../core/events.ts';
import { eventFlow } from '../../core/event-flow.ts';
import { inventory } from '../../core/inventory.ts';
import { stores } from '../../core/stores.ts';
import { listClients, storeWithClients } from '../../core/clients.ts';
import { channelView } from '../../core/channels.ts';
import * as schemas from '../store/schemas.ts';
import { search } from '../../core/search.ts';
import { serviceView } from '../../core/service-view.ts';
import { viaMatches } from '../../core/via.ts';
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
    name: 'get_service', description: "A service's ingress (with callers), egress (with targets), resources, channels and functions. Egress carries `via` (wrapper hops, the last one calls the SDK) and `callSites[].via`; one call is one egress, hops are not producers. `via` filters egress to calls through a wrapper whose function or file contains the text.",
    inputSchema: obj({ service: { type: 'string' }, via: { type: 'string', description: 'Only egress via a wrapper matching this substring, e.g. SNSManager' }, env }, ['service']),
    run: (c, a) => {
      const v = serviceView(c.graph(envOf(a)), a.service) ?? (() => { throw new HttpError(404, 'NOT_FOUND', `service '${a.service}' not found`); })();
      return a.via ? { ...v, egress: v.egress.filter((e) => viaMatches(e, String(a.via))) } : v;
    },
  },
  {
    name: 'list_entry_points', description: 'Ingress points where flows start (public APIs, crons, and anything nothing else calls).',
    inputSchema: obj({ env }),
    run: (c, a) => entryPoints(c.graph(envOf(a))),
  },
  {
    name: 'trace_flow',
    description: "Follow a flow from an ingress or function (egress messages carry `via`, the wrapper chain; display only): ordered calls, DB access, REST calls and async hops across services. scope 'intra' stays inside the service.",
    inputSchema: obj({ service: { type: 'string' }, ingress: { type: 'string' }, fn: { type: 'string' }, event: { type: 'string', description: 'Start from the handler of this event type at the ingress' }, expand: { type: 'array', items: { type: 'string' }, description: 'Services to show function by function' }, scope: { enum: ['intra', 'full'] }, env, maxMessages: { type: 'integer' }, frontier: { type: 'boolean', description: "Also show steps the harvester marked origin 'frontier' (call trees that reach no sink). Off by default: one 'frontier: N steps' marker per function, not counted in maxMessages" } }, ['service']),
    run: (c, a) => trace(c.graph(envOf(a)), a, { scope: a.scope, maxMessages: Math.min(a.maxMessages ?? 300, 2000), expand: a.expand, frontier: a.frontier === true })
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
    name: 'ingest_manifest', description: 'Submit a harvester manifest (kind full or delta). See schema/manifest.schema.json. The result has a `contract` report (what the manifest leaves out or cannot link, with a fix per finding). dryRun: true validates and reports without writing.',
    inputSchema: obj({ manifest: { type: 'object' }, manifests: { type: 'array', items: { type: 'object' }, description: 'Several manifests, applied together: all or nothing' }, dryRun: { type: 'boolean' } }),
    run: (c, a) => {
      if (!a.manifest && !a.manifests) throw new HttpError(400, 'BAD_REQUEST', 'send manifest or manifests');
      const rs = store.ingestBatch(c.db, a.manifests ?? [a.manifest], 'mcp', { dryRun: !!a.dryRun });
      if (!a.dryRun) new Set(rs.map((r) => r.env)).forEach((e) => c.changed(e));
      const out = a.manifests ? { results: rs } : rs[0];
      return a.dryRun ? { dryRun: true, ...out } : out;
    },
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
    name: 'get_endpoint_info', description: "One ingress endpoint (producers of its events carry `via` when they call through a wrapper): its handler, a link to the handler's code in the repo, its DTO slots (a queue takes one message; a GET its path/query params and a response body), and for event consumers each event type with its handler, derived/declared producers, status (ok, unhandled, never, declared-only) and Message DTO.",
    inputSchema: obj({ service: { type: 'string' }, ingress: { type: 'string', description: 'Ingress id' }, env }, ['service', 'ingress']),
    run: (c, a) => endpointInfo(c.graph(envOf(a)), a.service, a.ingress, dtos.endpointDtos(c.db, envOf(a), a.service, a.ingress), dtos.listEventDtos(c.db, envOf(a)))
      ?? (() => { throw new HttpError(404, 'NOT_FOUND', `ingress '${a.ingress}' of service '${a.service}' not found`); })(),
  },
  {
    name: 'load_dtos', description: "Store DTO JSON (replaces an existing one). Endpoint DTO: {service, ingress, role, status?, content, meta?} (status for non-2xx responses); queue/topic messages use role 'request', GET/DELETE endpoints take 'request' (their path/query params) and 'response'. Event DTO: {event, content, meta?}, the message of one event type. All or nothing.",
    inputSchema: obj({ env, dtos: { type: 'array', items: { type: 'object', properties: { service: { type: 'string' }, ingress: { type: 'string' }, role: { enum: ['request', 'response'] }, status: { type: 'string', description: "response DTOs only: '404', '4xx' or 'default'; omit for the success response" }, event: { type: 'string' }, content: {}, meta: { type: 'object', description: 'provenance: {source: {repo, ref, file, line}, provenance, incomplete}' } }, required: ['content'] } } }, ['dtos']),
    run: (c, a) => dtos.loadDtos(c.db, envOf(a), a.dtos),
  },
  {
    name: 'event_types',
    description: 'Event types in the environment: who publishes each one and which consumers (and handlers) receive it after subscription filters. Give type for one event type with its Message DTO and `flow`: per producer service its call sites and, per topic or direct send, one row per queue and consumer service with the outcome (handled, no-handler, possible, filtered, no-reader), a one-sentence summary and callouts.',
    inputSchema: obj({ env, type: { type: 'string' } }),
    run: (c, a) => {
      const g = c.graph(envOf(a));
      const all = eventTypes(g);
      if (!a.type) return all;
      const t = eventView(g, a.type) ?? (() => { throw new HttpError(404, 'NOT_FOUND', `event type '${a.type}' not found`); })();
      return { ...t, flow: eventFlow(g, a.type), dto: dtos.getEventDto(c.db, envOf(a), a.type) };
    },
  },
  {
    name: 'inventory', description: 'Every object: services, topics/queues/buses, data stores and event types, with connections and problem counts. Filter by type and text.',
    inputSchema: obj({ env, type: { enum: ['service', 'channel', 'store', 'event'] }, query: { type: 'string' } }),
    run: (c, a) => inventory(c.graph(envOf(a)), dtos.listEventDtos(c.db, envOf(a)).map((d) => d.event)).filter((x) => (!a.type || x.type === a.type) && (!a.query || `${x.id} ${x.kind} ${x.team ?? ''}`.toLowerCase().includes(String(a.query).toLowerCase()))),
  },
  {
    name: 'get_store', description: "A data store by bind key (e.g. mongodb:orders-db/orders, redis:cache-main/order:{id}): readers and writers with the functions and operations (access read | write | read_write; `fields` per operation: role filter|projection|update|sort, path, operator, inDdl), entry points whose flows reach it, other keys in its cluster, and its schemas by source.",
    inputSchema: obj({ env, key: { type: 'string' } }, ['key']),
    run: (c, a) => {
      const v = storeWithClients(c.graph(envOf(a)), a.key) ?? (() => { throw new HttpError(404, 'NOT_FOUND', `data store '${a.key}' not found`); })();
      return { ...v, schemas: schemas.listSchemas(c.db, envOf(a), a.key) };
    },
  },
  {
    name: 'list_clients', description: "How services reach data stores (and non-store targets): one row per client site with access mode, the service's own driver, the wrapper lib and the driver bundled in it, and the `via` wrapper chain; rows carry `mixed` when a service has two majors of one driver package. Also `counts`: services per driver and major. Filters (all optional): store (bind key or its cluster), service, driver (package; matches the service's own driver or the lib's), driverMajor (e.g. '4'), lib, accessMode, via (substring of a wrapper function, file or lib). 'Services on ioredis 4.x' = driver=ioredis driverMajor=4.",
    inputSchema: obj({ env, store: { type: 'string' }, service: { type: 'string' }, driver: { type: 'string' }, driverMajor: { type: 'string' }, lib: { type: 'string' }, accessMode: { enum: ['direct_driver', 'shared_lib', 'self_implemented_wrapper', 'third_party_lib'] }, via: { type: 'string' } }),
    run: (c, a) => listClients(c.graph(envOf(a)), { store: a.store, service: a.service, driver: a.driver, driverMajor: a.driverMajor === undefined ? undefined : String(a.driverMajor), lib: a.lib, accessMode: a.accessMode, via: a.via }),
  },
  {
    name: 'get_channel', description: 'A topic, queue, exchange or event bus by key: publishers, subscriptions/rules with event filters, consumers, event types passing through, problems, and `flow`: merged subscription rows (declarations that disagree are named), a grid of event type x destination (handled, filtered, arrives with no handler) and a one-sentence summary with callouts.',
    inputSchema: obj({ env, key: { type: 'string' } }, ['key']),
    run: (c, a) => channelView(c.graph(envOf(a)), a.key) ?? (() => { throw new HttpError(404, 'NOT_FOUND', `channel '${a.key}' not found`); })(),
  },
  {
    name: 'load_schemas', description: "Store data-store schemas: [{key, source: 'code' | 'db' | 'manual' (default code), content}]. Replaces the schema of the same key and source. All or nothing.",
    inputSchema: obj({ env, schemas: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, source: { enum: ['code', 'db', 'manual'] }, content: {} }, required: ['key', 'content'] } } }, ['schemas']),
    run: (c, a) => { const keys = new Set(stores(c.graph(envOf(a))).map((s) => s.key)); return schemas.loadSchemas(c.db, envOf(a), a.schemas, (k) => keys.has(k)); },
  },
  {
    name: 'list_bugs', description: 'Bugs sorted by priority. Filter by status/priority/reporter (comma lists), service, version, text, open=true, or updatedSince (ISO time; includes new comments) for polling.',
    inputSchema: obj({ status: { type: 'string' }, priority: { type: 'string' }, reporter: { type: 'string' }, updatedSince: { type: 'string' }, service: { type: 'string' }, version: { type: 'string' }, q: { type: 'string' }, open: { type: 'boolean' } }),
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
