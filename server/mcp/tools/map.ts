// Map tools: search, services, entry points, paths, link health, changelog, inventory.

import { HttpError } from '../../errors.ts';
import * as store from '../../store/snapshots.ts';
import * as desc from '../../store/descriptions.ts';
import * as keys from '../../store/keys.ts';
import { inventory } from '../../../core/inventory.ts';
import { stores } from '../../../core/stores.ts';
import { search } from '../../../core/search.ts';
import { serviceView } from '../../../core/service-view.ts';
import { viaMatches } from '../../../core/via.ts';
import { trace } from '../../../core/trace.ts';
import { entryPointsOut, flowNameMap } from '../../refs.ts';
import { findPaths } from '../../../core/paths.ts';
import { health } from '../../../core/health.ts';
import { byBasis } from '../../../core/assumed.ts';
import { type Tool, env, obj, envOf, draftArg, viewOf } from './common.ts';

export const searchTool: Tool = {
  name: 'search', description: 'Find services, functions, endpoints (by bind key), channels and resources by text.',
  inputSchema: obj({ draft: draftArg, query: { type: 'string' }, env, limit: { type: 'integer', minimum: 1, maximum: 200 } }, ['query']),
  run: (c, a) => search(viewOf(c, a).g, a.query, a.limit ?? 30, flowNameMap(c, envOf(a), a.draft || null)),
};

export const listServicesTool: Tool = {
  name: 'list_services', description: 'List services with version, team and link-health numbers.',
  inputSchema: obj({ draft: draftArg, env }),
  run: (c, a) => health(viewOf(c, a).g).services,
};

export const getServiceTool: Tool = {
  name: 'get_service', description: "A service's ingress (with callers), egress (with targets), resources, channels and functions. Egress carries `via` (wrapper hops, the last one calls the SDK) and `callSites[].via`; one call is one egress, hops are not producers. `via` filters egress to calls through a wrapper whose function or file contains the text. Fields listed in `assumed` ({what, value, basis, reason}) are defaults a harvester filled by a rule, not facts read from code; do not present them as verified.",
  inputSchema: obj({ draft: draftArg, service: { type: 'string' }, via: { type: 'string', description: 'Only egress via a wrapper matching this substring, e.g. SNSManager' }, env }, ['service']),
  run: (c, a) => {
    const v = serviceView(viewOf(c, a).g, a.service) ?? (() => { throw new HttpError(404, 'NOT_FOUND', `service '${a.service}' not found`); })();
    const out = a.via ? { ...v, egress: v.egress.filter((e) => viaMatches(e, String(a.via))) } : v;
    return { ...out, descriptions: desc.listForService(c.db, envOf(a), a.service) };
  },
};

export const listEntryPointsTool: Tool = {
  name: 'list_entry_points', description: "Ingress points where flows start (public APIs, crons, client socket events, and anything nothing else calls). `name` and `summary` are the flow's name and the start of its description where set; in a design environment `reference: true` marks an entry whose behaviour lives in another environment, and `partial: n` a flow that continues into n such references.",
  inputSchema: obj({ draft: draftArg, env }),
  run: (c, a) => entryPointsOut(c, envOf(a), a.draft || null),
};

export const findPathsTool: Tool = {
  name: 'find_paths', description: 'Service-level paths from one service to another, including through queues and topics.',
  inputSchema: obj({ draft: draftArg, from: { type: 'string' }, to: { type: 'string' }, env, limit: { type: 'integer' } }, ['from', 'to']),
  run: (c, a) => findPaths(viewOf(c, a).g, a.from, a.to, Math.min(a.limit ?? 5, 20)),
};

export const linkHealthTool: Tool = {
  name: 'link_health', description: 'Dangling egress, orphan ingress, unbound channels, broken bindings, ambiguous matches and per-service coverage. `assumed: true` returns only the assumed values (informational, not problems): values a harvester filled by a default or convention instead of reading them from code, each with {what, value, basis, reason} and counts per basis; optional `basis` narrows them. Assumed values are defaults, not facts, and are not in the coverage figure.',
  inputSchema: obj({ draft: draftArg, env, service: { type: 'string' }, assumed: { type: 'boolean', description: 'Only the assumed values and their counts per basis' }, basis: { type: 'string', description: 'With assumed: only this basis, e.g. client_default' } }),
  run: (c, a) => {
    const h = health(viewOf(c, a).g);
    if (a.assumed) {
      const xs = h.items.assumed.filter((x) => (!a.service || x.service === a.service) && (!a.basis || x.basis === a.basis));
      return { total: xs.length, byBasis: byBasis(xs), items: { assumed: xs } };
    }
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
  inputSchema: obj({ draft: draftArg, env, type: { enum: ['service', 'channel', 'store', 'event'] }, query: { type: 'string' } }),
  run: (c, a) => inventory(viewOf(c, a).g, viewOf(c, a).reader.listEventDtos().map((d) => d.event), keys.allSummaries(c.db, envOf(a))).filter((x) => (!a.type || x.type === a.type) && (!a.query || `${x.id} ${x.kind} ${x.team ?? ''}`.toLowerCase().includes(String(a.query).toLowerCase()))),
};
