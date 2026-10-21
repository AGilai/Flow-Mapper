// Data store tools: stores, clients, Redis keys, schemas and DTOs.

import { HttpError } from '../../errors.ts';
import * as store from '../../store/snapshots.ts';
import * as dtos from '../../store/dtos.ts';
import * as keys from '../../store/keys.ts';
import { dbParam } from '../../routes/instances.ts';
import { stores } from '../../../core/stores.ts';
import { listClients, storeWithClients } from '../../../core/clients.ts';
import * as schemas from '../../store/schemas.ts';
import { type Tool, env, obj, envOf, listArg } from './common.ts';

export const getStoreTool: Tool = {
  name: 'get_store', description: "A data store by bind key (e.g. mongodb:orders-db/orders, redis:cache-main/order:{id}): readers and writers with the functions and operations (access read | write | read_write; `fields` per operation: role filter|projection|update|sort, path, operator, inDdl), entry points whose flows reach it, other keys in its cluster, `instanceUnknown` {reason, detail} when the DB instance id is not known yet (the key is unaffected), and its schemas by source.",
  inputSchema: obj({ env, key: { type: 'string' } }, ['key']),
  run: (c, a) => {
    const v = storeWithClients(c.graph(envOf(a)), a.key) ?? (() => { throw new HttpError(404, 'NOT_FOUND', `data store '${a.key}' not found`); })();
    return { ...v, schemas: schemas.listSchemas(c.db, envOf(a), a.key) };
  },
};

export const listClientsTool: Tool = {
  name: 'list_clients', description: "How services reach data stores (and non-store targets): one row per client site with access mode, the service's own driver, the wrapper lib and the driver bundled in it, and the `via` wrapper chain; rows carry `mixed` when a service has two majors of one driver package. Also `counts`: services per driver and major. Filters (all optional): store (bind key or its cluster), service, driver (package; matches the service's own driver or the lib's), driverMajor (e.g. '4'), lib, accessMode, via (substring of a wrapper function, file or lib). 'Services on ioredis 4.x' = driver=ioredis driverMajor=4.",
  inputSchema: obj({ env, store: { type: 'string' }, service: { type: 'string' }, driver: { type: 'string' }, driverMajor: { type: 'string' }, lib: { type: 'string' }, accessMode: { enum: ['direct_driver', 'shared_lib', 'self_implemented_wrapper', 'third_party_lib'] }, via: { type: 'string' } }),
  run: (c, a) => listClients(c.graph(envOf(a)), { store: a.store, service: a.service, driver: a.driver, driverMajor: a.driverMajor === undefined ? undefined : String(a.driverMajor), lib: a.lib, accessMode: a.accessMode, via: a.via }),
};

export const getResourceKeysTool: Tool = {
  name: 'get_resource_keys', description: "The key templates of one Redis instance (#29), grouped by the service that writes them: groups 'No harvested writer' and 'Shared: written by N services' first, then one per owner. Each row: keyTemplate, dbIndex, commands (writeCommands are the ones that change the key), opsPerHour, ttl {seconds, values per writer, disagree}, writers and readers (service, access, commands, opsPerHour, ttlSeconds), `problem` {kind no-writer | ttl-disagree, why, follows} and `flows`: the entry points whose flow runs a step that names the key (details.keyTemplate), with the function chain. `summary` counts every db. `resourceId` is the instance key (redis:cache-main), the id of the infra resource that defines it, or the bare name. Optional dbIndex, query (substring), problems (only problem rows) and service (only the templates that service writes or reads; the instance page loads one service's keys this way). The keys are the pushed list (PUT /api/envs/:env/resources/:id/keys), else the interim inline details.keys.",
  inputSchema: obj({ env, resourceId: { type: 'string' }, dbIndex: { type: 'integer', minimum: 0 }, query: { type: 'string' }, problems: { type: 'boolean' }, service: { type: 'string' } }, ['resourceId']),
  run: (c, a) => keys.readKeys(c.db, c.graph(envOf(a)), envOf(a), a.resourceId, { db: dbParam(a.dbIndex == null ? null : String(a.dbIndex)), q: a.query, problems: !!a.problems, service: a.service || undefined }),
};

export const loadSchemasTool: Tool = {
  name: 'load_schemas', description: "Store data-store schemas: [{key, source: 'code' | 'db' | 'manual' (default code), content}]. Replaces the schema of the same key and source. All or nothing.",
  inputSchema: obj({ env, schemas: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, source: { enum: ['code', 'db', 'manual'] }, content: {} }, required: ['key', 'content'] } } }, ['schemas']),
  run: (c, a) => { const keys = new Set(stores(c.graph(envOf(a))).map((s) => s.key)); return schemas.loadSchemas(c.db, envOf(a), a.schemas, (k) => keys.has(k)); },
};

export const loadDtosTool: Tool = {
  name: 'load_dtos', description: "Store DTO JSON (replaces an existing one). Endpoint DTO: {service, ingress, role, status?, content, meta?} (status for non-2xx responses); queue/topic messages use role 'request', GET/DELETE endpoints take 'request' (their path/query params) and 'response'. Event DTO: {event, content, meta?}, the message of one event type. All or nothing.",
  inputSchema: obj({ env, dtos: { type: 'array', items: { type: 'object', properties: { service: { type: 'string' }, ingress: { type: 'string' }, role: { enum: ['request', 'response'] }, status: { type: 'string', description: "response DTOs only: '404', '4xx' or 'default'; omit for the success response" }, event: { type: 'string' }, content: {}, meta: { type: 'object', description: 'provenance: {source: {repo, ref, file, line}, provenance, incomplete}' } }, required: ['content'] } } }, ['dtos']),
  run: (c, a) => dtos.loadDtos(c.db, envOf(a), a.dtos),
};
