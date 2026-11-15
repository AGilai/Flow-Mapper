# Designing a system from scratch (HLD then LLD)

For an AI agent with the MCP tools ([AGENTS.md](../AGENTS.md) first). You start from a requirement, not from documents or
harvested code. You end with a design environment a person can open, trace and review. The worked example in section 4
was run against a scratch server through `POST /mcp`, and `tests/mcp-tools-doc.test.ts` replays it, so it is known to work.

## 1. HLD: what to decide first

Work top-down and stop when a level answers the question the reader has. Each item maps to a Flow-Mapper object.

| Decide | Flow-Mapper object | Tool |
|---|---|---|
| **Subsystems**: the few big areas (a team or a deploy boundary each), 2 to 8 | env `groups` `{key, label, about}`; a component's `groupPath` | `create_env` (`groups`), `set_subsystem_settings` |
| **Components**: what runs inside each (service, gateway, lambda, client-app, infra), one line of purpose each | `svc:<name>` with `{kind, groupPath, team, description}` | `edit_in_draft` |
| **Channels**: how components talk: HTTP, gRPC, queues, topics, buses. One bind key per channel | `ing:` (receiver) and `egr:` (caller) sharing a `bindKey` | `edit_in_draft` |
| **Queues and topics**: declare each one once, in the component that owns it | `ch:<bindKey>` `{bindKey, kind: sqs-queue\|sns-topic\|amqp-exchange\|amqp-queue\|eventbridge-bus, name}` with `service` = owner | `edit_in_draft` |
| **Stores**: databases, caches, buckets, and who owns each | `res:<service>/<id>` with a `bindKey` | `edit_in_draft` |
| **Flows**: the 3 to 10 journeys that matter, each starting at an entry point | an `ing:` with `entryPoint: true` plus the handler `fn:` | `edit_in_draft`, `export_mermaid` |
| **Open questions**: what you could not decide | notes, comments, action items | `set_notes`, `add_comment`, `add_action_item` |

**A queue or topic needs a declaration.** Publisher and consumer sharing a `sqs:` / `sns:` bind key link, but until a
component declares the channel, `link_health` counts it in `channelsWithoutOwner` and `get_channel` has no name or kind
for it. Add `{"op": "upsert", "anchor": "ch:sqs:order-events", "service": "orders-svc", "data": {"bindKey": "sqs:order-events", "kind": "sqs-queue", "name": "order-events"}}`
(the op needs `service`, the owner; the worked example below does this).

**Bind keys link components.** A call finds its receiver because both carry the same `bindKey`: `http:POST orders-svc/orders`,
`sqs:order-events`, `redis:cache-main/stock:{sku}`, `postgres:orders-db/orders`. Pick one spelling per channel and reuse
it exactly (see [HARVESTER-GUIDE.md](HARVESTER-GUIDE.md)). `link_health` shows a call nobody receives as `dangling`.

HLD is enough when each flow is a readable sequence diagram (`export_mermaid`) and every channel has both ends. Do not
invent LLD to fill space: an unknown goes into an open question.

## 2. LLD: how deep to go

Add LLD only for the parts a developer will build next. Per component:

- **Endpoints with DTOs**: `ing:<svc>/<id>` (`{id, bindKey, transport, handler, details: {method, path}}`) and its DTOs
  `dto:<svc>/request/-/<ingress>` and `dto:<svc>/response/-/<ingress>` (status `-` is the success response; `404`, `4xx` or
  `default` name an error response). `data` is `{content}`: a JSON-shaped example whose leaf values are type names
  (`"string"`, `"integer"`, `"confirmed | rejected"`). Events: `evt:<Type>` with `{content}`.
- **Store schemas and keys**: a resource is `res:<svc>/<id>` `{id, kind, name, bindKey}`. For a Redis key put the key
  template in the name and bind key (`stock:{sku}`) and in the step (`details.keyTemplate`). A table or collection schema
  is `schema:<source>/<storeKey>` with the schema as `data` (see [API.md](API.md)).
