# Build brief: RabbitMQ (topic exchanges and RPC over queues)

Approved mockup: `design/mockups/rabbitmq.html` rev 2 (commit a0d5d82). Its frame decision lists, the
"What the build needs from the contract" table and the "Decided (rev 2)" list are the spec. Two parts,
each its own branch, QA + designer review, merged and deployed before the next starts.

## Part A: contract, matching and the flow diagram (0.18.0)
- Contract (all optional, additive; schema, core types, samples, HARVESTER-GUIDE "RabbitMQ", API.md together):
  - binding `match: "amqp-topic"` with RabbitMQ rules: `*` = exactly one word, `#` = zero or more words
    (dot separated). A placeholder word like `{deviceId}` in a published routing key counts as one word.
    Keep `exact` / `glob` unchanged for existing data. Optional `details.bindingKey` (raw key as written).
  - amqp-exchange channel `details.type` (topic | direct | fanout | headers, document it),
    `vhost`, `durable`, `alternateExchange`.
  - publish egress `details.exchange`, `details.routingKey` (document). Headers exchange:
    `details.headers` + binding `details.xMatch` (all | any): match them; unknown headers = "possible".
  - RPC: bind key `amqp-rpc:{command}` on the caller's egress and the server's ingress, `transport: amqp`,
    `mode: sync`. Sync amqp defaults to unicast. `details.rpc {command, commandQueue, replyTo, exchange,
    correlation, timeoutMs, library}`, ingress adds `prefetch`.
  - amqp-queue channel `details.role`: rpc-command | rpc-reply.
  - `sendToQueue` via the default exchange: egress straight to `amqp-queue:{queue}`; drawn service → queue
    with no exchange lifeline.
- Trace: additive fields only (bindingKey / match result on deliveries through an exchange, `rpc` details on
  RPC call messages, the list of non-matching bindings per publish). Keep every existing trace field.
- Flow diagram (frames 1, 2, 2b): exchange publish = the 0.17 SNS chain (exchange lifeline, queue lifelines,
  one arrow per delivery, routing key once on the trunk, binding key as the branch marker like the SNS filter
  marker, tiles, "+N queues" fold), one muted "N bindings don't match: k1, k2" line linking to the exchange page,
  amber "no binding matches" pill when nothing matches. Type rules per the frame 1 table (direct and fanout:
  no marker).
  RPC = a sync call in olive `--t-rpc`: request arrow labelled with the command, dashed "reply" (or "reply or
  timeout N s" when timeoutMs), "amqp rpc" chip on the first call per caller/server pair, small glyph on later
  ones, only the first reply per pair labelled (timeouts always), server activation bar in olive, own sub-calls.
  No server harvested = red dashed arrow to "unresolved", "no server harvested". Message panel lists the
  AMQP details (frame 2). "×N loop" only if the steps already carry loop info; otherwise skip it.
  The "RPC replies: Show | Hide" toolbar switch is optional (skip if it costs much).
- Colours: retune `--t-amqp` to grape (#8e44d6 light, #c58cff dark) in web/css tokens; RPC over AMQP uses
  `--t-rpc`. Check nothing else used the old violet in a way that now clashes.
- MCP: trace output carries the new fields; tool descriptions mention RabbitMQ where transports are listed.
- Demo (env prod): samples with `saferx.EventExchange` (topic, 5 bindings with amqp-topic, 3 matching
  `device.{deviceId}.logout`, one publish matching nothing), services cp-middleware, swg-api, dpc-worker,
  activitylog, sxdns with RPCs (`rpc.sxdns.dns.resolve` with timeout, a nested RPC, one command with no server),
  one sendToQueue. Rows in docs/DEMOS.md. Exclude the new demo services from the frontier trace hash like
  earlier demos; existing traces must stay identical.
- Tests: amqp-topic matcher (the mockup's `topicMatch` cases: `audit.#` matches `audit`, `device.*.logout`
  does not match `device.a.b.logout`), RPC linking via amqp-rpc, unicast default, layout helpers.

## Part B: pages (0.19.0)
- Exchange page `#/instances/amqp%3A{name}` (frame 3), same pattern as the Redis instance page: head, verdict,
  callouts (published key matching no binding; binding with no harvested publisher), Publishers table,
  Bindings table with "Matched by", working "Test a routing key" box (topic rules; direct = equality).
  REST: reuse GET /api/envs/:env/instances[/:id] if it fits; MCP get_resource/instance as appropriate.
- Inventory (frame 4): exchanges and queues as rows with icons; RPC command/reply queues folded behind
  "Show RPC queues"; RPC commands listed as in the mockup.
- Service page (frame 5): an "amqp rpc" ingress group listing commands like HTTP routes, handler, callers;
  endpoint panel with callers and timeouts. Egress group for RPC calls.
