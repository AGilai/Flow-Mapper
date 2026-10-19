# Writing a Flow-Mapper harvester

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
| Infrastructure (IaC, AWS APIs) | topics, queues, exchanges, event buses, and the subscriptions/rules between them | `infra` |

## The loop

1. Build the manifest (below). Use `kind: "full"` the first time and whenever in doubt.
2. Validate without writing: `POST /api/ingest?dryRun=1`. It runs every check (schema, internal
   references, version) and returns the changes it would make. Nothing is stored.
3. Send it: `POST /api/ingest`. Several at once: `{"manifests": [ ... ]}`.
4. Push DTOs and store schemas (separate endpoints, below).
5. Check the result: `GET /api/envs/{env}/health`. Calls with no match are almost always bind
   keys that differ between caller and callee.

```sh
curl -sS -X POST "$FLOW/api/ingest?dryRun=1" -H 'content-type: application/json' --data @manifest.json
curl -sS -X POST "$FLOW/api/ingest"          -H 'content-type: application/json' --data @manifest.json
```

| Error | Status | Do this |
|---|---|---|
| `INVALID` | 422 | `details` lists each problem with a JSON path; fix and resend |
| `VERSION_NOT_NEWER` | 409 | `version` must be greater than the stored one (`details.currentVersion`) |
| `VERSION_MISMATCH` | 409 | your delta's `baseVersion` is stale; send a full manifest |
| `NOT_FOUND` | 404 | a delta for a service never ingested; send a full manifest |

**Versions.** `version` is an integer that only grows: a CI build number or a commit count works.
`harvestedAt` is when you ran (ISO time). `commit` is the commit you read; Flow-Mapper builds code
links from `service.repo` + `commit` + each function's `file` and `line`.

**Full or delta.** A full manifest replaces everything Flow-Mapper knows about the service. A
delta (`kind: "delta"`, `baseVersion`, `upsert`, `delete`) patches it; send one only when you know
the version you last sent was accepted.

## Manifest skeleton

```json
{
  "schemaVersion": "1.0",
  "kind": "full",
  "env": "prod",
  "service": { "name": "orders-svc", "kind": "service", "team": "checkout",
               "repo": "github.com/acme/orders-svc", "language": "typescript", "description": "Order lifecycle" },
  "version": 12,
  "harvestedAt": "2026-10-19T08:00:00Z",
  "commit": "fb390dc",
  "functions": [], "ingress": [], "egress": [], "resources": [], "channels": [], "bindings": []
}
```

`service.name`: lowercase letters, digits and `-`, the same name other services use to call it.

## What to extract from a service

**Functions**: every function that handles a request or is on the way to an outgoing call or a
data store. `id` is stable across harvests (e.g. `OrderService.place`), `file` is relative to the
repo root, `line` is where the function starts.

**Steps**: inside each function, in source order (`seq` 1, 2, 3…), what it does that matters:

| `type` | `target` | Also |
|---|---|---|
| `call` | another function `id` in this service | |
| `egress` | an egress `id` | `operation`; `event` when it publishes an event type |
| `resource` | a resource `id` | `operation` (`find`, `insertOne`, `GET order:{id}`, `PutItem`…); `access: "read"`/`"write"` when the operation name does not say |

Optional on any step: `condition` (it only happens if…), `loop: true`, `mode: "async"`, `note`.
Every `target` must exist in the same manifest, or the manifest is rejected.

**Ingress**: every way into the service: HTTP routes, RPC methods, queue consumers, crons.
`handler` is the function that runs. Mark public routes and crons `entryPoint: true` (nothing
inside the system calls them). Put `method` and `path` in `details` for HTTP.

**Egress**: every way out: HTTP and RPC clients, publishes to topics, queues and buses. Set
`mode: "async"` for fire-and-forget.

**Resources**: every data store used. `kind` (`mongodb`, `redis`, `dynamodb`, `postgres`, `s3`…),
a readable `name`, and a `bindKey` (below) so services using the same store are linked.

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
| EventBridge bus | `eventbridge:{bus}` | `eventbridge:acme-bus` |
| MongoDB | `mongodb:{cluster or db}/{collection}` | `mongodb:orders-db/orders` |
| Redis | `redis:{cluster}/{key pattern}` | `redis:cache-main/order:{id}` |
| DynamoDB | `dynamodb:{table}` | `dynamodb:payments` |
| Postgres | `postgres:{db}/{table}` | `postgres:users-db/users` |
| S3 | `s3:{bucket}` | `s3:acme-event-lake` |

Ingress keys may be patterns: set `"match": "glob"` (`*` = one path segment, `**` = anything),
e.g. a gateway proxy `http:* public/api/users/**`. Egress keys are always literal.

Redis: report each **key pattern** you use (`order:{id}`, `session:{token}`), not just the cluster.

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

`events` is `"*"` (everything, the default) or a list of names and globs. Channel kinds:
`sns-topic`, `sqs-queue`, `amqp-exchange`, `amqp-queue`, `eventbridge-bus`. If a service also
declares the same subscription with a different filter, Flow-Mapper shows a conflict; it does not
choose one.

## DTOs and store schemas (after the manifest)

These live outside the manifest, so re-harvesting a service does not erase them. Send all of them
in one call each, all-or-nothing:

```sh
# endpoint DTOs and event message DTOs
curl -sS -X POST "$FLOW/api/envs/prod/dtos" -H 'content-type: application/json' --data '{"dtos": [
  {"service": "orders-svc", "ingress": "in.create", "role": "request",  "content": {"customerId": "c_1", "items": []}},
  {"service": "orders-svc", "ingress": "in.create", "role": "response", "content": {"orderId": "o_1"}},
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
| HTTP GET / DELETE | `response` |
| Queue, topic or bus consumer without `events` | `request` (the message) |
| Consumer with `events` | none: send one `{"event", "content"}` per event type instead |
| Cron | none |

`content` is an example payload or a JSON Schema, whichever you can produce. Schemas take
`source: "code"` today; `"db"` is reserved for a future database harvester.

## Done when

- `POST /api/ingest?dryRun=1` returns 200 for your manifest.
- After sending, `GET /api/envs/{env}/health` shows none of your egress under "calls with no
  match" (`items.dangling`) unless the target really is not harvested yet, and none of your
  ingress under "never called" (`items.orphans`) unless it is public (mark it `entryPoint`).
- Event consumers list their event types, and no event shows as "unhandled" unless it really is.
- Running the harvester twice on the same commit produces the same manifest (stable ids, stable
  order), only with a higher `version`.