- **Per-function steps**: `fn:<svc>/<id>` `{id, name, steps: [{seq, type, target, operation, mode?, condition?, event?}]}`.
  `type` is `call` (another function of the same service; `target` its id), `resource` (a store; `target` the resource id,
  `operation` like `INSERT orders`) or `egress` (a call out; `target` the egress id, `mode` sync or async). The handler named
  in the endpoint is the function that runs first. One step per observable action, in order; use `condition` for branches.

How much is enough: one entry flow traced end to end with its stores and events (HLD+) is the minimum. Add DTOs for
endpoints other teams call, key templates for shared caches, and steps for any function with a branch or a side effect.
Stop at what you would put in a design review; leave algorithms to code. State assumptions in `set_notes`.

## 3. The loop in practice

1. `create_env` mode `blank`, with `groups`. 2. `open_draft`. 3. `edit_in_draft` in batches by component (all or nothing per
call; an error lists every bad op by index). 4. `draft_changes`, `link_health {draft}`, `export_mermaid {draft}`: fix,
repeat. 5. `apply_draft {dryRun: true}`, then `apply_draft`. 6. `share_env`.

Open questions have two homes. Flow-level: `set_notes {env, service, ingress, body}` (`body` is the whole Notes document; it
replaces the last version, read `get_notes` first), `add_comment {env, service, ingress, body}`, `add_action_item {env, service,
ingress, owner, description}`. Component-level: a `## Open questions` list inside the component's `about` (`edit_design`
`kind: "component"`, or `about` in the `svc:` upsert data); `list_open_questions` collects those.

Common errors: `INVALID ... unknown property` (a step or item field the schema does not allow; steps take only `seq, type,
target, mode, operation, condition, event, details, source...`), `env is required` (pass `env`), `404` (hidden or misspelt env or draft).

## 4. Worked example: orders-demo

Requirement: a shop web app places an order; orders-svc stores it, reserves stock in inventory-svc (sync), then
announces `OrderPlaced` on a queue that notify-svc turns into an email. Subsystems: `storefront` (shop-web, orders-svc) and
`fulfillment` (inventory-svc, notify-svc). The 20 ops are in [examples/orders-demo-ops.json](examples/orders-demo-ops.json).

**1. Create the design** (no `source` needed for `blank`; designs start private):

```json
create_env {"name": "orders-demo", "mode": "blank", "groups": [
  {"key": "storefront", "label": "Storefront", "about": "What customers touch: placing an order."},
  {"key": "fulfillment", "label": "Fulfillment", "about": "Stock and notifications after an order."}]}
```

**2. Open a draft:** `open_draft {"env": "orders-demo", "name": "First design", "slug": "first"}` returns `{slug: "first", status: "open", ops: 0}`.

**3. Add the design.** `edit_in_draft {"env": "orders-demo", "draft": "first", "ops": [...]}` with, for example:

