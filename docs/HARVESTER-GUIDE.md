# Writing a Flow-Mapper harvester

> After every `git pull`, read [CHANGELOG.md](CHANGELOG.md) for what changed for harvesters and importers.

A harvester reads one system (a service's code, or the infrastructure) and pushes what it found
to Flow-Mapper as a **manifest**. Flow-Mapper treats harvested data as the source of truth and
links services together by matching **bind keys**, so the one thing that matters most is that both
sides of a call produce the same key.

Contract files: [`schema/manifest.schema.json`](../schema/manifest.schema.json) (the format),
[`docs/API.md`](API.md) (endpoints and errors). Worked examples: [`samples/`](../samples):
`orders-svc.json` (a typical service), `catalog-svc.json` (50 endpoints, events), `infra.json`
(topics, queues, buses, subscriptions), `samples/dtos/` and `samples/schemas/`.

## Kinds of harvester

| Harvester | Reports | `service.kind` |
|---|---|---|
| Service (one per repo) | functions and their steps, ingress, egress, data stores, event types, DTOs, store schemas | `service`, `gateway` or `lambda` |
| Client application (agent, mobile app) | egress only: the calls it makes | `client-app` |
| Infrastructure (IaC, AWS APIs) | topics, queues, exchanges, event buses, and the subscriptions/rules between them | `infra` |

## The loop

1. Build the manifest (below). Use `kind: "full"` the first time and whenever in doubt.
2. Validate without writing: `POST /api/ingest?dryRun=1`. It runs every check (schema, internal
   references, version) and returns the changes it would make, plus a `contract` report (below).
   Nothing is stored.
3. Send it: `POST /api/ingest`. Several at once: `{"manifests": [ ... ]}`.
4. Push DTOs and store schemas (separate endpoints, below).
5. Check the result: `GET /api/envs/{env}/health`. Calls with no match are almost always bind
   keys that differ between caller and callee.

```sh
curl -sS -X POST "$FLOW/api/ingest?dryRun=1" -H 'content-type: application/json' --data @manifest.json
curl -sS -X POST "$FLOW/api/ingest"          -H 'content-type: application/json' --data @manifest.json
```

**Contract report.** Every ingest result (dry or real) has `contract: {errors, warnings, infos,
findings}`; each finding is `{level, code, service, kind, id, message, fix}`. It never rejects
anything. There are currently no `error`-level codes (422 rejections come from validation, above); read the `warn`s, `info` is for completeness. A batch (`{"manifests": [...]}`) is applied in one transaction: all or nothing, and each contract is judged against the env after the whole batch.

| Code | Level | Means | Fix |
|---|---|---|---|
| `unresolved-no-detail` | warn | an `unresolved` entry (on ingress, egress, function, step or resource) with an empty `detail` (or blank `reason`) | say what you could not resolve |
| `unresolved-detail-unknown-path` | warn | `unresolved` what `detail` whose `detail` is not one of `details.databases`, `client.databases`, `details.keyTemplate`, `details.dbIndex`, `details.ttlSeconds` | use one of those paths (the entry is kept, never rejected) |
| `assumed-and-unresolved` | warn | one field listed both in `unresolved` and in `assumed` (an assumed value is a value) | keep the `assumed` entry and drop the `unresolved` one, or the other way round |
| `client-version-gap` | info | a `client` with a driver or lib but no version, and no `unresolved` entry saying why | send the version, or `unresolved: [{what: "client", reason, detail: "driver.version"}]` |
| `client-unresolved-field` | warn | `unresolved` what `client` whose `detail` is not a client field path | name the field: `accessMode`, `accessId`, `driver.version`, `lib.version`, `lib.driver.version`, `via` |
| `field-not-in-ddl` | info | store steps whose `fields` carry `inDdl: false` (one finding per service) | add the field to the schema or the DTO, or remove it from the code |
| `binding-empty-events` | warn | subscription with `events: []`: delivers nothing | send the types it lets through, or omit `events` |
| `missing-source` | info | ingress/egress without `source.file`, or steps of a function without `file` (one finding per service) | send `source: {file, line}`, and `file` on functions |
| `binding-no-events` | info | SNS/EventBridge subscription without `events`: everything is delivered | send the filter policy as `events`, or `"*"` |
| `egress-no-events` | warn | publish to a topic/bus without `events` (or event `unresolved`): subscriber filters cannot be applied | send `events`, or `unresolved` what `event` with `candidates` |
| `eventfrom-unbound` | info | an egress step with `eventFrom` whose name no call step binds | add `bind` to the calls that reach it, or drop `eventFrom` |
| `dangling-egress` | warn | `bindKey` matches no ingress or channel in the env | fix the key to match the callee; ignore if the callee is not harvested yet |
| `filter-matches-nothing` | warn | subscription `events` match none of the types published to its source | fix the filter or the publisher's `events` |
| `mixed-commit` | info | items scanned at a commit other than the manifest's | scan at one commit, or set `source.commit` |
| `drift` | info | item you marked `provenance.verified: drift` | align code and live system |

| Error | Status | Do this |
|---|---|---|
| `INVALID` | 422 | `details` lists each problem with a JSON path; fix and resend |
| `VERSION_NOT_NEWER` | 409 | `version` must be greater than the stored one (`details.currentVersion`) |
| `VERSION_MISMATCH` | 409 | your delta's `baseVersion` is stale; send a full manifest |
| `NOT_FOUND` | 404 | a delta for a service never ingested; send a full manifest |

**Versions.** `version` is an integer that only grows: a CI build number or a commit count works.
`harvestedAt` is when you ran (ISO time). `commit` is the commit you read; Flow-Mapper builds code
links from `service.repo` + `commit` + each item's `file` and `line`.

**One commit per service.** Scan every layer of a service (routes, outgoing calls, producers, flows)
at the same commit and put it in `commit`. If one item really was read at another commit, set
`commit` on that function or `source.commit` on that item; its code link then uses it, and the
service is flagged "mixed commits" in link health so it is visible.

**Full or delta.** A full manifest replaces everything Flow-Mapper knows about the service. A
delta (`kind: "delta"`, `baseVersion`, `upsert`, `delete`) patches it; send one only when you know
the version you last sent was accepted.

## Manifest skeleton

```json
{
  "schemaVersion": "1.0",
  "kind": "full",
  "env": "prod",
  "service": { "name": "orders-svc", "kind": "service", "team": "checkout", "groupPath": "platform",
               "repo": "github.com/acme/orders-svc", "language": "typescript", "description": "Order lifecycle", "about": "## Capabilities\n- Owns the order lifecycle" },
  "version": 12,
  "harvestedAt": "2026-10-19T08:00:00Z",
  "commit": "fb390dc",
  "functions": [], "ingress": [], "egress": [], "resources": [], "channels": [], "bindings": []
}
```

`service.name`: lowercase letters, digits and `-`, the same name other services use to call it.

`service.about` (0.30.2, optional): a rich description of the component, Markdown-lite, at most 20 000 characters (`##` headings, `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `- ` / `1. ` lists, `[text](https://...)`; no HTML). Sections by convention: `## Capabilities`, `## Motivation`, `## Roles and responsibilities`, `## Owners`, `## Open questions`. Do not repeat status, doc `links` or related flows. It is shown in the component's panel and diffs like any header field. Leave it out when the code has nothing to say: harvested data is the source of truth, so do not generate prose from guesses.

Two optional service fields (0.21.0): `groupPath` is the subsystem the service belongs to (`platform`, later `platform/identity`; lowercase path segments). Most harvesters leave it out; design environments set it. `kind: "client-app"` is for a device or browser application that calls services (an agent, a mobile app): send its egress and no ingress.

Design environments: harvesters only write to sealed environments. Posting a manifest, DTOs, schemas or Redis keys to a design environment is refused with `409 ENV_DESIGN`; a name that does not exist yet is created sealed, as before.

## What to extract from a service

**Functions**: every function that handles a request or is on the way to an outgoing call or a
data store. `id` is stable across harvests (e.g. `OrderService.place`), `file` is relative to the
repo root, `line` is where the function starts.

**Steps**: inside each function, in source order (`seq` 1, 2, 3…), what it does that matters:

| `type` | `target` | Also |
|---|---|---|
| `call` | another function `id` in this service | |
| `egress` | an egress `id` | `operation`; `event` when it publishes an event type |
| `resource` | a resource `id` | `operation` (`find`, `insertOne`, `GET order:{id}`, `PutItem`…); `access: "read"`/`"write"`/`"read_write"` when the operation name does not say (`read_write` for `findOneAndUpdate` and the like; shown as R/W, the service counts as reader and writer); `fields` (below) |

**Fields of a resource step** (optional): `fields: [{"role", "path", "operator"?, "inDdl"?, "ddlRef"?, "flag"?}]`
lists the fields the call touches, names only, never values. `role` is `filter`, `projection`, `update`
or `sort`; `operator` is e.g. `$in`, `$set`, `asc`; `inDdl: false` marks a field the code uses that is not in the
collection's schema (the store page flags it, and the contract report counts it as `field-not-in-ddl`);
`ddlRef` links the schema field (e.g. `Order.status`); `flag` is a free-text remark. The store page lists the
fields per function and operation, the trace's side panel shows them on the step, and MCP `get_store` and
`GET /api/envs/:env/stores/:key` return them under each operation.

Optional on any step: `condition` (it only happens if…), `loop: true`, `mode: "async"`, `note`, and
`source: {"file", "line", "col"}`, the exact place in code that makes this call (same shape as the
`source` of ingress and egress). The trace's side panel shows it as a code link "Called at".
Every `target` must exist in the same manifest, or the manifest is rejected, except for the two cases below.

**Alternatives** (`altGroup`): when only one of several steps happens per call (the event type is picked
inside the function from a static map, a `switch`, an if/else chain), mark them as alternatives. Give the
steps the same `altGroup` string (any name, unique within the function) and a `condition` each:
`{"seq": 1, "type": "egress", "target": "publish10", "condition": "nextPriority == 10", "altGroup": "next-priority"}`.
The flow is drawn as one UML-style alt frame with a section per condition (several steps with the same
condition share a section; add a `call` step with that condition to hang a downstream call on one branch)
and a dashed line between sections; the trace marks each message `alt: {group, branch, of}`. Without
`altGroup`, consecutive steps of a function that share the same `source` file:line and each carry a
`condition` form a group anyway, so a harvester that already sets `source` and `condition` needs nothing
more. A group needs two different conditions. Counts and `maxMessages` treat the branches as alternatives,
not as a sequence. Steps without `altGroup` or a shared `source` are drawn in sequence with an "if …" tag, as before.

**Per-caller event types** (`bind`, `eventFrom`): when a publish sits in a shared function and its event type is
a parameter, each caller passes its own constant, and one `event` on the step would be wrong for all but one
of them. Put the value on the call and read it at the publish:
`AgentInfoHandler.ts:150` calls `requestForcedDisconnection(AgentDisconnectEventType.ENTRY_DOES_NOT_EXIST)` and `:78` calls it with
`SCHEMA_VALIDATION_VIOLATION`; the publish at `:483` sends `eventName`. Manifest:
`{"seq": 1, "type": "call", "target": "requestForcedDisconnection", "bind": {"event": "entry.does.not.exist"}}` in the
first caller, `... "bind": {"event": "schema.validation.violation"}` in the second, and in the shared function
`{"seq": 1, "type": "egress", "target": "agentInfo.publishDisconnect", "eventFrom": "event"}`. The name (`event`) is
yours; values are event type strings. A trace takes the event of the nearest enclosing `bind` of that name on the
path it walked (an inner call's bind wins; binds are not passed across a publish into another service), shows it on the
message with where it came from (`eventFrom: {name, boundAt: "<caller fn>:<seq>"}`), and delivers only to
subscriptions that let it through. A path that binds nothing is treated as a publish that names no event: the egress's
`events` and `unresolved` candidates decide, or the trace stops at the topic. Do not use `condition` alternatives for
this: the trace would follow both. Keep sending `unresolved: [{"what": "event", ...}]` on the egress if you want it
reported; Flow-Mapper does not drop it. Flow counts cannot follow a bind per path: for an `eventFrom` step they use every value
any call step binds to that name, so a count can include more than the trace through one caller. The contract report says
`eventfrom-unbound` (info) when no call step binds the name.

**Frontier steps** (`origin`): call trees that reach no sink (a flow that ends in the service) can be
large. Mark the steps of such a tree `origin: "frontier"`; the steps on the way to a cross-service hop
or a data store stay unmarked (or `origin: "path"`, the default, which behaves exactly as before).
Traces fold frontier steps into one marker per function, "frontier: 23 steps" (this function's frontier
steps plus those of the frontier calls below it), and do not count them toward `maxMessages`. The flow page
shows the marker; click it (or tick "Frontier steps") to expand. The trace API takes `frontier=1` and
MCP `trace_flow` takes `frontier: true`. Frontier steps still count for the service view, health and
stores; only the trace folds them.

**Classified leaf steps**: a step that ends the tree and has no target, such as a database call in a
library, a Redis call you cannot map to a store yet, or an external package. Send `type: "call"` with
`kind: "leaf"` (or just an `operation` or `note`) and no `target`, and say what it is:
`{ "seq": 4, "type": "call", "kind": "leaf", "operation": "findOne", "note": "db_access: Order.findOne" }`.
It is shown as a self-call note in traces, and is not `unresolved`: it does not count in link health or
the contract report. Use `unresolved` (what: `target`) only for a call you could not classify.

**Unknown DB instance.** When a resource's collection is known (`bindKey` set) but the DB instance id is not yet (e.g. Mongo cluster and db known as text, instance id comes later), send `unresolved: [{"what": "instance", "reason": "instance_id_null_until_MG-b", "detail": "p81/p81-production"}]` and keep the `bindKey`. Unlike `target`, this does not touch the store key: the resource still groups with the same collection's other users and schemas still attach. The store page shows "Instance unknown: <reason> (<detail>)", health lists it under Unresolved (kind resource, what instance). `details.instance = {id: null, text, reason}` is still read as a fallback.

**Ingress**: every way into the service: HTTP routes, RPC methods, queue consumers, crons.
`handler` is the function that runs. Mark public routes and crons `entryPoint: true` (nothing
inside the system calls them). Put `method` and `path` in `details` for HTTP.

When the handler is not a direct reference (a consumer registered with a context object, or
`x.m.bind(x)`), describe how it was resolved with `via` on the ingress: the same hop shape as the
egress `via` above (`{ "function", "file", "line", "kind" }`), with `kind` `"registration"` or
`"bind"`, ordered from the registration to the handler. The UI shows the same "via" chip on the
ingress row, the endpoint panel and the start of the trace. Hops are display data only. Sending it
as `details.handlerVia` still works.

**Socket events (0.17.4).** A client that keeps a TLS, TCP or WebSocket connection open and sends events
over it (device connect, channel open, ...) is not HTTP and not a queue. Send one ingress per event with
`"transport": "socket"`, a `bindKey` you choose (`socket:tls/sdp-controller/device-connect`; nothing in
the system produces to it, so it is never matched) and `details: {"protocol": "tls" | "tcp" | "ws", "event": "<name>", "port": 8443}`
(all optional; `protocol` defaults to tcp). Alternatively one ingress with `events` per event type. A socket ingress is an entry point by
default (no `entryPoint: true` needed; `entryPoint: false` turns it off) and `middleware` works as for HTTP.
In a trace the caller is outside the system: "client · tls socket". The system map and Flows show it in its own colour.

**Middleware (0.12.0).** A route runs middleware before its handler (Express/Fastify `use`, auth, rate
limit), and middleware can make calls of its own (an auth RPC). List them on the ingress, in the order
they run: `"middleware": ["authenticate", "rateLimit"]`. The ids are functions of the same manifest
(same rule as `handler`; an unknown id is rejected with 422 like a bad handler). Those functions carry
their own steps as usual. Flow-Mapper traces them before the handler, as ordinary function visits: their
calls are real messages, system-map edges and link-health entries, and the Flows page draws them as a
segment on top of the service's bar. Optional: an ingress without it traces exactly as before.
`details.middleware` is still accepted, but it is display data and is not traced.

**Egress**: every way out: HTTP and RPC clients, publishes to topics, queues and buses. Set
`mode: "async"` for fire-and-forget.

*Calls through a wrapper.* If the code reaches the SDK through your own wrapper (for example
`TerminateAccountService` -> `SNSManager.publish` -> the SNS client), send **one** egress, not one
per layer. Describe the wrappers with `via`: ordered hops from the caller's call site to the real SDK
call, each `{ "function": "SNSManager.publish", "file": "...", "line": 20, "kind": "wrapper" }` (only
`function` is required). The UI shows the call once with a chip "via SNSManager.publish" (the last
hop) and the full chain on expand; hops never become producers, nodes or edges. `via` on the egress is
the usual chain; `callSites: [{ "file", "line", "function", "via": [...] }]` lists each place that makes
the call, when chains differ. Sending them inside `details.via` / `details.callSites` still works.

**Resources**: every data store used. `kind` (`mongodb`, `redis`, `dynamodb`, `postgres`, `s3`…),
a readable `name`, and a `bindKey` (below) so services using the same store are linked. If you
cannot give the key yet (cluster not read, key patterns not harvested), leave `bindKey` out and send
`unresolved: [{ "what": "target", "reason": "redis_no_key_pattern", "detail": "client creation only" }]`;
the store stands alone (not grouped with others) and shows "Key unknown: <reason>".

## Where things are defined, and how you know

Any ingress, egress, channel, binding or resource can say where it is declared and which run
produced it. Code links in the UI use it (ingress routes, call sites, Terraform lines):

```json
"source": { "file": "infra/messaging/order-events.tf", "line": 4, "url": "https://…", "repo": "…", "commit": "…" },
"provenance": { "producer": "iac-scanner", "runId": "l1-2026-10-19", "verified": "match" }
```

All fields are optional. `url` wins over building a link from `repo` + `commit` + `file` + `line`.
`verified` is `match` or `drift` when you compared with the live system (e.g. AWS), `code-only` when
you did not; drift shows up in link health.

## When you cannot resolve something

Do not invent a key and do not drop the item. Say what you found and why it is unresolved:

```json
{ "id": "audit.record", "transport": "http",
  "unresolved": [{ "what": "target", "reason": "method_or_path_unresolved",
                   "detail": "POST ${AUDIT_URL}/events", "candidates": ["http:POST audit-svc/events"] }] }
```

- `what: "target"` on an **egress** or **ingress**: the call target or consumed key is unknown.
  `bindKey` may be left out. On a **step**, `target` may be left out (a call-graph gap, e.g. dynamic
  dispatch). Without an `unresolved` entry, a missing key or target is rejected.
- `what: "target"` on a **resource**: its store key is unknown. `bindKey` may be left out; the
  resource is listed under Unresolved in link health and is never grouped with other stores, and not reported as an unused store (the harvester
  may simply not have sent its steps yet).
- `what: "caller"` on a **function**: the backward walk (from a sink towards its entry point)
  stopped here because no caller could be resolved (`reason` e.g. `unknown_receiver`,
  `callback_passed`, `no_caller_found:middleware`; `candidates` are possible caller function ids).
  It is listed under Unresolved in link health, shown on the function in the service view and
  returned by MCP `get_service`. It does not break any link.
- `what: "event"` on an **egress**: the event type is unknown or one of several. Put the possible
  types in `candidates`; they are shown as *possible* producers, never as confirmed, and they
  keep consumers off "nothing sends it". Known types still go in `events`.
- `what: "client"` on a **resource** or **egress**: a field of its `client` (below) you could not
  resolve. `detail` is the field path (`driver.version`, `lib.version`, `lib.driver.version`,
  `accessMode`, `via`), `reason` says why (`lockfile_not_found`). Leave the field out; never put a
  placeholder version.
- `what: "detail"` on a **resource** or a **resource step**: a value that exists but you could not
  read (#45). `detail` is the field path, `reason` says why. Paths: `details.databases` (instance
  resource), `client.databases` (service resource), `details.keyTemplate`, `details.dbIndex`,
  `details.ttlSeconds` (resource step). Leave the field out. The UI shows `databases: unknown
  (databases_not_in_cfg)`, so "unknown" reads differently from "none"; it is listed under
  "Unresolved by harvesters" in Link health and never counts as a broken link.
- `reason` is a short stable code (`no_endpoint`, `method_or_path_unresolved`, `var.env unresolved`,
  `dynamic_dispatch`, `attribution_ambiguous`…); link health groups by it. `detail` is what you
  saw in code. `candidates` are bind keys (target) or event types (event); target candidates are
  checked against real endpoints and shown as possible matches.

Unresolved items are never counted as broken links; they have their own section in link health.

**Assumed values (#47, 0.25.2).** `unresolved` says "I could not tell"; `assumed` says "I filled this in by a rule, it is not read from code". Send it on the same objects as `unresolved` (ingress, egress, functions, steps, resources) and on Redis key entries:
`"assumed": [{ "what": "detail", "detail": "client.databases", "value": [0], "basis": "client_default", "reason": "no db option and the URL has no path, so ioredis/node-redis select db 0 (approved by Asaf 2026-10-20)" }]`.
- `what` follows the #45 convention: a first-class name when there is one (`database`, `ttl`), otherwise `"detail"` with `detail` = the field path (`client.databases`, `details.databases`, `details.dbIndex`, `details.ttlSeconds`, `details.keyTemplate`). `value` is the value you actually put in the manifest (any JSON, `null` allowed), so readers can show and compare it.
- `basis` is a short code: `client_default`, `convention`, `inferred_from_name`, `sibling_value` (free text allowed). `reason` is one sentence: which rule, who approved it.
- Keep sending the value itself (e.g. `client.databases: [0]`, `details.dbIndex: 0`): `assumed` is a label on it, it changes no link and no graph. Do not also list the field in `unresolved` (contract finding `assumed-and-unresolved`).
- Instead of free-form `details.databaseAssumptions` / `step.details.dbIndexBasis`, send `assumed` (the UI does not show `details` free text). A key entry takes it too: `{"keyTemplate": "session:{token}", "service": "auth-svc", "ttlSeconds": 3600, "assumed": [{"what": "ttl", "value": 3600, "basis": "convention", "reason": "..."}]}`.
- Shown as a muted "assumed" badge (basis and reason on hover and in the panel); health lists it as an informational category `assumed` (per service and per basis), never in the coverage figure or the problem counts. Key entries' `assumed` is shown on the instance page (beside the TTL) and returned by the keys API, but not counted in health (keys are not part of the graph). Readers (API, MCP) treat it as a default, not a fact.

## How a service reaches a store: `client`

Optional `client` on a **resource** (the service's connection to a data store; an egress takes it
for non-store calls). One client per client site: a service that reaches one store in two ways sends
two resources. When infrastructure later defines the instances (a Redis cluster with its own id),
the service's resource points at it by `bindKey` and keeps carrying `client`; nothing here changes.

```json
{ "id": "orderCache", "kind": "redis", "name": "order:{id}", "bindKey": "redis:cache-main/order:{id}",
  "client": {
    "accessMode": "shared_lib",
    "accessId": "shipping-svc/src/lib/cache.ts:40",
    "driver": { "package": "ioredis", "version": "5.3.2", "versionSource": "lockfile" },
    "lib": { "package": "saferxlib", "kind": "in_house", "version": "2.1.0", "versionSource": "lockfile",
             "driver": { "package": "ioredis", "version": "4.27.6", "versionSource": "lockfile" } },
    "via": [{ "function": "ShipmentCache.get", "file": "src/lib/cache.ts", "line": 40 },
            { "function": "saferxlib.RedisClient.get", "file": "node_modules/saferxlib/dist/client.js", "line": 112 }] } }
```

- `accessMode`: `direct_driver` (the service calls the driver), `shared_lib` (an in-house library
  shared by services), `self_implemented_wrapper` (the service's own wrapper), `third_party_lib`.
- `driver` is the service's own driver for this store. `lib` is the wrapper and `lib.driver` the
  driver bundled inside it (it may be another major than the service's own: that is the case the UI
  flags). `lib` is `null` or left out for `direct_driver`. `versionSource` says where you read the
  version (`lockfile`, `package.json`).
- `via` has the same hops as an egress `via`, from the caller to the SDK call.
- Versions are strings; the server derives the major (`4.27.6` is `4.x`). A version you could not
  read is left out and sent as `unresolved: [{what: "client", reason: "lockfile_not_found", detail: "driver.version"}]`.
- The store page lists the clients; Inventory has a driver facet; MCP `list_clients` and
  `GET /api/envs/:env/clients` filter by store, service, driver, major, lib, access mode and via.

## Redis instances and their keys

**Instance.** The infra harvester defines each cluster or server as a resource whose `bindKey` is `redis:<name>` (no key pattern): `{"id": "cache-main", "kind": "redis", "name": "cache-main", "bindKey": "redis:cache-main", "details": {"engineVersion": "7.0.7", "nodes": 2, "topology": "cluster", "databases": 3}, "source": {...}, "provenance": {...}}`. Services point at it with the pattern keys they already send (`redis:cache-main/order:{id}`); the instance page lists them as the services that connect.

**Per service resource:** `client` as above, plus `client.databases: [0, 1]` (db indexes it selects) and, when you know it, `details.access` (`read`, `write` or `read_write`; otherwise it is derived from the steps).

**Per resource step** (cheap, and it makes "which flows write this key" work): `"details": {"keyTemplate": "session:{tenantId}:{userId}", "ttlSeconds": 1800}` on a `type: resource` step (`dbIndex` too if known).

**Unknown values (#45).** When you know a field exists but cannot read it, leave it out and say why, e.g. on the instance resource `"unresolved": [{"what": "detail", "detail": "details.databases", "reason": "databases_not_in_cfg"}]`; on a service resource `{"what": "detail", "detail": "client.databases", "reason": "db_from_runtime_config"}`; on a resource step `{"what": "detail", "detail": "details.keyTemplate", "reason": "key_unresolved:computed"}` (same for `details.dbIndex`, `details.ttlSeconds`). An empty `detail` or `reason` gets the `unresolved-no-detail` warning; another path gets `unresolved-detail-unknown-path`. These entries show on the Redis instance page and in the step panel, not in Link health.

**Keys, per instance, after the manifests** (optional, full replace each time):

```
PUT /api/envs/prod/resources/redis%3Acache-main/keys
{ "producer": "redis-key-harvester",
  "keys": [
    { "keyTemplate": "order:{id}", "dbIndex": 1, "service": "orders-svc", "access": "read_write",
      "commands": ["GET", "SET", "DEL"], "opsPerHour": 21000, "ttlSeconds": 3600 },
    { "keyTemplate": "order:{id}", "dbIndex": 1, "service": "catalog-svc", "commands": ["GET"] } ] }
```

One entry per service, template and db. `ttlSeconds` is the TTL that service sets; leave it out when unknown. `opsPerHour` is optional: send a measured rate, not a call-site count (say so in `producer`). Do not repeat a shared key under each writer: send one entry per writing service and the page shows it once under "Shared". A bad entry rejects the whole push (400 names the entries). Send `version` (above the last) if you want stale pushes refused. Until you push, the page reads an inline `details.keys` (top N) on the instance's resources; `details.lazy = {"kind": "keys", "ref": "cache-main"}` is kept.

## Bind keys

Both sides must produce **exactly** the same string. Normalise before you emit: method in capitals,
path parameters as `{name}` (convert `:id`, `<id>`, `{id:int}`), no trailing slash, no query string,
host = the target service's `service.name`.

| Transport | Key | Example |
|---|---|---|
| HTTP | `http:{METHOD} {service}{path}` | `http:GET orders-svc/orders/{id}` |
| RPC | `rpc:{service}/{Service.Method}` | `rpc:inventory-svc/Stock.Check` |
| gRPC | `grpc:{service}/{package.Service}/{Method}` | `grpc:pricing-svc/pricing.v1.Pricing/Quote` |
| SNS topic | `sns:{topic}` | `sns:order-events` |
| SQS queue | `sqs:{queue}` | `sqs:shipping-order-events` |
| RabbitMQ publish | `amqp:{exchange}/{routingKey}` | `amqp:shipping/shipping.created` |
| RabbitMQ queue | `amqp-queue:{queue}` | `amqp-queue:notify-shipping` |
| RabbitMQ RPC command | `amqp-rpc:{command}` | `amqp-rpc:rpc.sxdns.dns.resolve` |
| EventBridge bus | `eventbridge:{bus}` | `eventbridge:acme-bus` |
| MongoDB | `mongodb:{cluster or db}/{collection}` | `mongodb:orders-db/orders` |
| Redis | `redis:{cluster}/{key pattern}` | `redis:cache-main/order:{id}` |
| DynamoDB | `dynamodb:{table}` | `dynamodb:payments` |
| Postgres | `postgres:{db}/{table}` | `postgres:users-db/users` |
| S3 | `s3:{bucket}` | `s3:acme-event-lake` |

Ingress keys may be patterns: set `"match": "glob"` (`*` = one path segment, `**` = anything),
e.g. a gateway proxy `http:* public/api/users/**`. Egress keys are always literal.

Redis: report each **key pattern** you use (`order:{id}`, `session:{token}`), not just the cluster.

## RabbitMQ (0.18.0)

All fields below are optional; what you leave out is drawn less precisely, never wrongly.

**Exchange** (infra or owning service), `channels[]`. `details.type` is `topic`, `direct`, `fanout` or `headers`; also `vhost`, `durable`, `alternateExchange`:

```json
{ "bindKey": "amqp:saferx.EventExchange", "kind": "amqp-exchange", "name": "saferx.EventExchange",
  "details": { "type": "topic", "vhost": "/", "durable": true, "alternateExchange": "saferx.unrouted" } }
```

**Binding** on a topic exchange: `match: "amqp-topic"` (`*` is exactly one dot-separated word, `#` zero or more, so `audit.#` matches `audit`). Put the key as written in code in `details.bindingKey`. Use `exact` for a direct exchange (key equals routing key); a fanout exchange routes to every binding; on a headers exchange send `details.headers` and `details.xMatch` (`all` | `any`). `exact` / `glob` keep working.

```json
{ "id": "bind.logout", "from": "amqp:saferx.EventExchange/device.*.logout", "match": "amqp-topic",
  "to": "amqp-queue:domain-events-swg", "details": { "bindingKey": "device.*.logout" } }
```

**Publish** egress: key `amqp:{exchange}/{routingKey}`, `transport: amqp`, `mode: async`; `details.exchange` and `details.routingKey` (a placeholder word such as `{deviceId}` counts as one word). Headers exchange: `details.headers` (unknown headers show as "possible").

```json
{ "id": "deviceLogout.publish", "bindKey": "amqp:saferx.EventExchange/device.{deviceId}.logout", "transport": "amqp", "mode": "async",
  "details": { "exchange": "saferx.EventExchange", "routingKey": "device.{deviceId}.logout" } }
```

**RPC over AMQP**: the caller's egress and the server's ingress both use `amqp-rpc:{command}`, `transport: amqp`; the egress is `mode: sync` (sync AMQP is unicast: one server). `details.rpc` carries `command`, `commandQueue`, `replyTo`, `exchange` (`""` is the default exchange), `correlation`, `timeoutMs` (set it only when the call has a timeout handler), `library`; the ingress adds `prefetch`. A command with no harvested server is shown as "no server harvested".

```json
{ "id": "dns.resolve", "bindKey": "amqp-rpc:rpc.sxdns.dns.resolve", "transport": "amqp", "mode": "sync",
  "details": { "rpc": { "command": "rpc.sxdns.dns.resolve", "commandQueue": "rpcv2.sxdns", "replyTo": "rpcv2.reply.swg-api.{instanceId}",
    "exchange": "", "correlation": "properties.correlationId", "timeoutMs": 5000, "library": "@saferx/rpcv2 2.4.1" } } }
```
```json
{ "id": "in.rpcResolve", "bindKey": "amqp-rpc:rpc.sxdns.dns.resolve", "transport": "amqp", "handler": "DnsController.resolve",
  "details": { "rpc": { "command": "rpc.sxdns.dns.resolve", "commandQueue": "rpcv2.sxdns", "prefetch": 4 } } }
```

**sendToQueue** (default exchange): an egress straight to the queue, no exchange: `bindKey: "amqp-queue:saferx.activitylog"`, `transport: amqp`, `mode: async`.

**Queue role**: `amqp-queue` channels `details.role` is `rpc-command` or `rpc-reply` for the queues of an RPC library (they have no ingress of their own and are not reported as "queue has no consumer").

## Event types

When messages on a topic, queue or bus carry a type (message attribute, `detail-type`, class name):

- **Producer**: list what an egress publishes, and say which one each step sends:
  `{"id": "orderEvents.publish", "bindKey": "sns:order-events", "transport": "sns", "events": ["OrderPlaced", "OrderCancelled"]}`
  and on the step `"event": "OrderPlaced"`.
- **Consumer**: map each type to its handler on the ingress (globs allowed; the most specific wins):
  `"events": [{"type": "OrderPlaced", "handler": "onOrderPlaced"}, {"type": "Order*", "handler": "audit"}]`.
  If a producer is not harvested by anyone (a third party), declare it:
  `{"type": "OrderRefunded", "handler": "onRefund", "producers": ["billing-legacy"]}`.
  Do **not** list harvested producers; Flow-Mapper finds them by following the routes.
- Use the exact type string the code uses. `OrderPlaced.v2` and `OrderPlaced` are different types.

## Designs only: `undecided` and header `details`

Two things in the schema exist for design environments (HLD imports), not for harvesters. **Never send `transport: "undecided"`**: a harvester knows how a call is made; the value is for a call or endpoint a design has not decided yet.
**`details` on a service header and on a function** (free-form) carries the provenance of an import (`details.doc`); leave it out. Neither is read by anything a harvester produces, and a sealed environment never shows them.

## Infrastructure harvester

Report topics, queues, exchanges and buses as `channels`, and the subscriptions and rules between
them as `bindings`, with the event types each lets through:

```json
"channels": [
  { "bindKey": "sns:order-events", "kind": "sns-topic", "name": "order-events", "details": { "arn": "arn:aws:sns:…" } },
  { "bindKey": "sqs:shipping-order-events", "kind": "sqs-queue", "name": "shipping-order-events" }
],
"bindings": [
  { "id": "sub.shipping", "from": "sns:order-events", "to": "sqs:shipping-order-events", "events": ["OrderPlaced"] },
  { "id": "rule.users", "from": "eventbridge:acme-bus", "to": "sqs:analytics-all-events", "events": ["User*"] }
]
```

`events` is `"*"` (everything, the default) or a list of names and globs.
An entry starting with `!` excludes a name or glob, for filters such as SNS `anything-but` or a
negated prefix: `["!revision.status"]` lets everything through except that type; `["Order*", "!OrderDraft*"]`
lets `Order` types through except drafts. With only `!` entries, all other types pass; with positive entries,
a type must match one and no `!` entry. Channel kinds:
`sns-topic`, `sqs-queue`, `amqp-exchange`, `amqp-queue`, `eventbridge-bus`. If a service also
declares the same subscription with a different filter, Flow-Mapper shows a conflict; it does not
choose one.

## Flow descriptions (not part of the manifest)

Harvesters do not write descriptions. What a flow is for is a human note (UI) or an AI text written through MCP
`set_description` (docs/API.md, "Flow descriptions"); both survive re-harvesting. A harvest that changes a flow's trace marks
its AI descriptions "outdated" in the UI, which is the cue to generate them again.

## DTOs and store schemas (after the manifest)

These live outside the manifest, so re-harvesting a service does not erase them. Send all of them
in one call each, all-or-nothing:

```sh
# endpoint DTOs and event message DTOs
curl -sS -X POST "$FLOW/api/envs/prod/dtos" -H 'content-type: application/json' --data '{"dtos": [
  {"service": "orders-svc", "ingress": "in.create", "role": "request",  "content": {"customerId": "c_1", "items": []}},
  {"service": "orders-svc", "ingress": "in.create", "role": "response", "content": {"orderId": "o_1"},
   "meta": {"source": {"repo": "github.com/acme/orders-svc", "ref": "fb390dc", "file": "src/schemas/createOrder.json", "line": 1}, "provenance": "derived"}},
  {"service": "orders-svc", "ingress": "in.create", "role": "response", "status": "404", "content": {"error": "not_found"}},
  {"event": "OrderPlaced", "content": {"type": "OrderPlaced", "orderId": "o_1"}}
]}'
# data-store schemas, from the code's models
curl -sS -X POST "$FLOW/api/envs/prod/schemas" -H 'content-type: application/json' --data '{"schemas": [
  {"key": "mongodb:orders-db/orders", "source": "code", "content": {"fields": {"orderId": "string"}}}
]}'
```

Which DTO roles an endpoint takes depends on what it is; others are rejected (400):

| Ingress | Roles |
|---|---|
| HTTP POST / PUT / PATCH, RPC, gRPC | `request`, `response` |
| HTTP GET / DELETE / HEAD / OPTIONS | `request` (its path and query params, `{params, query}`), `response` |
| Queue, topic or bus consumer without `events` | `request` (the message) |
| Consumer with `events` | none: send one `{"event", "content"}` per event type instead |
| Cron | none |

A `response` DTO takes an optional `status` for the non-success shapes: `"404"`, `"4xx"` or
`"default"`. Without it the DTO is the success response. One response per status is kept; sending
the same status again replaces it.

Add `meta` to say where a DTO came from, so people can check it: `{source: {repo, ref, file, line},
provenance, incomplete}`, all optional. `source` becomes a link to the file and line (the service's
repo and commit are used for what you leave out). `provenance` is free text such as `openapi` or
`derived`. Set `incomplete` to the reason when you could only capture part of the shape (for
example `"joi_when"`); the UI flags it. Event DTOs take `meta` too.

`content` is an example payload or a JSON Schema, whichever you can produce. Schemas take
`source: "code"` today; `"db"` is reserved for a future database harvester.

## Done when

- `POST /api/ingest?dryRun=1` returns 200 for your manifest, and you have read the `warn`s in its
  `contract`.
- After sending, `GET /api/envs/{env}/health` shows none of your egress under "calls with no
  match" (`items.dangling`) unless the target really is not harvested yet, and none of your
  ingress under "never called" (`items.orphans`) unless it is public (mark it `entryPoint`).
- Event consumers list their event types, and no event shows as "unhandled" unless it really is.
- Anything you could not resolve is sent with `unresolved` and a reason, not dropped and not faked.
- Running the harvester twice on the same commit produces the same manifest (stable ids, stable
  order), only with a higher `version`.

## Reporting problems and getting fixes

Flow-Mapper's maintainers watch its bug tracker and answer there. Use your harvester's name as
`reporter` everywhere, so you can find your own bugs.

**Report** what blocks you (a field you need, a check that is wrong, a confusing error):

```sh
curl -sS -X POST "$FLOW/api/bugs" -H 'content-type: application/json' --data '{
  "title": "One line: what is missing or wrong",
  "description": "What you have, a concrete example row, what you need, and your proposal",
  "severity": "S3", "env": "prod", "reporter": "my-harvester"}'
```

Say what you do meanwhile (a workaround) so it can be removed later. Over MCP: `report_bug`.

**Attach the evidence.** The maintainers usually cannot see your data: your manifests may go to
another Flow-Mapper instance or environment. A bug about what the map shows or how something links
is only worked on with evidence; without it, it is set to `triaged` with a request for it. Attach:

1. the manifest(s) you sent for the affected service(s), as you sent them;
2. the response of `POST /api/ingest?dryRun=1` for them (its `contract` section lists what the
   manifest leaves out or cannot link: check it first, the answer is often there);
3. your Flow-Mapper version (`GET /api/version`) and, if useful, the view's JSON
   (`GET /api/envs/{env}/views/service/{service}`).

```sh
curl -sS -X POST "$FLOW/api/bugs/$ID/attachments?filename=manifest.json" --data-binary @manifest.json
curl -sS -X POST "$FLOW/api/ingest?dryRun=1" -H 'content-type: application/json' --data @manifest.json > dryrun.json
curl -sS -X POST "$FLOW/api/bugs/$ID/attachments?filename=dryrun.json" --data-binary @dryrun.json
```

Trim nothing that matters to the bug; strip secrets. If the fix turns out to be in your data, the
reply says exactly what to change in the manifest.

**Follow up** about every 15 minutes while you work:

```sh
curl -sS "$FLOW/api/bugs?reporter=my-harvester&updatedSince=$LAST_CHECK"   # changed since, comments included
```

**Follow up without polling.** Over your SSH tunnel to the server, watch the events for your own bugs with Claude
Code's Monitor tool (timeout 30 minutes; re-arm when it ends, with `&since=<last id>` from the last `data:` line):

```sh
curl -sN -H 'Accept: text/event-stream' "$FLOW/api/events?types=bug.status,bug.commented,version.deployed&reporter=my-harvester" | grep --line-buffered '^data:'
```

Each line is one JSON event (`type`, `bugId`, `summary`, `data`). `bug.commented` and `bug.status` carry your
bugs only (`reporter` is the bug's reporter; `version.deployed` has none and always passes). React as the table
below says: on `bug.status` with `data.to` = `fixed`, wait for `version.deployed` to reach `data.fixedInVersion`
(or check `GET /api/version`), pull the Flow-Mapper repo, re-test with `?dryRun=1`, then verify or reopen. Keep the
15-minute check as a safety net in case the tunnel drops. Details: [API.md](API.md#push-events-e1).

| You see | It means | Do |
|---|---|---|
| a new comment, status `triaged` | a question or a proposal for you | answer with `POST /api/bugs/{id}/comments` |
| status `fixed`, `fixedInVersion` | the fix is on `main` and the server runs it once `GET /api/version` is at least that | pull the Flow-Mapper repo (guide and schema may have changed), read the fix comment, drop your workaround, re-run with `?dryRun=1` |
| it works | | `PATCH /api/bugs/{id}` `{"status": "verified"}` |
| it does not | | `PATCH /api/bugs/{id}` `{"status": "in_progress"}` and comment what still fails |
| `wont_fix` / `duplicate` | see the comment | keep your workaround or follow the linked bug |
