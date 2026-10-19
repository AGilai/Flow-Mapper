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
| Service | `name` | team, repo, language, tags, kind (`service` \| `gateway` \| `infra`) |
| Function | `service:id` | name, file, line, steps[] |
| Step | `service:function#seq` | seq, type (`call` \| `egress` \| `resource`), target, mode (`sync` \| `async`), operation, condition, loop |
| Ingress | `service:id` | bindKey, transport, handler, delivery, entryPoint, details |
| Egress | `service:id` | bindKey, transport, mode, delivery, details |
| Resource | `service:id` | kind (mongodb, redis, dynamodb, postgres, s3, …), name, bindKey |
| Channel | `bindKey` | kind (sns-topic, sqs-queue, amqp-exchange, amqp-queue), name |
| Binding | `service:id` | from (key or pattern), to (key), filter |
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

Defaults: `http` → unicast, `sns` → multicast, `sqs` → unicast, `amqp` → multicast.
Harvesters may override per endpoint.

Pub/sub path: `egress sns:order-events` → channel `sns:order-events` → binding →
channel `sqs:inventory-order-events` → ingress `sqs:inventory-order-events`.

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
| Coverage | Resolved egress ÷ total egress, per service |

Each snapshot stores its numbers, so the UI can show a trend per version. Exposed in the
UI (health page + badges in the system view), the API and MCP.

---

## 6. Bugs

Bugs are tracked against the map: a bug points at services, functions, endpoints or a
flow, so the graph can help locate and prioritize it.

**Bug**: id, title, description, env, status, severity, priority, assignee, reporter,
linked entities, attachments, comments, resolution, timestamps.

- **Open** — from the UI, the API or MCP. Optionally start from a selected node or flow.
- **Load logs** — upload log files (stored on disk now, S3 later; size-capped). On
  upload the server scans for known service names and bind keys and **suggests linked
  entities**; the user confirms them.
- **Prioritize** — severity (S1–S4) is set by the reporter. The server computes
  **impact** from the graph: how many entry points and flows pass through the linked
  entities. Suggested priority (P0–P3) = f(severity, impact); a human can override.
  The list view sorts by priority, then age.
- **Fix** — status flow `open → triaged → in_progress → fixed → verified → closed`
  (plus `wont_fix`, `duplicate`). A fix records a resolution: a code fix (PR link and
  the service version it ships in) or a map-data fix (link to the changelog entry made
  through CRUD). When a fixed bug's service is re-harvested at or above that version,
  the UI prompts to verify.

---

## 7. Views

1. **System view** — force-directed graph of services, gateways, channels and resources.
   Filters: name, function, transport, env, team, tag, "only broken links". Click a node
   or edge for the info panel (endpoints, versions, health, open bugs).
2. **Service view** — one service in the middle; ingress on the left, egress, channels
   and resources on the right, each with transport, mode and details.
3. **Sequence view** — starts with one function's intra-service steps; expand any egress
   to follow it into the next service, until the whole flow from an entry point is shown.
   Async hops are drawn with open arrows and marked as such.
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
`list_bugs`, `get_bug`, `create_bug`, `update_bug`, `attach_log`.

---

## 9. Stack

- TypeScript end to end (Node 22)
- API: Fastify; validation from the JSON Schema in `schema/`
- DB: SQLite via Drizzle ORM now; the same schema moves to Postgres later
- UI: React + Vite, Cytoscape.js for the graph views, sequence view rendered from steps
- MCP: official TypeScript MCP SDK
- Hosting later: AWS App Runner + RDS Postgres + S3 for attachments, CI from GitHub

Target scale (≈100 services, 2,000 endpoints, 500 queues) fits in memory for traversal.

---

## 10. Phases

1. **Design** — this doc, manifest schema, sample data *(this PR)*
2. **Core** — DB schema, ingest (full + delta), resolver, CRUD, link health
3. **UI** — system view → service view → sequence view → health page
4. **MCP** server
5. **Bugs** — model, logs, prioritization, workflow
6. **Deploy** — AWS + CI

## 11. Open questions

- Should environments ever link across each other (for example, staging calling a prod
  service)? Currently no.
- Who is the source of truth for SNS/RabbitMQ bindings — consumer services, an infra
  harvester, or both? The model supports both.
- Authentication for the UI, API and MCP.
