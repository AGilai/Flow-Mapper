# Flow-Mapper — Design (v1)

Flow-Mapper stores and visualizes how services talk to each other — across services
(REST, SNS, SQS, RabbitMQ, gateways) and inside them (function → function) — so a human
or an agent can follow any request from its entry point to the end of its route.

- **Humans** use the web UI (system view, service view, sequence view, link health, bugs).
- **Agents** use the MCP server (search, trace, CRUD, link health, bugs).
- **Harvesters** (one per service, owned elsewhere) push manifests through the ingest API.

---

## 1. Principles

1. **Harvested data is fact.** No confidence scores and no inferred links. A link exists
   only when bind keys match by the rules in §3.
2. **Harvesters own the keys.** The server never parses code or URLs; it matches strings.
3. **One graph for inter and intra.** A cross-service hop and a function call are both
   steps in the same traversal, so a flow can be followed end to end.
4. **Every service snapshot is versioned.** Full and delta ingest both bump the version
   and write to an append-only changelog.
5. **Environments are a first-class dimension**, default `default`. Keys only match
   inside the same environment.

---

## 2. Data model

```
Environment ─┬─ ServiceSnapshot (service, version, harvestedAt, commit)
             │     ├─ Function ── Step[] (ordered)
             │     ├─ Ingress   (bindKey, handler → Function)
             │     ├─ Egress    (bindKey)
             │     ├─ Resource  (mongo/redis/dynamo/…)
             │     ├─ Channel   (sns topic / sqs queue / amqp exchange / amqp queue)
             │     └─ Binding   (channel → channel/ingress, may use wildcards)
             └─ Link (derived, never ingested)
```

| Entity | Stable ID | Key fields |
|---|---|---|
| Service | `name` | team, repo, language, tags, groupPath (optional subsystem, `platform` or `platform/identity`), kind (`service` \| `gateway` \| `lambda` \| `infra` \| `client-app`) |
| Function | `service:id` | name, file, line, steps[] |
| Step | `service:function#seq` | seq, type (`call` \| `egress` \| `resource`), target, mode (`sync` \| `async`), operation, condition, altGroup, bind (call), eventFrom (egress), loop |
| Ingress | `service:id` | bindKey, transport, handler, delivery, entryPoint, details |
| Egress | `service:id` | bindKey, transport, mode, delivery, details |
| Resource | `service:id` | kind (mongodb, redis, dynamodb, postgres, s3, …), name, bindKey (`{kind}:{cluster}/{collection, table or key pattern}`) |
| Channel | `bindKey` | kind (sns-topic, sqs-queue, amqp-exchange, amqp-queue, eventbridge-bus), name |
| Binding | `service:id` | from (key or pattern), to (key), events (event filter), filter |
| Link | derived | from endpoint → to endpoint, reason (exact \| pattern \| binding) |

**Steps give order.** A function is an ordered list of steps; each step calls another
function in the same service, goes out through an egress, or touches a resource. That
order is what the sequence diagram is drawn from.

**Channels are shared.** Any manifest may declare a channel; channels are merged by
bindKey across snapshots in the same environment. Infra (SNS subscriptions, RabbitMQ
bindings) can come from the consuming service's manifest or a dedicated `infra` manifest.

---

## 3. Bind keys and matching

A bind key is an opaque string the harvester produces. Recommended conventions (not
enforced):

| Transport | Convention | Example |
|---|---|---|
| HTTP | `http:{METHOD} {host}{pathTemplate}` | `http:GET orders-svc/orders/{id}` |
| RPC (JSON-RPC, Thrift, in-house) | `rpc:{service}/{Service.Method}` | `rpc:inventory-svc/Stock.Check` |
| gRPC | `grpc:{service}/{package.Service}/{Method}` | `grpc:pricing-svc/pricing.v1.Pricing/Quote` |
| EventBridge bus | `eventbridge:{bus}` | `eventbridge:acme-bus` |
| SNS topic | `sns:{topic}` | `sns:order-events` |
| SQS queue | `sqs:{queue}` | `sqs:inventory-order-events` |
| AMQP publish | `amqp:{exchange}/{routingKey}` | `amqp:shipping/shipping.created` |
| AMQP queue | `amqp-queue:{queue}` | `amqp-queue:notify-shipping` |
| Resource | `{kind}:{cluster}/{collection}` | `mongodb:orders-db/orders` |

