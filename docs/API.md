# Flow-Mapper API

All endpoints are JSON unless noted. Errors look like
`{"error": {"code": "VERSION_MISMATCH", "message": "...", "details": ...}}`.

`:env` is an environment name (`prod`, `staging`, …). Manifests without `env` go to `default`.

## Ingest (harvesters)

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/ingest` | a manifest, or `{"manifests": [...]}` | `kind: full` replaces the service; `kind: delta` patches it. `?dryRun=1` validates and returns the changes without writing (200) |

Responses: `201 {results: [{env, service, fromVersion, toVersion, changes, changelogId, contract}]}`;
a dry run returns `200 {dryRun: true, results: [...]}` with the same result shape (nothing written).

A batch (`{"manifests": [...]}`) is one transaction: if any manifest is invalid or stale, the whole batch is rejected and nothing is written (a dry run likewise writes nothing). `contract` reports what the manifest leaves out or cannot link, judged against the env as it would be
after the whole batch. It never rejects:

```json
{"errors": 0, "warnings": 1, "infos": 1, "findings": [
  {"level": "warn", "code": "dangling-egress", "service": "orders-svc", "kind": "egress", "id": "pay.charge",
   "message": "egress 'pay.charge' (http:POST payments/charge) matches no ingress or channel in env 'prod'",
   "fix": "Check the bindKey spelling against the callee's ingress or the declared channel; ..."}]}
```

`level` is `error`, `warn` or `info`; `kind` is `ingress`, `egress`, `step`, `binding`, `channel` or
`service`. Codes are listed in HARVESTER-GUIDE.md ("Contract report"). Over MCP, `ingest_manifest`
returns the same and takes `dryRun: true`.

| Code | Status | Meaning | Harvester should |
|---|---|---|---|
| `INVALID` | 422 | Schema or internal-reference errors; `details` lists them | fix the manifest |
| `VERSION_NOT_NEWER` | 409 | `version` ≤ stored version | bump the version |
| `VERSION_MISMATCH` | 409 | delta `baseVersion` ≠ stored version; `details.currentVersion` | send a full manifest |
| `NOT_FOUND` | 404 | delta for a service that was never ingested | send a full manifest |

In a batch (`manifests` with more than one entry) the failing manifest is named: `message` starts with `manifests[<i>] (<service>):` and `details` is an object `{batchIndex, service, ...}` (for `INVALID` the list moves to `details.errors`; `currentVersion` stays alongside). A single manifest keeps the plain shapes above.

Schema: [`schema/manifest.schema.json`](../schema/manifest.schema.json). Examples: [`samples/`](../samples). Guide for harvester authors: [HARVESTER-GUIDE.md](HARVESTER-GUIDE.md).

## Map CRUD

Collections per service: `functions`, `ingress`, `egress`, `resources`, `channels`, `bindings`.
Entity key is `id` (or `bindKey` for channels; keys may contain `/` and `:`). Every write bumps the
service version by one and writes a changelog entry. Writes that break internal references
(an ingress handler or step target that does not exist) are rejected with 422.

| Method | Path |
|---|---|
| GET | `/api/envs` |
| GET / POST | `/api/envs/:env/services` |
| GET / PATCH / DELETE | `/api/envs/:env/services/:service` |
| GET / POST | `/api/envs/:env/services/:service/:collection` |
| GET / PUT / DELETE | `/api/envs/:env/services/:service/:collection/:key` |

Add `?source=ui` to mark edits made from a UI in the changelog.

## Queries

| Path | Returns |
|---|---|
| `GET /api/envs/:env/views/system` | nodes, edges (with channels), collapsedEdges (service to service). Each edge lists its `endpoints`; those carry `egress` / `ingress` ids (within the edge's from / to service) and, through a subscription, its event `filter` |
| `GET /api/envs/:env/views/service/:service` | ingress with callers, egress with targets, resources, functions. Each egress has `via` (wrapper hops, caller to SDK call, each with a code `link`) and `callSites[]` (`file`, `line`, `function`, `link`, `via`), read from the egress fields or `details.via` / `details.callSites`. A wrapper is display data: never a producer, node or edge. Each ingress has `via` (the hops that resolved its handler, kind `registration` / `bind`; from `via` or `details.handlerVia`), and each function its `unresolved` gaps |
| `GET /api/envs/:env/entry-points` | where flows start |
| `GET /api/envs/:env/flows/counts` | per entry point: distinct components its full flow reaches (`total`, `services`, `topics`, `queues`, `buses`, `stores`, `otherChannels`); reachability, no trace; cached per graph |
| `GET /api/envs/:env/trace?service=&ingress=\|fn=&scope=intra\|full&maxDepth=&maxMessages=&frontier=1` | participants and ordered messages; an egress message carries `via` (the wrapper hops of that call, for the call site when the egress lists one for the calling function); a message that reaches an ingress carries `handlerVia` (its handler-resolution hops). `code` also maps `step:<service>:<fn>#<seq>` to the link of a step's `source`. Messages of steps that are mutually exclusive alternatives carry `alt: {group, branch, of}` (see below) |
| `GET /api/envs/:env/paths?from=&to=&limit=` | service-level paths, including through queues |
| `GET /api/envs/:env/search?q=&limit=` | services, functions, endpoints, channels, resources |
| `GET /api/envs/:env/health` | link-health totals, per-service numbers, broken items (including the event checks: `unhandledEvents`, `undeliveredEvents`, `neverArrives`, `declaredNotSeen`, `subscriptionConflicts`; the store checks `multipleWriters`, `unusedStores`; and what harvesters report: `unresolved` (on ingress, egress, functions (`what: caller`), steps and resources (`what: instance`: DB instance id unknown, the store key is kept); with reason, candidates and their possible matches), `mixedCommits`, `drift`) |
| `GET /api/envs/:env/health/history?service=` | health per service version |
| `GET /api/envs/:env/changelog?service=&limit=&before=` | changes, newest first |
| `GET /api/envs/:env/model` | the raw model (for clients running `core/` themselves) |
| `GET /api/version` | running app version |

