# Demos: where to see each feature

Every fix and feature has a case in the sample data (`samples/`, env `prod`), loaded on the shared
server by `node --disable-warning=ExperimentalWarning scripts/seed.ts`. Open the links on the
server (`http://localhost:3000/` through your port forward); the env picker must say `prod`.

Add a row here with every fix or feature (newest first). A row without a working link is not done.

| Version | Bug | What to look at | Link |
|---|---|---|---|
| 0.9.6 | #35 | A consumer first met as the consumer of a queue sits right of that queue even when a second topic feeds the same queue (controller after `saga2-account-sqs-erase`, not 3rd column); only the entry eraser (an upstream caller) is pointed back to | `#/flows?service=saga2-eraser-entry&ingress=in.erase` |
| 0.9.5 | — | Async deliveries end in a coloured dot: click jumps to that consumer's sub-flow lower on the page (shaded band in the dot's colour, half-row gap above it), right-click or shift-click opens its own flow; nested flows nest their bands | `#/flows?service=saga-controller&ingress=in.start` |
| 0.9.4 | #35 | Under a topic's activation bar only its own deliveries (rows 2.1, 2.2, ...) now sit; what the consumers do hangs under the bar, delivery 1 first | `#/flows?service=api-gateway&ingress=in.createOrder` and `#/flows?service=saga-controller&ingress=in.start` |
| 0.9.4 | #35 | The saga demo is now three services (`saga-controller`, `saga-eraser-a`, `saga-eraser-b`): a delivery pointing back over its publish has its own row so labels no longer overlap; repeats ("↩ seen at step N") show a dashed chip at the arrow end | `#/flows?service=saga-controller&ingress=in.start` |
| 0.9.3 | #43 | `saga-eraser-a` publishes the same status event from three places (since 0.9.4 across three services); the controller answers by advancing both erasers again. The saga is expanded under the first delivery; the other two are one muted line "↩ seen at step N" (before: 43 messages, now 21); click it to see the first step | `#/flows?service=saga-controller&ingress=in.start` |
| 0.9.2 | #35 | Fan-out of 12 queues, consumers called first by the gateway: the lifelines read topic, queue, consumer, queue, consumer; only the gateway's own queue points left | `#/flows?service=stress-gateway&ingress=in.startChecked` |
| 0.9.2 | #35 | Same topic, consumers seen nowhere else; labels on the publish/delivery rows are clipped to their arrows | `#/flows?service=stress-gateway&ingress=in.start` |
| 0.9.2 | #40 | A delivery through a filtered subscription names the matched event ("· account.tenant.deleted"); the side panel says "Delivered as" | `#/flows?service=account-lambda-erase-controller&ingress=in.publishDeviceEvent` |
| 0.9.7 | #44 | Two services both use `eventFrom: "event"` (agent-info binds two types, device-events binds `agent.device.loggedOut`): the types are no longer mixed. The service's events/health show no `undelivered` row for the other service's types; the device-events publish reaches only its `device-logged-out` queue | `#/flows?service=account-lambda-device-events&ingress=in.logout` |
| 0.9.1 | #42 | Shared `requestForcedDisconnection(eventName)` called from two entry points with different `bind`s: this one delivers only to the `entry.does.not.exist` queue; the side panel says "Event from caller AgentInfoHandler.onUnknownEntry:1: bind event=entry.does.not.exist" | `#/flows?service=account-lambda-agent-info&ingress=in.unknownEntry` |
| 0.9.1 | #42 | The other entry point, same shared publish: only the `schema.validation.violation` queue | `#/flows?service=account-lambda-agent-info&ingress=in.invalidSchema` |
| 0.9.0 | #41 | Four steps that exclude each other (event priority10/15/20/30, one condition each) drawn as one alt frame: "alt" tab, the condition in brackets at the top of each section, dashed lines between sections, each branch's subscribers inside it, a call in the last branch | `#/flows?service=account-lambda-erase-controller&ingress=in.advanceErase` |
| 0.8.10 | #40 | A publish with no event type no longer fans out to every subscriber: only subscriptions matching the egress's events or candidates are followed (candidate-only ones dashed, italic, "possible"); unfiltered subscriptions still get it | `#/flows?service=account-lambda-erase-controller&ingress=in.publishDeviceEvent` |
| 0.8.10 | #40 | Event fully unknown: filtered subscriptions are not reached, one "event unknown: not delivered" message under the topic | `#/flows?service=account-lambda-erase-controller&ingress=in.publishUnknownEvent` |
| 0.8.9 | #39 | Frontier markers do not count toward maxMessages: the folded "frontier: 8 steps" marker still shows and nothing else is cut (test builds a trace with many folded functions) | `#/flows?service=orders-svc&ingress=in.remove` |
| 0.8.7 | #35 | Publish and delivery on one row (single queue, and each leg of a fan-out); lifelines run producer > topic > queue > consumer; delivery labels are clipped to their arrow (hover for the full text) | `#/flows?service=account-lambda-erase-controller&ingress=in.notifyBilling` and `#/flows?service=api-gateway&ingress=in.createOrder` |
| 0.8.7 | #26 | "Show all 11" on the producer fan-in now expands all producers ("Show fewer" collapses) | `#/events/domain.tenant.erase.status.change` |
| 0.8.5 | #35 (part 2) | SNS fan-out: sns:order-events topic gets an activation bar; each of its 3 deliveries is its own row 3.1, 3.2, 3.3 (queue and consumer level), the consumer's calls follow; untick "Queues and topics" for the direct arrows | `#/flows?service=api-gateway&ingress=in.createOrder` (Full flow) |
| 0.8.6 | #36 | Store page: orders-svc has read, write and R/W pills; `findOneAndUpdate` is `access: "read_write"` and counts as reader and writer | `#/stores/mongodb%3Aorders-db%2Forders` |
| 0.8.6 | #37 | Store page: the `findOneAndUpdate` step lists its fields by role (filter, project, update, sort); `viewCount` is flagged dashed as not in the schema. Trace side panel: click the `findOneAndUpdate` arrow; contract report code `field-not-in-ddl` | `#/stores/mongodb%3Aorders-db%2Forders`, `#/flows?service=orders-svc&ingress=in.touch` |
| 0.8.4 | #26 | Event page, fan-in: 11 producers into one topic, queue and consumer are 11 producer nodes joined by a bracket, then one node each; 8 shown, "3 more producers" with Show all | `#/events/domain.tenant.erase.status.change` |
| 0.8.4 | #35 | A send straight to a queue that a service consumes: service → queue → billing-eraser, drawn once; queues sit left of their consumer; untick "Queues and topics" and it is the one arrow service → billing-eraser | `#/flows?service=account-lambda-erase-controller&ingress=in.notifyBilling` |
| 0.8.3 | — | Flows: component count in brackets after each entry point (tooltip has the breakdown); drag the list's right edge or the details panel's left edge to resize (arrows move 16px, double-click resets) | `#/flows?service=api-gateway` |
| 0.8.2 | #34 | A DELETE whose call tree is a frontier: folded into "frontier: 8 steps", click it to expand; two classified leaves (db_access, external_pkg) shown as notes, not unresolved | `#/flows?service=orders-svc&ingress=in.remove` |
| 0.8.1 | — | Long event names stay inside their chips (break after `.` `-` `_`, ellipsis for a single long segment, full name in the tooltip) in publisher, filter and consumer nodes | `#/channels/sns%3Aproduction-event-bus-sns` |
| 0.8.0 | #27 | Clients table on a Redis key: 6 services; direct driver (ioredis 5.3.2), shared library `saferxlib` bundling ioredis 4.27.6 next to their own 5.x (coloured 5.x / 4.x pills and a callout naming saferxlib), an own wrapper on ioredis 4.28.5, one with the driver version unresolved, a 2-hop via | `#/stores/redis%3Acache-main%2Forder%3A%7Bid%7D` |
| 0.8.0 | #27 | Direct driver on MongoDB (mongodb 6.3.0) | `#/stores/mongodb%3Aorders-db%2Forders` |
| 0.8.0 | #27 | Inventory driver facet: "ioredis 4.x 5 services": the filter lists services and where the 4.x comes from (services on 4.x through their own driver or a lib's) | `#/inventory?type=store%3Aredis&driver=ioredis%404` |
| 0.8.0 | #27 | Same list as API and MCP | `GET /api/envs/prod/clients?driver=ioredis&driverMajor=4`, MCP `list_clients` |
| 0.7.1 | #33 | One publish arrow to `sns:order-events`, then one fan-out hop to the shipping queue, although the topic owner and the consumer both declare that subscription | `#/services/api-gateway` → Trace a flow from POST /orders (full flow) |
| 0.7.0 | #26 | Event page as a flow: collapse beyond 8, `*` consumer, no-handler callout, direct send + topic (one consumer node, 2 ingresses), possible producer (dashed), click a service for its panel | `#/events/account.tenant.terminated.priority10` |
| 0.7.0 | #26 | Only a possible producer | `#/events/account.tenant.suspended` |
| 0.7.0 | #26 | No producer (consumers still shown, footnote) | `#/events/account.tenant.restored` |
| 0.7.0 | #26 | Unresolved target (dashed grey row) | `#/events/account.invoice.voided` |
| 0.7.0 | #26, #11 | Every subscription filters it out: no consumer drawn; filtered queues stay in the API/MCP | `#/events/ProfileViewed` |
| 0.7.0 | #11 | `!` exclusion shown as "all except …" on a subscription | `#/channels/sns%3Aproduction-event-bus-sns` |
| 0.6.3 | #32 | A function whose caller the harvester could not find: "caller: callback_passed" in the Gaps column | `#/services/orders-svc` → Functions tab, OrderService.retryCharge |
| 0.6.3 | #30 | Handler resolution hops on an ingress ("via OrderController.create.bind"); a step's code location on the trace | `#/services/orders-svc` (POST /orders ingress), then Trace a flow from it |
| 0.6.1 | #28 | A call through a wrapper is one egress with a "via SNSManager.publish" chip; expand it for the 2-hop chain with code links | `#/services/orders-svc` (Egress, sns:order-events) |
| 0.6.0 | #23 | A 404 response card next to the success response; a DTO's source line (file:line, incomplete) | `#/services/orders-svc?ep=in.get` |
| 0.5.0 | — | Topic page as a flow: summary, callout, merged disagreeing subscription, delivery grid | `#/channels/sns%3Aorder-events` |
| 0.5.0 | — | Queue fed by 6 sources, possible event types | `#/channels/sqs%3Aanalytics-all-events` |
| 0.4.8 | #25 | JSON Schema DTO shown as a field table (nested object, enum, `$ref`), with a Raw JSON toggle | `#/events/PaymentFailed` |
| 0.4.7 | #24 | Event types without a message DTO | `#/inventory?type=event&dto=no` |
| 0.8.8 | #38 | A store whose DB instance is unknown, shared by two services: "Instance unknown: instance_id_null_until_MG-b (p81/p81-production)" | `#/stores/mongodb%3Ashipping-db%2Fshipments` |
| 0.4.4 | #22 | A data store whose key the harvester could not resolve: "Key unknown: <reason>" | `#/stores/orders-svc%3AsessionCache` |
| 0.4.3 | #19, #20 | System map: type a filter (e.g. `orders`), then raise Hops | `#/system` |
| 0.4.3 | #21 | System map: click a line for the connection's calls, code links and filter | `#/system` |
| 0.4.2 | #17 | Event types as collapsible cards in the endpoint panel | `#/services/inventory-svc?ep=in.orderEvents` |
| 0.4.2 | #18, #14 | Egress fan-out counts confirmed consumers; "maybe to" for possible events | `#/services/payments-svc` |
| 0.3.2 | #12 | Ingress "from" lists only publishers whose events pass the filter; "maybe from" | `#/services/analytics-svc` |
| 0.3.2 | #13 | An unresolved egress row with its id and reason | `#/services/orders-svc` (Unresolved by the harvester) |
| 0.4.0 | — | Contract report: `POST /api/ingest?dryRun=1` with any sample returns `contract` findings | API only |