### Wildcards

Ingress keys and binding `from` keys may be **patterns** (`"match": "glob"`). Egress keys
are always literal — callers call something concrete.

- `*` matches any run of characters except `/`
- `**` matches anything, including `/`
- RabbitMQ `#` should be emitted as `**` by the harvester

Examples: a gateway proxy route `http:* public/api/orders/**`, an SNS subscription from
`sns:*-events`, a RabbitMQ binding from `amqp:shipping/shipping.*`.

### Resolution

For each egress (and each channel, via bindings), find every candidate whose key matches —
exact keys first, then patterns. What happens next depends on `delivery`:

- **`unicast`** (REST, a single queue consumer group): link to the **most specific**
  match only — exact beats pattern; between patterns, fewer wildcards and then the
  longer literal prefix wins. A tie is reported as *ambiguous*.
- **`multicast`** (SNS, AMQP fan-out): link to **every** match.

Defaults: `http`, `rpc`, `grpc` → unicast and synchronous; `sns` → multicast, `sqs` → unicast, `amqp` → multicast.
Harvesters may override per endpoint.

Pub/sub path: `egress sns:order-events` → channel `sns:order-events` → binding →
channel `sqs:inventory-order-events` → ingress `sqs:inventory-order-events`.

### Event types

Topics, queues, exchanges, EventBridge buses and API gateways are nodes with unique keys, usually
reported by an infra harvester. Event types ride on top of the links between them:

| Part | Reported by | Field |
|---|---|---|
| Publish | producer service | egress `events: ["OrderPlaced", …]`; a step may name its `event` |
| Subscription / rule | infra harvester, or the subscribing queue's service | binding `events: "*"` or a list of names and globs (`Order*`); absent means all |
| Consume | consumer service | ingress `events: [{type, handler, producers?}]`; `type` may be a glob |

A **delivery** is one event type travelling from a producer's egress to a consumer's ingress along
links whose subscriptions let it through. The **producers** of an event type at a consumer are
derived from deliveries: they follow from what the producers' own harvesters report, so they stay
current. A consumer may also declare `producers` for services Flow-Mapper does not harvest; those
are shown as declared, not verified. At the consumer, the most specific matching `type` picks the
handler (exact beats glob). An ingress without `events` takes every event type with its `handler`.

The Message DTO belongs to the event type (`event_dtos`), not to a queue: it is the contract
between producers and consumers. Traces carry the event type: subscriptions that filter it out
are not followed, and the consumer runs that event's handler.

---

### Data stores

A data store is identified by its bind key; services that declare the same key share it. Keys go
down to the unit people reason about: a MongoDB collection (`mongodb:orders-db/orders`), a Redis
key pattern (`redis:cache-main/order:{id}`), a DynamoDB or Postgres table, an S3 bucket. The part
before the first `/` is the store's group (cluster or database). Each resource step is a read or a
write, from its `access` or else its operation (`find`, `GET`, `SELECT`, `GetItem`… are reads).

Schemas are stored per store and per **source**: `code` (from the service's data models, the
first harvester), `db` (read from the database, later), `manual`. Keeping the source allows a
later check that what the code expects matches what the database holds.

---

## 4. Ingest, versions and deltas

**Full manifest** (`kind: "full"`) replaces the service's snapshot in that environment.

**Delta manifest** (`kind: "delta"`) carries `baseVersion` plus `upsert` and `delete`
lists by stable ID. Upserting a function replaces its steps.

Rules:
- `version` must be greater than the current version.
- A delta is accepted only if `baseVersion` equals the current version; otherwise the
  server returns `409 VERSION_MISMATCH` with the current version and the harvester sends
  a full manifest. This prevents silent drift.