## Endpoint info and DTOs

An ingress endpoint can carry DTO JSON, stored under role `request` or `response`. Which roles an
endpoint takes, and what they are called, depends on the endpoint (`core/endpoint-info.ts` `dtoSlots`).
DTO content may be example JSON or a JSON Schema (`$schema`, or `type: object` with `properties`); the UI
shows a schema as a field table (local `$ref` into `$defs`/`definitions` resolved) with a toggle to the raw JSON.

| Endpoint | Roles (label) |
|---|---|
| sqs, sns, amqp | `request` (Message) |
| event | `request` (Event) |
| http POST / PUT / PATCH | `request` (Request body), `response` (Response body) |
| http GET / DELETE / HEAD / OPTIONS | `request` (Query / path params: `{params, query}`), `response` (Response body) |
| grpc | `request` (Request message), `response` (Response message) |
| cron | none |

A response can also be stored per status, for the error cases: `status` is an HTTP status (`404`), a
class (`4xx`) or `default`; leave it out for the success response. Only `response` DTOs take a status
(a `request` with one is a 400). `slots` lists the success response first, then one slot per stored
status (`{role: 'response', status: '404', label: 'Response 404', dto}`), codes before classes, `default` last.

Every DTO can also carry `meta`, where it came from, all fields optional:
`{source: {repo, ref, file, line}, provenance, incomplete}`. `provenance` is free text (for example
`openapi`, `derived`); `incomplete` is the reason the DTO is partial (or `true`). Reads return `meta`
and, on endpoint info, `link`: the web URL of `source` (the service's repo and commit fill in what
`source` leaves out). The UI shows it as a source line on the DTO card.

Writing a role the endpoint does not take is a 400. DTOs are loaded through
these routes, not the manifest, so re-harvesting a service keeps them; deleting the service removes
them. Writes check that the endpoint exists (404) and the role is valid (400). The ingress id is the
last path segment and may contain `/`.