```json
{"op": "upsert", "anchor": "svc:orders-svc", "data": {"kind": "service", "groupPath": "storefront", "team": "checkout", "description": "Owns orders: validates, stores, reserves stock, announces."}}
{"op": "upsert", "anchor": "ing:orders-svc/in.createOrder", "data": {"id": "in.createOrder", "bindKey": "http:POST orders-svc/orders", "transport": "http", "handler": "create_order", "entryPoint": true, "details": {"method": "POST", "path": "/orders"}}}
{"op": "upsert", "anchor": "egr:orders-svc/out.reserve", "data": {"id": "out.reserve", "bindKey": "http:POST inventory-svc/reserve", "transport": "http", "mode": "sync"}}
{"op": "upsert", "anchor": "egr:orders-svc/orderEvents.publish", "data": {"id": "orderEvents.publish", "bindKey": "sqs:order-events", "transport": "sqs", "mode": "async", "events": ["OrderPlaced"]}}
{"op": "upsert", "anchor": "fn:orders-svc/create_order", "data": {"id": "create_order", "name": "create_order", "steps": [
  {"seq": 1, "type": "resource", "target": "ordersDb", "operation": "INSERT orders"},
  {"seq": 2, "type": "egress", "target": "out.reserve", "operation": "POST /reserve", "mode": "sync"},
  {"seq": 3, "type": "resource", "target": "ordersDb", "operation": "UPDATE orders"},
  {"seq": 4, "type": "egress", "target": "orderEvents.publish", "operation": "SendMessage", "mode": "async", "event": "OrderPlaced"}]}}
{"op": "upsert", "anchor": "ch:sqs:order-events", "service": "orders-svc", "data": {"bindKey": "sqs:order-events", "kind": "sqs-queue", "name": "order-events"}}
{"op": "upsert", "anchor": "ing:notify-svc/in.orderEvents", "data": {"id": "in.orderEvents", "bindKey": "sqs:order-events", "transport": "sqs", "handler": "on_order_placed", "entryPoint": false}}
{"op": "upsert", "anchor": "dto:orders-svc/request/-/in.createOrder", "service": "orders-svc", "data": {"content": {"customerId": "string", "items": [{"sku": "string", "qty": "integer"}]}}}
{"op": "upsert", "anchor": "evt:OrderPlaced", "data": {"content": {"orderId": "string", "customerId": "string", "total": "number"}}}
```

The reply is `{from: 1, to: 20, counts: {added: 5, ...}}`. The other ops add shop-web (`client-app`, calling
`http:POST orders-svc/orders`), inventory-svc (`in.reserve`, a Redis `stockCache` decremented in `reserve_items`), notify-svc
(`on_order_placed` calling `http:POST mail-provider/send`), the response DTO and the `ordersDb` resource.
`entryPoint: false` on `in.reserve` and `in.orderEvents` keeps them out of the entry-point list: they are reached from `orders-svc`.

**4. Review the draft.** `draft_changes {"env": "orders-demo", "draft": "first"}` lists the added items grouped under their
component. `export_mermaid {"env": "orders-demo", "draft": "first", "service": "orders-svc", "ingress": "in.createOrder"}` returns:

```
sequenceDiagram
client->>orders_svc: POST /orders
orders_svc->>postgres_orders_db_orders: INSERT orders
orders_svc->>inventory_svc: POST /reserve
inventory_svc->>redis_cache_main_stock_sku: DECRBY stock:{sku}
inventory_svc-->>orders_svc: return
orders_svc->>postgres_orders_db_orders: UPDATE orders
orders_svc-)notify_svc: SendMessage sqs:order-events · OrderPlaced
notify_svc->>http_POST_mail_provider_send: POST /send
orders_svc-->>client: return
```

(participant declarations omitted). `link_health {"env": "orders-demo", "draft": "first"}` shows `dangling: 1`: the
mail provider has no component yet. That is a true open question, so record it:
`add_action_item` / `set_notes` ("who sends the email: SES or a provider service?"; arguments above) rather than inventing a component.

**5. Apply.** `apply_draft {"env": "orders-demo", "draft": "first", "dryRun": true}` returns `applied: false` and one result
per component with its contract report (`missing-source` infos are normal for a design: nothing was harvested from code).
Then the same call without `dryRun` returns `applied: true`. `list_entry_points {"env": "orders-demo"}` now lists
`orders-svc in.createOrder`, and `export_mermaid` works without `draft`.

**6. Share.** `share_env {"env": "orders-demo", "members": [{"user": "Dana", "role": "editor"}]}` or `{"published": true}`.
(With auth off the owner is empty; on a hosted server the env belongs to the token's user.)

To replay it yourself: run `create_env` and `open_draft` as above, then pass the file's array as `ops`.