- Every accepted ingest is one transaction and writes a changelog entry: service, env,
  from/to version, and each added/changed/removed entity.
- After ingest, links are re-resolved for that environment (cheap at the target scale).

History: the changelog supports "what changed in `orders-svc` between v41 and v44"
from day one. Point-in-time graph views (storing `validFrom`/`validTo` versions on rows)
are a later phase.

---

## 5. Link health (stats)

Computed after every resolution, per environment and per service:

| Metric | Meaning |
|---|---|
| Dangling egress | A caller whose key matches nothing |
| Orphan ingress | Nothing calls it — ingress marked `entryPoint: true` is excluded |
| Unbound channel | A topic with no subscription, a queue with no consumer, or a binding to nothing |
| Ambiguous unicast | A unicast egress with tied best matches |
| Unhandled event | An event type reaches a consumer that lists event types, and none matches (dead-letter risk) |
| Event filtered out | Published, but every subscription on the way filters it out |
| Event nothing sends | A consumer handles it; no producer sends it on a route in, none declared |
| Declared producer not seen | A declared producer is harvested but does not send that event type there |
| Store with several writers | More than one service writes the same collection, table or key: coupled through data |
| Unused store | Declared, but no function uses it |
| Unresolved (harvester) | Reported by the harvester with a reason; not a broken link. Grouped by reason |
| Mixed commits / drift | Items scanned at another commit; items that differ from the live system |
| Subscription conflict | The same subscription (from, to) is reported by several manifests with different event filters |
| Coverage | Resolved egress ÷ total egress, per service |

Each snapshot stores its numbers, so the UI can show a trend per version. Exposed in the
UI (health page + badges in the system view), the API and MCP.

---

## 6. Bugs

Bugs are reports about **Flow-Mapper itself** — the map data, the views, the API or MCP — from
people using a released version. They can be reported three ways, all equal: the REST API, the
"Report a bug" page, and the `report_bug` MCP tool (so a user can report from an agent chat).

**Bug**: id, title, description, steps, status, severity, priority (suggested or overridden),
impact, `appVersion` (where it was seen), `fixedInVersion`, env, reporter, assignee, channel
(api | web | mcp), resolution, links to map entities, log attachments, comments.

- **Versions** — every report records the version it was seen in (defaults to the running
  version). Fixing records the version the fix ships in. When the running version reaches it,
  the bug is flagged "ready to verify".
- **Logs** — uploaded per bug (5 MB each). On upload the server scans the text for known service
  names, endpoint keys and function names and suggests links; one click applies them.
- **Prioritize** — severity (S1–S4) from the reporter; impact = how many traced entry flows pass
  through the linked entities. Suggested priority = severity weight + impact boost (see API.md).
  Anyone can override; clearing the override returns to the suggestion.
- **Fix** — `open → triaged → in_progress → fixed → verified → closed`, plus `wont_fix`,
  `duplicate` and reopen paths. `fixed` requires `fixedInVersion` and a resolution
  (code | map-data | config | none, with a reference such as a PR).

---

## 7. Views

1. **System view** — force-directed graph of services, gateways, channels and resources.
   Filters: name, function, transport, env, team, tag, "only broken links". Click a node
   or edge for the info panel (endpoints, versions, health, open bugs).
1a. **Inventory** — every object (services, gateways, Lambdas, topics, queues, buses, data
   stores, event types) in one list, filtered by type, kind, team, text and "has problems".
   Each object has its own page: a data store shows readers and writers down to the function,
   the entry points whose flows reach it, its schemas and the other keys in its cluster; a
   channel shows publishers, subscriptions with event filters, consumers and event types; an
   event type shows its routes, handlers, problems and Message DTO.
2. **Service view** — one service in the middle; ingress on the left, egress, channels
   and resources on the right, each with transport, mode and details. Each ingress has an
   info button: a panel with a link to the handler's code in the repo (file and line at the
   harvested commit) and its request/response DTOs in a JSON viewer.
