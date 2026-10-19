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
| `GET /api/envs/:env/views/service/:service` | ingress with callers, egress with targets, resources, functions |
| `GET /api/envs/:env/entry-points` | where flows start |
| `GET /api/envs/:env/trace?service=&ingress=\|fn=&scope=intra\|full&maxDepth=&maxMessages=` | participants and ordered messages |
| `GET /api/envs/:env/paths?from=&to=&limit=` | service-level paths, including through queues |
| `GET /api/envs/:env/search?q=&limit=` | services, functions, endpoints, channels, resources |
| `GET /api/envs/:env/health` | link-health totals, per-service numbers, broken items (including the event checks: `unhandledEvents`, `undeliveredEvents`, `neverArrives`, `declaredNotSeen`, `subscriptionConflicts`; the store checks `multipleWriters`, `unusedStores`; and what harvesters report: `unresolved` (on ingress, egress, steps and resources; with reason, candidates and their possible matches), `mixedCommits`, `drift`) |
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

Writing a role the endpoint does not take is a 400. DTOs are loaded through
these routes, not the manifest, so re-harvesting a service keeps them; deleting the service removes
them. Writes check that the endpoint exists (404) and the role is valid (400). The ingress id is the
last path segment and may contain `/`.

| Method and path | What |
|---|---|
| `GET /api/envs/:env/endpoints/:service/:ingress` | `{ingress, method, handler, source: {repo, url, ref, file, line}, slots: [{role, label, dto, stale}], note}`; `source.url` opens the handler's file and line at the harvested commit; `stale` means the DTO was loaded before the service was last harvested |
| `GET /api/envs/:env/dtos?service=&ingress=` | stored DTOs |
| `POST /api/envs/:env/dtos` | bulk load `{dtos: [{service, ingress, role, content}]}`, all or nothing (201) |
| `PUT /api/envs/:env/dtos/:service/:role/:ingress` | body is the DTO JSON; replaces an existing one |
| `DELETE /api/envs/:env/dtos/:service/:role/:ingress` | remove one |

An ingress that lists `events` takes no endpoint DTO: its messages are described per event type.

## Event types

| Method and path | What |
|---|---|
| `GET /api/envs/:env/events` | every event type with producers, consumers (after subscription filters) and `hasDto` |
| `GET /api/envs/:env/events/:type` | one event type with its Message DTO |
| `PUT /api/envs/:env/event-dtos/:type` | body is the message JSON; replaces an existing one. Patterns (`*`) are a 400 |
| `DELETE /api/envs/:env/event-dtos/:type` | remove it |

`POST /api/envs/:env/dtos` also takes event DTOs as `{event, content}` items, mixed with endpoint
DTOs. `GET .../endpoints/:service/:ingress` returns `events`: one row per event type at that
consumer with `handler`, `pattern` (the glob that matched), `status` (`ok`, `unhandled`, `never`,
`declared-only`), `producers` (`derived`, `declared`, `harvested`), the handler's `source` link
and the `dto`. `GET .../trace` takes `event` to start from that event type's handler, and `expand` (comma-separated services) to draw those services function by function. Each message carries `seq`, `target` {service, ingress, fn}, `store` or `calls`, and the trace has `code`: the source link of every function on it.

Example: `samples/dtos/prod.json` (loaded by `npm run seed`).

## Inventory and detail views

| Method and path | What |
|---|---|
| `GET /api/envs/:env/inventory` | every object `{type: service \| channel \| store \| event, id, label, kind, group, team, connections, size, problems, hasDto}` (`hasDto` is set on event types: whether a message DTO exists) |
| `GET /api/envs/:env/stores/:key` | a data store: `readers`, `writers`, `uses` (service, functions with code `source` and operations with `access`), `entryPoints` that reach it, `siblings` in its group, `schemas` |
| `GET /api/envs/:env/channels/:key` | a topic/queue/exchange/bus: `publishers`, `feeds`, `subscriptions` (with `events` filter (entries starting with `!` exclude a type or glob), `conflict`), `consumers`, `events` passing through, `problems`, `definedBy` and `flow` (below) |
| `GET /api/envs/:env/events/:type` | an event type: producers, consumers, `deliveries` (route `via`, handler), `problems`, `dto` |

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
  `{status: handled | no-handler | filtered | no-consumer, handler, uncertain, why}`. `uncertain` means
  the answer depends on which of the disagreeing declarations is right; `why` says so in words.
- `summary`: `{text, segments: [{t, b?}], callouts: [{text, rowId, level: warn | info}]}`. One sentence,
  plus one callout per problem; `rowId` is the `rows[].id` the callout is about, or null.

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

## MCP

- HTTP: `POST /mcp` with one JSON-RPC 2.0 message (MCP streamable HTTP, JSON responses).
- stdio: `npm run mcp` (same database, `FLOW_DB`).

Tools: `search`, `list_services`, `get_service`, `list_entry_points`, `trace_flow`, `find_paths`,
`link_health`, `changelog`, `ingest_manifest`, `upsert_entity`, `delete_entity`, `get_endpoint_info`,
`load_dtos`, `event_types`, `inventory`, `get_store`, `get_channel`, `load_schemas`, `list_bugs`,
`get_bug`, `report_bug` (accepts `log` text), `update_bug` (accepts `comment`).