| Method and path | What |
|---|---|
| `GET /api/envs/:env/endpoints/:service/:ingress` | `{ingress, method, handler, source: {repo, url, ref, file, line}, slots: [{role, label, dto, stale}], note}`; `source.url` opens the handler's file and line at the harvested commit; `stale` means the DTO was loaded before the service was last harvested |
| `GET /api/envs/:env/dtos?service=&ingress=` | stored DTOs `{service, ingress, role, status, content, meta, updatedAt}` |
| `POST /api/envs/:env/dtos` | bulk load `{dtos: [{service, ingress, role, status?, content, meta?}]}`, all or nothing (201) |
| `PUT /api/envs/:env/dtos/:service/:role/:ingress` | body is the DTO JSON; replaces an existing one. Query `status=404` for an error response, `meta=<url-encoded JSON>` for provenance (use the bulk load for large meta) |
| `DELETE /api/envs/:env/dtos/:service/:role/:ingress` | remove one; add `?status=404` for an error response |

An ingress that lists `events` takes no endpoint DTO: its messages are described per event type.

## Event types

| Method and path | What |
|---|---|
| `GET /api/envs/:env/events` | every event type with producers, consumers (after subscription filters) and `hasDto` |
| `GET /api/envs/:env/events/:type` | one event type with its Message DTO |
| `PUT /api/envs/:env/event-dtos/:type` | body is the message JSON (query `meta=` as above); replaces an existing one. Patterns (`*`) are a 400 |
| `DELETE /api/envs/:env/event-dtos/:type` | remove it |

`POST /api/envs/:env/dtos` also takes event DTOs as `{event, content, meta?}` items, mixed with endpoint
DTOs. `GET .../endpoints/:service/:ingress` returns `events`: one row per event type at that
consumer with `handler`, `pattern` (the glob that matched), `status` (`ok`, `unhandled`, `never`,
`declared-only`), `producers` (`derived`, `declared`, `harvested`), the handler's `source` link
and the `dto`. `GET .../trace` takes `event` to start from that event type's handler, and `expand` (comma-separated services) to draw those services function by function. Steps a harvester marked `origin: "frontier"` are folded into one message per function (`kind: "frontier"`, label "frontier: N steps", `frontierSteps: N`) that does not count toward `maxMessages`; `frontier=1` (MCP `frontier: true`) shows them instead, each tagged `origin: "frontier"`. A step with no target that the harvester classified (`kind: "leaf"`, or a `call` with an `operation` or `note`) is a `kind: "leaf"` self-message on its function, not a gap, and is not counted unresolved. Each message carries `seq`, `target` {service, ingress, fn}, `store` or `calls`, and the trace has `code`: the source link of every function on it.

Example: `samples/dtos/prod.json` (loaded by `npm run seed`).

## Inventory and detail views

