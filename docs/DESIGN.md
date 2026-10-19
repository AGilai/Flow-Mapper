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
| Service | `name` | team, repo, language, tags, kind (`service` \| `gateway` \| `lambda` \| `infra`) |
| Function | `service:id` | name, file, line, steps[] |
| Step | `service:function#seq` | seq, type (`call` \| `egress` \| `resource`), target, mode (`sync` \| `async`), operation, condition, loop |
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
`link_health`, `changelog`, `upsert_entity`, `delete_entity`, `ingest_manifest`,
`get_endpoint_info`, `event_types`, `load_dtos`, `list_bugs`, `get_bug`, `report_bug`, `update_bug`. See [API.md](API.md).

---

## 9. Stack

- TypeScript end to end, **no runtime dependencies**: Node 22.18+ built-ins (`node:sqlite`,
  `node:http`, type stripping). See [ARCHITECTURE.md](ARCHITECTURE.md).
- DB: SQLite now; the schema is plain SQL in migrations and moves to Postgres when needed.
  Flow-Mapper also runs on users' machines, so `npm run db:install` creates a database with the
  full schema. While the project is early there are no incremental migrations: schema changes
  edit `001_init.sql`, and a database built from an older schema is refused until it is
  reinstalled (`npm run db:install -- --force`, which deletes its data).
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
