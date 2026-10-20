# Demos: where to see each feature

Every fix and feature has a case in the sample data (`samples/`, env `prod`), loaded on the shared
server by `node --disable-warning=ExperimentalWarning scripts/seed.ts`. Open the links on the
server (`http://localhost:3000/` through your port forward); the env picker must say `prod`.

Add a row here with every fix or feature (newest first). A row without a working link is not done.

| Version | Bug | What to look at | Link |
|---|---|---|---|
| 0.6.1 | #28 | A call through a wrapper is one egress with a "via SNSManager.publish" chip; expand it for the 2-hop chain with code links | `#/services/orders-svc` (Egress, sns:order-events) |
| 0.6.0 | #23 | A 404 response card next to the success response; a DTO's source line (file:line, incomplete) | `#/services/orders-svc?ep=in.get` |
| 0.5.0 | — | Topic page as a flow: summary, callout, merged disagreeing subscription, delivery grid | `#/channels/sns%3Aorder-events` |
| 0.5.0 | — | Queue fed by 6 sources, possible event types | `#/channels/sqs%3Aanalytics-all-events` |
| 0.4.8 | #25 | JSON Schema DTO shown as a field table (nested object, enum, `$ref`), with a Raw JSON toggle | `#/events/PaymentFailed` |
| 0.4.7 | #24 | Event types without a message DTO | `#/inventory?type=event&dto=no` |
| 0.4.4 | #22 | A data store whose key the harvester could not resolve: "Key unknown: <reason>" | `#/stores/orders-svc%3AsessionCache` |
| 0.4.3 | #19, #20 | System map: type a filter (e.g. `orders`), then raise Hops | `#/system` |
| 0.4.3 | #21 | System map: click a line for the connection's calls, code links and filter | `#/system` |
| 0.4.2 | #17 | Event types as collapsible cards in the endpoint panel | `#/services/inventory-svc?ep=in.orderEvents` |
| 0.4.2 | #18, #14 | Egress fan-out counts confirmed consumers; "maybe to" for possible events | `#/services/payments-svc` |
| 0.3.2 | #12 | Ingress "from" lists only publishers whose events pass the filter; "maybe from" | `#/services/analytics-svc` |
| 0.3.2 | #13 | An unresolved egress row with its id and reason | `#/services/orders-svc` (Unresolved by the harvester) |
| 0.4.0 | — | Contract report: `POST /api/ingest?dryRun=1` with any sample returns `contract` findings | API only |