| Method and path | What |
|---|---|
| `GET /api/envs/:env/inventory` | every object `{type: service \| channel \| store \| event, id, label, kind, group, team, connections, size, problems, hasDto}` (`hasDto` is set on event types: whether a message DTO exists) |
| `GET /api/envs/:env/stores/:key` | a data store: `readers`, `writers`, `clients` (rows as in `/clients`), `uses` (service, functions with code `source` and operations with `access` (`read`, `write` or `read_write`) and, when the step has them, `fields`), `entryPoints` that reach it, `siblings` in its group, `schemas` |
| `GET /api/envs/:env/clients` | how services reach data stores (#27): `{rows, counts}`. Query (all optional): `store` (bind key, or a cluster such as `redis:cache-main`), `service`, `driver` (package, or `package@major` as in the Inventory facet; `pkg@` = version not reported; matches the service's own driver or the one inside its lib), `driverMajor`, `lib`, `accessMode`, `via` (substring of a wrapper function, file or lib). `rows[]`: `{store, kind, service, entity: resource \| egress, id, accessMode, accessId, driver, lib, drivers: [{package, version, major, from: own \| lib}], via (linked hops), mixed: [{package, majors}], unresolved: [field]}`. `counts[]`: `{driver, major, label: "ioredis 4.x", services, clients}`, a service with two drivers counts under both |
| `GET /api/envs/:env/channels/:key` | a topic/queue/exchange/bus: `publishers`, `feeds`, `subscriptions` (with `events` filter (entries starting with `!` exclude a type or glob), `conflict`), `consumers`, `events` passing through, `problems`, `definedBy` and `flow` (below) |
| `GET /api/envs/:env/events/:type` | an event type: producers, consumers, `deliveries` (route `via`, handler), `problems`, `dto` and `flow` (below) |

### Channel `flow`

`flow` is what the channel page draws, computed in `core/channel-flow.ts` so agents (MCP `get_channel`)
get the same answers. It is additive: the older fields are unchanged.

- `layout`: `fanout` for a topic, bus or exchange (rows are its subscriptions) or `inbound` for a queue
  (rows are what feeds it).
- `rows[]`: one per real subscription. The declarations of every manifest are merged by (from, to).
  `{id, from, to, filter, direct, consumers}`. `from` and `to` are `{key, name, kind, known, eventTypes}`
  (`from` is null when publishers send straight into the queue; then `direct` lists them).
  `filter` is `{events, declarations, agree, differs}`: `declarations` has one entry per source
  (`service`, `id`, `events`, `at` code link, `verified`); when they do not `agree`, `differs` names the
  field (`filter`) and `events` is the union of the claims. Filter entries starting with `!` exclude.
  `consumers[]` are the readers of `to`: `{service, ingress, handler, handles: {all, types}}`.
- `consumers[]`: the readers of this channel itself (a queue's consumers).
- `grid`: event type by destination. `destinations[]` is `{rowId, queue, consumer}` (a queue nobody
  reads has `consumer: null`); `rows[]` is `{type, producers, cells}` with one cell per destination:
  `{status: handled | no-handler | filtered | no-consumer, handler, uncertain, why, possible?}`. `possible` is set when
  the event type is only a candidate (the publisher could not say which of several it sends; such rows have
  `possible: true` too, and are never counted as problems). `uncertain` means
  the answer depends on which of the disagreeing declarations is right; `why` says so in words.
- `summary`: `{text, segments: [{t, b?}], callouts: [{text, rowId, level: bad | warn | info}]}`. One sentence,
  plus one callout per problem; `rowId` is the `rows[].id` the callout is about, or null. `bad` is a delivery that arrives with no handler (red in the UI).

### Event type `flow`

`flow` is what the event page draws (`core/event-flow.ts`; MCP `event_types` with `type` returns it too).
Additive: the older fields are unchanged. Outcomes agree with `deliveries` and `problems`.

- `groups[]`: one per producer service, confirmed first. `{producer, possible, callSites, targets}`.
  `possible` is true when every call site only lists this type as one of several candidates.
  `callSites[]` is `{egress, bindKey, at (code link), possible, to: [node], candidates}`.
- `targets[]`: `{topic, direct, possible, rows}`. `topic` is the first topic or bus the producer sends
  to (a node `{key, name, kind, known}`), or null with `direct: true` for a send straight to a queue.
- `rows[]`: one per queue and consumer service: `{id, queue, via, filter, consumer, ingresses, outcome, ifSent?}`.
  `via` lists topics between the target's topic and the queue; `filter` is the merged subscription
  filter (same shape as in the channel `flow`) or null. `ingresses[]` is `{id, bindKey, handler,
  ingressHandler, outcome, any, handles, code, at}`: `handler` is null when it lists event types and none
  matches, `any` means it accepts any type, `code` links the handler.
- `outcome`: `handled`, `no-handler` (arrives, no handler), `possible` (only a candidate producer sends it;
  `ifSent` says what would happen), `no-reader` (the queue has no harvested consumer) or `filtered`
  (a subscription on the way does not let the type through). Filtered rows are kept for agents; the
  UI does not draw them and the summary does not count them.
- `unresolved[]`: `{service, egress, reason, detail, at}` for call sites with no resolved target.
- `unfed[]`: targets (same shape) of consumers that list this exact type while no harvested producer reaches them.
- `summary`: as in the channel `flow`.

## Redis instances and keys (0.16.0, #29)

An instance is the cluster or server in a bind key's group (`redis:cache-main` groups `redis:cache-main/order:{id}`); an infra harvester may define it with a resource whose `bindKey` is just `redis:cache-main` (`details`: `engineVersion`, `nodes`, `topology` cluster | standalone, `databases`). Inventory lists one row per instance (`instance: 'cluster' | 'instance'`, id = the instance key) instead of one per key pattern. `:id` below is the instance key (URL-encoded), the id of the defining infra resource, or the bare name (`cache-main`).

| Method and path | What |
|---|---|
| `GET /api/envs/:env/instances` | `[{key, name, topology, team, services, databases, templates, problems}]` |
| `GET /api/envs/:env/instances/:id` | the page: `definition` {service, id, source, verified}, `engineVersion`, `nodes`, `lanes` (per service: `access` read \| write \| read_write \| unknown and `accessFrom` declared \| steps \| keys, `clients` as in `/clients`, `databases`), `stores` (key patterns), `keys` {source pushed \| inline \| none, version, pushedAt, summary, lazy}, `callouts` |
| `PUT /api/envs/:env/resources/:id/keys` | full replace of the instance's key templates. Body `{keys: [...], version?, producer?}` or the bare list. 400 with per-entry `details` (`index`, `field`) and nothing stored on any bad entry; 404 unknown instance; 409 `STALE_VERSION` when a given `version` is not above the stored one (without `version` the server adds 1). Returns `{instance, version, pushedAt, entries, summary}` |
| `GET /api/envs/:env/resources/:id/keys` | the grouped list. Query: `db` (index), `q` (substring), `problems=1`. `{instance, source, version, pushedAt, producer, summary, shown, groups}`; `summary` {templates, services, writers, shared, unwritten, ttlDisagreements, dbs: [{db, templates, problems}], problems} always counts every db. `groups`: `unwritten` (No harvested writer) and `shared` first, then one `owner` group per writing service; each row: `keyTemplate`, `dbIndex`, `commands`, `writeCommands`, `opsPerHour`, `ttl` {seconds, values, disagree}, `writers` / `readers` (service, access, commands, opsPerHour, ttlSeconds), `problem` {kind no-writer \| ttl-disagree, why, follows}, `flows` |

Key entry: `{keyTemplate, dbIndex = 0, commands[], service, access?, opsPerHour?, ttlSeconds?}`, one per service that uses a template in a db. `access` is `read`, `write` or `read_write` (default: from the commands; any write command makes the service a writer). `ttlSeconds` is the TTL the service sets (leave it out when there is none or it is unknown). Duplicates (service, db, template) are rejected. Up to 50 000 entries per instance. The older names `key_template`, `db_index`, `command_kinds`, `op_count`, `ttl` and `services: []` are accepted.

An owner is the service that writes a template. A template with several writers is one row in the `shared` group; with two different `ttlSeconds` it is a `ttl-disagree` problem. A template no entry writes is `no-writer`. `flows` come from resource steps whose `details.keyTemplate` equals the template and whose resource is on the instance: the entry points that reach the step, the function chain, the operation (`SET + EX 3600` when the step has `details.ttlSeconds`) and `access` of the step. Without a pushed list the interim inline `details.keys` of the instance's resources is read (`source: inline`); `details.lazy = {kind: 'keys', ref}` is kept and returned as `keys.lazy`.

MCP `get_resource_keys(env, resourceId, dbIndex?, query?, problems?)` returns the same list as the GET.

## Data-store schemas

One schema per store key and source (`code`, `db`, `manual`). The store must exist (404).

| Method and path | What |
|---|---|
| `GET /api/envs/:env/schemas?key=` | stored schemas |
| `POST /api/envs/:env/schemas` | bulk `{schemas: [{key, source = 'code', content}]}`, all or nothing (201) |
| `PUT /api/envs/:env/schemas/:source/:key` | body is the schema JSON |
| `DELETE /api/envs/:env/schemas/:source/:key` | remove one |

Example: `samples/schemas/prod.json` (loaded by `npm run seed`).

## Bugs

Bugs are about Flow-Mapper itself. Each records the version it was seen in (`appVersion`,
defaults to the running version) and, once fixed, the version the fix ships in.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/bugs?open=true&status=&priority=&severity=&service=&version=&q=` | sorted by priority, then impact |
| GET | `/api/bugs/stats` | counts by status, priority, severity, version |
| POST | `/api/bugs` | `{title, description?, steps?, severity: S1..S4, appVersion?, env?, reporter?, channel: api\|web\|mcp, links?: [{type, service?, id}], priority?}` |
| GET | `/api/bugs/:id` | with links, attachments, comments, `allowedTransitions`, `needsVerification` |
| PATCH | `/api/bugs/:id` | `{status?, severity?, priority? (null = use suggested), assignee?, fixedInVersion?, resolution?: {type: code\|map-data\|config\|none, ref?, note?}, links?}` |
| POST | `/api/bugs/:id/comments` | `{author, body}` |
| POST | `/api/bugs/:id/attachments?filename=run.log` | raw body, up to 5 MB; returns suggested map links found in the text |
| GET | `/api/bugs/:id/attachments/:attachmentId` | the file |

Workflow: `open → triaged → in_progress → fixed → verified → closed` (plus `wont_fix`, `duplicate`,
and reopen paths). Moving to `fixed` requires `fixedInVersion` and `resolution`. A fixed bug shows
`needsVerification: true` once the running version is at or above `fixedInVersion`.

Priority: severity weight (S1 4 … S4 1) plus impact boost (0 if no flow passes through the linked
entities, 1 if any does, 2 if at least a quarter of all flows do). 5+ is P0, 4 P1, 3 P2, else P3.
Setting `priority` overrides the suggestion; `priority: null` returns to it.

## Flow descriptions (0.14.0)

Every flow has a description of what it is for, and each service in it can have one for its part. Two records per key,
`source` = `human` | `ai`; neither overwrites the other. Key: `env` + `service` + `ingress` (the whole flow: the entry
point that starts it) and optionally `callee` (a sub-flow: the service name, or `service:handler` for one delivery).
Stored in `descriptions` (migration `003_descriptions.sql`, kept when a service is re-harvested).

| Method + path | |
|---|---|
| `GET /api/envs/:env/descriptions?service=&ingress=` | `{service, ingress, hash, flow: {human, ai}, callees: {<callee>: {human, ai}}}`. `human` is `{text, editedBy, editedAt}` or null; `ai` is `{text, model, generatedAt, traceHash, outdated}` or null. `hash` is the hash of the flow's current trace; `outdated` is true when an AI record was written from a different trace (the flow changed since). 404 for an unknown ingress |
| `PUT /api/envs/:env/descriptions` | writes the **human** record: `{service, ingress, callee?, text, editedBy?}`. Empty `text` removes it. Max 4000 characters. Returns the flow's descriptions. There is no REST write for the AI record |

The trace hash (`core/description.ts` `traceHash`) is a 53-bit hash over each message's depth, kind, endpoints, label,
transport, event, target, store and call (trace options: scope full, 2000 messages). For a callee it covers only the
messages that touch that service, so changing one branch does not outdate the others. It is stable across reloads.
`trace_flow` over MCP (with `ingress`) and `get_service` carry the descriptions too (below); `GET /trace` does not,
read them with the endpoint above.

## MCP

- HTTP: `POST /mcp` with one JSON-RPC 2.0 message (MCP streamable HTTP, JSON responses).
- stdio: `npm run mcp` (same database, `FLOW_DB`).

Tools: `search`, `list_services`, `get_service`, `list_entry_points`, `trace_flow`, `find_paths`,
`link_health`, `changelog`, `set_description`, `ingest_manifest`, `upsert_entity`, `delete_entity`, `get_endpoint_info`,
`load_dtos`, `event_types`, `inventory`, `get_store`, `get_channel`, `load_schemas`, `list_bugs`,
`get_resource_keys` (0.16.0), `list_clients` (same filters and result as `GET /clients`; `get_store` also returns `clients`), `get_bug`, `report_bug` (accepts `log` text), `update_bug` (accepts `comment`).
`set_description(env, service, ingress, callee?, text, model)` (0.14.0) saves the **AI** description of a flow (no `callee`) or of one service in it. It writes the AI record only, never the human one; it stores `model`, the time, and the hash of the flow's trace as it is now. `model` and `text` are required; the entry `ingress` must exist; `callee` must name a service of the env. It returns the flow's descriptions (as `GET /descriptions`). `trace_flow` with an `ingress` returns `descriptions` next to the trace, and `get_service` returns `descriptions`: every record of that service's flows `{ingress, callee, source, text, by, at}`, so an agent sees what is already written before it writes. The UI's "Generate…" dialog hands out two prompts (the whole flow with all its services; one service) that tell an AI tool to call `trace_flow`, `get_service` and then `set_description`.
`trace_flow` and `GET /trace` messages of steps that are alternatives (steps of one function with the same `altGroup`, else consecutive steps with the same `source` file:line that each carry a `condition`) carry `alt: {group, branch, of}`: `group` is `<function>:<altGroup>` (or `<function>:<file>:<line>@<first seq>`), `branch` the 1-based branch (one per distinct condition, in order of first appearance), `of` the number of branches; the message keeps its `condition`. The messages a branch's step leads to (the topic, queues and consumers of a publish, which carry the same `alt`) and everything below it in the call tree (messages deeper than the group) belong to that branch; every branch is followed. `maxMessages` counts the largest branch of a group, not the sum; `flows/counts` counts each component once, as it always did. The UI draws an alt frame around the group.
`trace_flow` and `GET /trace` messages of an egress step with `eventFrom` (the step's event type comes from the nearest enclosing call step's `bind` of that name on the traced path) carry `event` as usual plus `eventFrom: {name, boundAt}`; `boundAt` is `<caller function name>:<seq>` and is absent when nothing on the path binds the name (the publish then behaves as one that names no event). `flows/counts` cannot follow binds per path: for such a step it uses every value that call steps bind to the name on a call path reaching the step's function, in the same service (a name bound in another service never counts; #44), plus the egress's events and candidates, so a count can include components a trace through one caller does not draw. Event reports and channel views list those bound values among the egress's events. Manifest: `bind: {name: value}` on `call` steps, `eventFrom: name` on egress steps; contract rule `eventfrom-unbound` (info).
`trace_flow` and `GET /trace` messages of an SNS fan-out (a publish that reaches several links) carry `group` (id of the publish, `m<index of its message>`), `deliveries` (on the publish: how many follow) and `delivery` (1-based ordinal, on the topic -> queue and queue -> consumer messages of one delivery). A single-queue send has none of them. The UI draws an activation bar on the topic and labels the rail `depth.delivery` (3.1, 3.2, ...); call `depth` is unchanged. Order (0.9.4): the publish is followed by all its deliveries (topic -> queue -> consumer, one after another); only then come the consumers' own messages (calls, stores, publishes, nested deliveries), delivery 1's subtree first, then delivery 2's. Nothing sits between two deliveries, so the bar covers exactly the delivery rows. Before 0.9.4 each consumer's subtree sat between its delivery and the next.
`trace_flow` and `GET /trace` (0.12.0, #31): an ingress with `middleware: [fnId, ...]` (functions of the same service, optional, ordered; `details.middleware` stays untraced) is traced as the middleware functions in order, then the handler, each an ordinary function visit at the handler's depth. Every message made by a middleware, or by a function it calls, carries `middleware: {fn, index}` (`index` is the 0-based position in the chain); the handler's own messages and every other service's carry none. The message that reaches the ingress (`entry`, `egress`, `deliver`) carries `middlewareChain: [{fn, name}]` (also for a middleware with no steps; not on a repeat, nor on a service that `scope=intra` does not expand). The middleware's calls are the service's own outgoing calls, so they are system-map edges, link-health entries and `flows/counts` components; with `scope=intra` they are the service's outgoing calls. An ingress without `middleware` traces unchanged. `GET /views/service` ingress and `GET /entry-points` rows carry `middleware` when set.
`get_service` takes an optional `via` (substring of a wrapper function or file) to keep only egress that goes through it; its egress, `trace_flow` messages and `get_endpoint_info` producers carry `via`; ingress carries `via` (handler resolution) and `trace_flow` messages `handlerVia`, plus step code links in `code`; `get_service` functions carry `unresolved`.
`trace_flow` and `GET /trace` expand each delivery once per trace (#43). A delivery is keyed by consumer service, ingress, handler and event type (the matched types for an untyped publish). The first one in trace order is expanded; later ones, under a sibling or in another alt branch, are still drawn (the publish, topic and queue legs, and the delivery arrow) but nothing below them is. That delivery message carries `repeatOf: N`, the 1-based step (position in `messages`) of the first, and ends its label with `↩ seen at step N`. Repeats do not count toward `maxMessages`. A delivery whose handler is already on the path stays a `cycle: true` message, not a repeat. `flows/counts` is unaffected (it counts each component once).