3. **Sequence view** — starts with one function's intra-service steps; expand any egress
   to follow it into the next service, until the whole flow from an entry point is shown.
   Async hops are drawn with open arrows and marked as such. Clicking an arrow shows where the
   call is made (function, file and line, step), what handles it, and its DTO (event message,
   request/response body, or the store's schema). Right-clicking (or clicking) a lifeline opens
   a menu: show a service's function calls in place (one lifeline per function; `expand` on the
   trace), zoom in to that service's own flow from where this flow enters it, open the code, or
   open the object's page.
4. **Link health** — the stats in §5 with drill-down to each broken item.
5. **Bugs** — list (sort/filter by priority, status, service), bug detail with logs and
   the linked part of the graph.

---

## 8. API and MCP

**REST API**
- `POST /ingest` — full or delta manifest
- CRUD: `/services`, `/functions`, `/ingress`, `/egress`, `/resources`, `/channels`,
  `/bindings` (manual edits create a changelog entry and bump the version)
- Queries: `/graph`, `/services/:name/view`, `/flows/trace?from=…`, `/paths?from=…&to=…`,
  `/search?q=…`, `/health`, `/changelog`
- Bugs: `/bugs` CRUD, `/bugs/:id/attachments`, `/bugs/:id/comments`

**MCP tools** (same service layer): `search`, `get_service`, `trace_flow`, `find_paths`,
`link_health`, `changelog`, `ingest_manifest`,
`get_endpoint_info`, `event_types`, `load_dtos`, `list_bugs`, `get_bug`, `report_bug`, `update_bug`. See [API.md](API.md).

---

## 9. Stack

- TypeScript end to end, **no runtime dependencies**: Node 22.18+ built-ins (`node:sqlite`,
  `node:http`, type stripping). See [ARCHITECTURE.md](ARCHITECTURE.md).
- DB: SQLite now; the schema is plain SQL in migrations and moves to Postgres when needed.
  Flow-Mapper also runs on users' machines, so `npm run db:install` creates a database with the
  full schema. Migrations are append-only: `001_init.sql` and every later file are frozen, and a
  schema change is a new `NNN_name.sql`. Opening a database applies the pending ones in order, each
  in a transaction, recorded with a checksum in `schema_migrations`. Before upgrading a database that
  already has migrations applied, it is copied to `<db>.pre-<NNN>.bak` (`VACUUM INTO`). A database
  whose applied file changed is refused: that is a developer error. A migration that rebuilds a
  table starts with `-- migrate: foreign_keys=off`; foreign keys are off around the transaction and
  `PRAGMA foreign_key_check` must pass before it commits. `db:install --force` still rebuilds from scratch.
- UI: plain ES modules, canvas for the system map, SVG for sequence diagrams, no bundler.
- MCP: implemented directly (JSON-RPC over HTTP at `/mcp` and over stdio).
- Hosting later: AWS App Runner (or ECS) + RDS Postgres + S3 for attachments, CI from GitHub.

Target scale (≈100 services, 2,000 endpoints, 500 queues) is exercised by the mock generator:
resolution ≈ 0.2 s, system graph ≈ 0.1 s.

---

## 10. Phases

1. **Design** — this doc, manifest schema, sample data — done
2. **Core** — DB, ingest (full + delta), resolver, CRUD, link health — done
3. **UI** — system map, services, service view, flows (sequence), link health — done
4. **MCP** server — done (HTTP + stdio)
5. **Bugs** — API, report page, triage, logs, versions — done
6. **Deploy** — AWS + CI — next
7. Later: authentication, point-in-time views, Postgres, harvester SDK

## 11. Open questions

- Should environments ever link across each other (for example, staging calling a prod
  service)? Currently no.
- Who is the source of truth for SNS/RabbitMQ bindings — consumer services, an infra
  harvester, or both? The model supports both.
- Authentication for the UI, API and MCP.

## Flow tabs (0.13.0)

