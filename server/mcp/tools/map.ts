// Map tools: search, services, entry points, paths, link health, changelog, inventory.

import { HttpError } from '../../errors.ts';
import * as store from '../../store/snapshots.ts';
import * as dtos from '../../store/dtos.ts';
import * as desc from '../../store/descriptions.ts';
import * as keys from '../../store/keys.ts';
import { inventory } from '../../../core/inventory.ts';
import { stores } from '../../../core/stores.ts';
import { search } from '../../../core/search.ts';
import { serviceView } from '../../../core/service-view.ts';
import { viaMatches } from '../../../core/via.ts';
import { entryPoints, trace } from '../../../core/trace.ts';
import { findPaths } from '../../../core/paths.ts';
import { health } from '../../../core/health.ts';
import { type Tool, env, obj, envOf, listArg } from './common.ts';

export const searchTool: Tool = {
  name: 'search', description: 'Find services, functions, endpoints (by bind key), channels and resources by text.',
  inputSchema: obj({ query: { type: 'string' }, env, limit: { type: 'integer', minimum: 1, maximum: 200 } }, ['query']),
  run: (c, a) => search(c.graph(envOf(a)), a.query, a.limit ?? 30),
};

export const listServicesTool: Tool = {
  name: 'list_services', description: 'List services with version, team and link-health numbers.',
  inputSchema: obj({ env }),
  run: (c, a) => health(c.graph(envOf(a))).services,
};

export const getServiceTool: Tool = {
  name: 'get_service', description: "A service's ingress (with callers), egress (with targets), resources, channels and functions. Egress carries `via` (wrapper hops, the last one calls the SDK) and `callSites[].via`; one call is one egress, hops are not producers. `via` filters egress to calls through a wrapper whose function or file contains the text.",
  inputSchema: obj({ service: { type: 'string' }, via: { type: 'string', description: 'Only egress via a wrapper matching this substring, e.g. SNSManager' }, env }, ['service']),
  run: (c, a) => {
    const v = serviceView(c.graph(envOf(a)), a.service) ?? (() => { throw new HttpError(404, 'NOT_FOUND', `service '${a.service}' not found`); })();
    const out = a.via ? { ...v, egress: v.egress.filter((e) => viaMatches(e, String(a.via))) } : v;
    return { ...out, descriptions: desc.listForService(c.db, envOf(a), a.service) };
  },
};

export const listEntryPointsTool: Tool = {
  name: 'list_entry_points', description: 'Ingress points where flows start (public APIs, crons, client socket events, and anything nothing else calls).',
  inputSchema: obj({ env }),
  run: (c, a) => entryPoints(c.graph(envOf(a))),
};

export const findPathsTool: Tool = {
  name: 'find_paths', description: 'Service-level paths from one service to another, including through queues and topics.',
  inputSchema: obj({ from: { type: 'string' }, to: { type: 'string' }, env, limit: { type: 'integer' } }, ['from', 'to']),
  run: (c, a) => findPaths(c.graph(envOf(a)), a.from, a.to, Math.min(a.limit ?? 5, 20)),
};

export const linkHealthTool: Tool = {
  name: 'link_health', description: 'Dangling egress, orphan ingress, unbound channels, broken bindings, ambiguous matches and per-service coverage.',
  inputSchema: obj({ env, service: { type: 'string' } }),
  run: (c, a) => {
    const h = health(c.graph(envOf(a)));
    if (!a.service) return h;
    const f = <T extends { service: string }>(xs: T[]) => xs.filter((x) => x.service === a.service);
    return { service: h.services.find((s) => s.service === a.service), items: Object.fromEntries(Object.entries(h.items).map(([k, v]) => [k, f(v as any)])) };
  },
};

export const changelogTool: Tool = {
  name: 'changelog', description: 'Recent changes to the map (ingests and edits), newest first.',
  inputSchema: obj({ env, service: { type: 'string' }, limit: { type: 'integer' } }),
  run: (c, a) => store.listChangelog(c.db, envOf(a), { service: a.service, limit: Math.min(a.limit ?? 20, 200) }),
};

export const inventoryTool: Tool = {
  name: 'inventory', description: 'Every object: services, topics/queues/buses, data stores and event types, with connections and problem counts. Filter by type and text.',
  inputSchema: obj({ env, type: { enum: ['service', 'channel', 'store', 'event'] }, query: { type: 'string' } }),
  run: (c, a) => inventory(c.graph(envOf(a)), dtos.listEventDtos(c.db, envOf(a)).map((d) => d.event), keys.allSummaries(c.db, envOf(a))).filter((x) => (!a.type || x.type === a.type) && (!a.query || `${x.id} ${x.kind} ${x.team ?? ''}`.toLowerCase().includes(String(a.query).toLowerCase()))),
};