Every flow is a tab; there is no main tab and picking never replaces. Tab keys are stable and carry no display numbers:
`service/ingress` (entry; `~event`, `!intra` when not the defaults), `fn:service/function`, `queue/handler@origin` (a
delivery opened from the tab `origin`), `full:service/ingress[@origin]`. The URL is `tabs=<keys>&tab=<key>`; an old
`service=&ingress=` link becomes one tab. A sub-flow tab is a row of its origin's trace drawn as its own page, so it
costs no request and survives its origin being closed (the origin is resolved by key, and the breadcrumb reopens it).
The scope (inside the service / full flow) belongs to a tab and is part of its key.

The "Queues and topics" checkbox is gone (0.17.0): every diagram draws its own publishes as a chain that stops at the queue
(service, topic, queues), with the topic and queue lifelines to the right of the services. The consumer's work is the async
sub-flow under the diagram; the number on the tile at the queue is the number of its row there.

## Flow descriptions (0.14.0)

Two records per key, human and AI, never merged: a person's note must survive any AI run, and an AI text must be
recognisable as such. Humans write theirs in the UI (REST); AI tools write theirs through MCP `set_description`, so
Flow-Mapper itself never calls a model (the "Generate…" dialog only hands out prompts). The AI record keeps the model, the
time and a hash of the trace it was written from; when the flow's trace hashes differently, the box shows "outdated"
instead of silently going stale. A sub-flow (callee) hash covers only the messages that touch that service.
A whole-flow description is expected for every flow: when neither record exists the entry tab says "No description yet" with
both actions. Descriptions hang on `service + ingress`, with no foreign key to the snapshot, so a re-harvest keeps them.

## Environments (0.21.0)

An environment is a row in `envs` with a kind. **Sealed** environments are the harvesters' record: only the harvester
APIs write to them, so what a harvester reported is never second-guessed by a manual edit. **Design** environments hold a
high-level design: they are made by copying (Blank, Components, Full), harvesters never write to them, and they are edited
by hand. One guard in the store write path enforces both; annotations (descriptions, bugs) are allowed everywhere. Existing
environments were backfilled as sealed (migration 005); an ingest into an unknown name still creates a sealed environment.

A design is a full copy of its own: no shared rows or references with the source (decision 5 in `docs/plans/design-envs.md`).
Components copies the picked services without functions, so there are no flows to carry; Full copies everything. The rows a
design was copied from are frozen into `baseline_items` at copy time (old versions are not kept anywhere else), so a later diff
compares with what the source said then; copying a design keeps its original baseline. The optional `groupPath` on a service
is its subsystem (`platform`, later `platform/identity`); the environment lists its subsystems in order and its levels
(`Subsystem`, later `Domain`, `Component`). `client-app` is the kind of a device or browser application that calls services.
Neighbours for the New environment page are one hop over the resolved links, through channels too, so a design can start with the
components that talk to the ones picked.

## Drafts and marks (0.23.0)

A design environment is edited through **drafts**: named lists of whole-item ops (upsert or delete, by anchor). Whole items, not field patches:
an op is one row of `baseline_items`' shape, so the diff, the overlay and the apply all work on one `ItemRow`, and a removed field simply is not in the new item.
Reading a draft is an overlay in memory (the environment's rows, then the net ops), cached beside the environment's graph; nothing is written until apply.
Apply turns the net ops into manifests (a full one for a new component, a delta per touched existing one) and ingests them in one transaction through the
harvester code path (`ingestIn`), so versions, the changelog, integrity checks and contract reports behave as for a harvester, and a failure anywhere leaves the environment as it was.
**Newer edit wins** (maintainer decision 1): there is no conflict stop. Each op remembers a hash of the environment's item when the draft first touched it; apply overwrites an item that
moved since, and lists it (`replaced`, and in the summary changelog row) so the loss is visible. The bar can warn before (`stale`) because it is the same hash comparison.
A copied component keeps problems it already had (dangling handlers after a Components copy): an apply is refused only for problems it would cause.

**Marks are a separate endpoint**, not a field of every response: traces, service views and the inventory stay exactly as they were (a golden hash of every prod trace proves it),
and the pages decorate themselves from one `marks` map keyed by anchor. One diff function computes the marks and the counts, so the bar, the inventory filter and the review list agree.
The diff is pure (`core/diff/`), shared with the browser, which is how the static preview computes the same marks. The rules that make it usable on real data: noise is dropped before comparing
(provenance, code locations, versions, `details.doc`, step numbers), steps are aligned by content so an inserted step is one added step, the highest level carries a mark, a changed child marks its parents.
Manual CRUD on environments is gone (0.25.0, decision M2: kept as 409s until the edit forms existed): sealed means harvesters, design means drafts.

**References and import (0.25.0).** A design that starts as a Components copy holds endpoints whose behaviour stayed in the source. Showing them as ordinary endpoints would hide that
the flow stops there; showing them as errors would be wrong (referencing prod is normal). So an endpoint is a *reference* iff it came from another environment (a baseline row, or
an import op), names a handler, and no handler is a function of its component. One definition, in `core/references.ts`, used by the server, the preview and the UI; the lock the UI draws
is neutral. A design-made endpoint with a dangling handler is not a reference: it is "not designed yet". A flow that continues into a reference is *partial*, and says which steps.
*Import into design* copies **one level**: the endpoint's own flow and what it uses, never what it calls in other components, which stays a reference and is listed with its own import.
Recursion would pull the whole system in one click; one level makes the next level an explicit choice. A callee the design lacks comes along as a stub (header, endpoint, DTOs; no
behaviour) so the imported call resolves and shows the lock. **Why the baseline of imported items lives on the op** (`draft_ops.origin`, migration 008) and not in `baseline_items` at
import time: baseline rows for items that exist only in a draft would show as Removed in the environment and in every other draft, and leave orphans on discard, undo or revert. On the
op they follow the draft's life for free; apply copies them into `baseline_items`. Imported items are unchanged against their source, so they get no New mark, and editing them in the same
draft shows Changed. The edit forms (`DesignEdit`) are pure builders of the same whole-item ops, so a form, an import plan, an agent (`edit_design`) and the preview all make identical drafts.

`undecided` is a transport value for "not chosen yet", not `other` plus a flag: it resolves by key like any transport, so a design can wire two components before deciding how they talk.

## The subsystem level (0.28.0)

- **One subsystem per component.** The subsystem is the first segment of the `groupPath` (`platform/identity` rolls up into `platform`). The maintainer decided against `alsoIn` (#51): a component in two
  subsystems would count its calls twice or hide them, and the roll-up is only readable if every call is counted once. So there is a primary only, a request that gives two is `422 TWO_GROUPS`, and
  changing the `groupPath` moves the component (shown on both `grp:` boxes and in the draft's changes).
- **Settings stay in `envs.groups`** (`[{key, label, icon?}]`, order = position): it already held key, label and order and `/api/envs/meta` serves it. A new table would duplicate it, and moving JSON into rows needs
  SQL JSON functions that SQLite and Postgres do not share. The rows the diff and the drafts see (`grp:`) are built from it (`envItemRows`) and written back by apply (`writeDesignSide`).
- **`envs.baseline_groups`** is the subsystems a design started with: a plain column copy at creation, portable, and the baseline of the `grp:` marks. Existing designs took their groups at migration time.
- **Roll-up without the system graph.** `rollUp` walks every egress through `downstreamIngress` once (O(S + E + P)); `systemGraph` builds an event report per channel (about 450 ms on the 100-service mock, the roll-up takes about 20 ms).
- **A refined abstract link is kept, not deleted.** It leaves the abstract layer and folds into its roll-up line; its name, description and provenance stay, and it turns `broken` (with a problem) if the call goes away, instead of silently
  vanishing. The cost is one more row to read; the gain is that a design decision survives the implementation changing under it.
- **Design lists are design content.** `subsystem`, `link` and `flowrel` rows have service `''`: they never enter a model or a manifest, a draft writes them through `design-side.ts`, and against the source they pass through as the baseline has
  them (the source never has them), so a design-made link is New against both.
