# Architecture and code map

Flow-Mapper has no runtime dependencies. It runs on Node 22.18+ using built-ins only:
`node:sqlite` for storage, `node:http` for the server, and Node's TypeScript type stripping, so
`.ts` files run directly with no build step.

```
core/      Pure graph logic (no Node APIs). Runs on the server and, unchanged, in the browser.
server/    HTTP server, SQLite store, MCP. Imports core/.
web/       The UI: plain ES modules and CSS, no framework, no bundler. Imports core/ for the preview.
schema/    manifest.schema.json — the single source of truth for harvester manifests.
samples/   Hand-written example system (env "prod") with planted problems and a delta.
scripts/   seed, mock generator, static preview build.
tests/     node:test suites (core logic, HTTP API, MCP).
docs/      DESIGN (the why), API (the contract), this file (the where).
```

## Request path

```
harvester ── POST /api/ingest ──► server/routes/map.ts ─► server/store/snapshots.ts (validate, version, diff, write)
                                                           └► graph-cache.afterWrite(env) → invalidate + record health
store writes ── emit after commit ─► server/events/bus.ts (ring + `events` table) ─► server/routes/events.ts (GET /api/events, SSE)
UI / agent ── GET /api/envs/:env/... ─► server/routes/queries.ts ─► graph-cache.graphFor(env)
                                                                     └► core/graph-index.buildIndex(model)  (resolve once, cached)
                                                                         └► core/system-graph | service-view | trace | paths | health
```

## core/ (one concern per file)

| File | What |
|---|---|
| `types.ts` | Model, entities, Link, Resolution |
| `glob.ts` | bind-key glob matching and specificity |
| `amqp.ts`, `amqp-route.ts` | RabbitMQ (0.18.0): topic matching (`*` one word, `#` zero or more), headers match, routing of a publish by exchange type, the additive `amqp` / `rpc` trace info |
| `resolve.ts` | turns keys into links; dangling, orphans, unbound, ambiguous |
| `graph-index.ts` | lookup maps + adjacency over a resolved model; up/downstream walks |
| `system-graph.ts` | nodes/edges for the system map (with and without channels) |
| `service-view.ts` | one service's ingress/egress/resources with peers |
| `trace.ts` | ordered flow from an ingress or function (intra or full) |
| `paths.ts` | service-to-service paths |
| `health.ts` | link-health report |
| `search.ts` | text search |
| `harvest-quality.ts` | what harvesters report: unresolved items (with possible matches), mixed commits, drift |
| `contract.ts` | contract report for an ingested manifest: what it leaves out or cannot link, with a fix per finding |
| `inventory.ts` | every object in one list for the Inventory page |
| `stores.ts` | data stores: keys and groups, read/write access, store view |
| `clients.ts` | how services reach stores (`client`): rows, driver majors, mixed-major flag, counts |
| `keys.ts` | Redis key templates (#29): validation of what a harvester sends, rows per template and db, groups by owner (shared, no harvested writer), TTL disagreement, summary |
| `instances.ts` | Redis instances: the group of a bind key (`redis:cache-main`), who connects (access, client, databases), key flows from steps with `details.keyTemplate`, the keys view |
| `amqp-exchange.ts`, `amqp-inventory.ts`, `rpc-endpoint.ts` | Environments (0.21.0): the rail's picker is `components/env-picker.js` (rows from `state.envMeta`, text from the pure `env-info.js`); `#/envs/new` is `views/env-new.js` (page and submit), `env-new-groups.js` (subsystem chips, levels), `env-new-table.js` (component table, neighbours), CSS `css/envs.css`. The preview bundles `envMeta` and answers components and neighbours locally (`api-local-envs.js`); creating is refused there.

RabbitMQ pages (0.19.0): the exchange page data (publishers, bindings, callouts, the tester's `routesTo`), the inventory rows (exchanges, queues, folded RPC plumbing, RPC commands), the callers of an RPC command for the endpoint panel |
| `neighbours.ts` | one-hop neighbours of picked services (direct and through channels, each with a reason) and what a component brings into a Components copy (0.21.0) |
| `channels-for.ts` | the channels and bindings a Components copy must bring so it is self-contained (used, routed to, between copied items); the server copies with it and the page counts with it |
| `reach.ts` | reverse reachability: entry points whose flows run a function |
| `channels.ts` | topic/queue/bus view: publishers, subscriptions, consumers, events |
| `hub.ts` | the compact hub views: edge markers, per-queue outcomes, problem-first order and fold, the event page's consumers |
| `channel-flow.ts`, `channel-summary.ts` | the flow of one channel: merged subscription rows, event type x destination grid, summary and callouts |
| `events.ts` | event types over the links: deliveries, derived producers, per-event handlers, event checks |
| `event-flow.ts`, `event-flow-summary.ts` | the flow of one event type: producer service, topic, queue, consumer service with the outcome (handled, no handler, possible, filtered), summary and callouts |
| `endpoint-info.ts` | an ingress with its handler, repo link to the handler's code, and DTOs |
| `impact.ts` | bug impact (flows through linked entities) and suggested priority |
| `integrity.ts` | references inside one service |
| `description.ts` | flow descriptions, pure: the trace hash, outdated flag, grouping of stored records, the two "Generate…" prompts, step keys (`stepKey`, `stepKeys`: one arrow of a flow, from message content) |
| `schema-validate.ts` | small JSON Schema validator for our schema's keywords |
| `anchors.ts` | the one anchor grammar (`svc:`, `ing:`, `dto:`, `evt:`, `schema:`, `flow:`, `...#field`): parse, row of an anchor, anchor of a row, parent |
| `item-rows.ts` | `ItemRow {service, list, key, data}`, the one row shape of baselines, drafts and the diff; `rowsToModel` (same output as `loadModel`) and `rowsToExtras` |
| `diff/` | marks: `normalise` (what is noise), `side` (indexed rows), `steps` (LCS by content), `fields` (DTO/schema fields), `entities` (per-row marks), `propagate` (prune, roll-up, counts), `what` (phrases), `index` (`diffEnv`) |
| `draft-ops.ts`, `draft-manifests.ts` | net ops, overlay, the one change count; net ops -> manifests (full v1 / delta v+1 / replace), side ops, deletes |
| `import-plan.ts` | an HLD import plan (docs/DESIGN-IMPORT.md) -> draft ops, with the errors and warnings |

## server/

| File | What |
|---|---|
| `main.ts`, `app.ts`, `config.ts`, `context.ts` | startup and wiring |
| `http/router.ts`, `http/static.ts` | routing; serves web/ and type-stripped core/ |
| `db/connection.ts`, `db/migrations/*.sql` | SQLite and append-only migrations (applied in place, backed up first; see DESIGN.md); `tx()` is nestable (inner calls are savepoints) |
| `store/snapshots.ts` | thin re-export of the snapshot store |
| `store/snapshots-read.ts` | types, service/entity/model loads, changelog read |
| `store/snapshots-write.ts` | shared write helpers: diff, integrity check, entity/snapshot/changelog rows |
| `store/snapshots-ingest.ts` | manifest ingest (full/delta, batch, dry run) |
| `store/snapshots-crud.ts` | per-entity and per-service edits |
| `store/envs.ts` | the `envs` table (sealed / design), `guardEnv` (the one write guard), list with metadata, delete a design (0.21.0, migration 005) |
| `store/env-copy-channels.ts` | the shared channels and bindings of a Components copy, under one synthetic `<source>-infra` service |
| `store/env-copy.ts`, `store/env-copy-rows.ts` | create an environment by copying (blank / components / full) in one transaction; the row copiers and the baseline rows |
| `store/item-rows.ts` | an environment, its baseline and the source's current rows as ItemRows (0.23.0) |
| `store/drafts.ts`, `store/draft-validate.ts` | drafts and their ops (append-only, `seq` = MAX+1 in the transaction, undo / revert); per-op validation against the overlay (migration 006) |
| `store/draft-apply.ts`, `store/draft-side.ts`, `store/draft-plan.ts`, `store/draft-prelude.ts` | apply (net ops -> manifests -> `ingestIn` in one transaction, side tables, summary changelog row, `replaced`), DTO / schema / flow writes, plan import, the `?draft=` prelude of dry runs |
| `store/dry-run.ts` | `withDry`: the real write in a transaction that is rolled back |
| `store/schemas.ts` | data-store schemas per source |
| `store/dtos.ts` | request/response DTOs per ingress endpoint (a response per status) and event DTOs, with provenance |
| `store/descriptions.ts` | flow descriptions: human record (REST) and AI record (MCP `set_description`), outdated flag against the current trace |
| `store/keys.ts` | key templates pushed per Redis instance (full replace, versioned; migration 004) |
| `store/bugs.ts` | bug workflow, attachments, log scanning |
| `graph-cache.ts` | one LRU of GraphIndex (`FLOW_GRAPH_CACHE_MAX`, default 8; `size()`), keyed `env` or `env#draft:<slug>`; `invalidate(env)` drops the environment, every draft view of it and the memos that depend on it; a small memo (marks, cap 16); health history |
| `draft-reader.ts` | `DataReader`: DTOs, event DTOs, schemas, flow texts and service rows from the database (`dbReader`) or from a draft's overlay rows (`rowsReader`); `ctx.graphOf(req)` / `ctx.readerOf(req)` pick by `?draft=` |
| `marks.ts` | `marksFor`: baseline or source-now rows against the environment (+ draft) through `core/diff`, memoised |
| `routes/envs.ts` | `/api/envs/meta`, create by copy, components, neighbours, delete |
| `routes/drafts.ts`, `routes/marks.ts` | drafts (create, ops, changes, apply, plan) and `/marks` (0.23.0) |
| `routes/*.ts` | REST endpoints by area |
| `mcp/*.ts` | MCP protocol, HTTP and stdio transports |
| `mcp/tools.ts`, `mcp/tools/index.ts` | the tool list in client order (`tools.ts` re-exports `tools/index.ts`); `tests/mcp-tools.test.ts` pins names, descriptions and schemas |
| `mcp/tools/{map,flows,write,stores,bugs,envs,drafts,design}.ts`, `common.ts` | tool definitions by area; shared `Tool` type and helpers (`viewOf(c, a)` reads the environment or `a.draft`) |

## web/

`js/main.js` boots and routes (hash routes, so it works on any static host). Each page is one
module in `js/views/`; anything a page shares lives in `js/components/` or `js/graph/`.
`js/api.js` talks to the server, or to `js/api-local.js` in the preview build.

Scale choices: the system map draws on canvas (`graph/canvas-graph.js` is the interaction shell; `graph-draw-edges.js`, `graph-draw-labels.js` and `graph-hit.js` draw and hit-test from a state snapshot) with a grid-accelerated force layout clustered by
team, quiet edges that brighten on focus, and labels placed by importance without overlap;
tables render one page at a time; long lists are capped with "type to narrow"; the flows page draws one activation bar per call
(`flow-lane.js`, `flow-scan.js`: pure layout rules; `flow-draw.js`: SVG orchestrator, with `flow-draw-layout.js` (geometry), `-heads.js`, `-prims.js` (arrows, chips, stop bars), `-rows.js`, `-bars.js`, `-events.js`; `renderLane` returns `geometry`: column x per lifeline, y per row), folds internal calls into a pill, draws
a publish as a routing chain (service, topic, bus or exchange, each subscribed queue) that stops at the queue, and lists the async work in an index of expandable cards (`flow-async.js`, `flow-index.js`);
publish chains (0.17.0): `flow-chain.js` is the pure part (publish to legs, fan-out folding past 6 queues, lifeline order grouped per topic, filter marker text, number tiles). `flow-lane.js` turns the legs into `hop` rows (the event type is the label, like a REST path) and topic / queue lifelines; `flow-draw.js` draws narrow heads with a transport chip, solid arrows in the transport colour, a filter marker under the arrow, a stop bar at the queue and the number tiles; `deliveryNumbers(tree)` in `flow-async.js` is the one source of the numbers, shared by the tiles and the index rows. The old "published events" rail and the "Queues and topics" checkbox are gone. A hop through a subscription carries an additive `filter` on its trace message (docs/API.md);
flow tabs (0.13.0): `flows.js` owns the open tabs and mirrors them in the URL (`tabs=` stable keys, `tab=`); `flow-tabs-state.js` is the pure part (keys, URL encode/decode, open/close/reopen order, "distinct" selection, keyboard map), `flow-tab-data.js` loads a tab by key (a sub-flow tab is one row of its origin's async tree, no request), `flow-tab-view.js` is one tab's DOM (breadcrumb, diagram, async list; kept alive while hidden, which is the tab memory), `flow-tabs.js` the strip and overflow list, `flow-tabs-anim.js` the 280 ms open animation, `flow-list.js` the entry-point list;
`flow-mw.js` holds the pure rules for ingress middleware segments (fold over 3, row spans), drawn on top of the bar by `flow-draw.js`; `flow-inside.js` and `flow-inside-panel.js` are the drill-down (middleware chain first). flow descriptions (0.14.0): `flow-desc.js` (store shared by every spot, the Human/AI two-box block, the one-line variant, the Human note editor), `flow-desc-dialog.js` (the Generate dialog, two copyable prompts), `flow-desc-tip.js` (bar hover popover); `flowRoot(key)` in `flow-tabs-state.js` says which flow a tab's descriptions belong to. sub-flows as full flows (0.15.0): `flow-render.js` draws one flow (lane + its own async list) and is used by a tab and by every expanded card; a card traces its consumer lazily from its ingress with the delivered event (`GET /trace?ingress=&event=`, so no API change), shares traces by request key through `createTabData().traceFor`, and `flow-sub.js` holds the pure helpers (caller lifeline, request from a row, cache key). Data-store stubs and deep levels can be hidden.
Redis instance page (0.16.0): `views/instance.js` (head, verdict), `instance-lanes.js` (who connects, client panel), `instance-key-card.js` (a service's keys, loaded on request under its lane: writes and reads) and `instance-key-row.js` (one row and its in-place detail); `css/instance.css`. Inventory shows a Redis cluster/instance as one row (`instance` on the item) that opens `#/instances/<key>`.

RabbitMQ pages (0.19.0): `views/exchange.js` is the exchange page, reached through `views/instance.js` for `#/instances/amqp%3A<name>` (css in `exchange.css`); the Inventory folds RPC plumbing (`inventory.js`, `rpc-fold`); the service switchboard shows RPC commands and calls as olive "amqp rpc" groups and publishes as grape "amqp" groups; `endpoint-rpc.js` adds the callers and the command queue to the endpoint panel.

Fan-out trunk (0.19.1): `flow-lane.js` puts `publish` (topic, event, routing key, deliveries) on the trunk hop of a publish with 2+ deliveries; `flow-draw.js` draws a separate `hit trunk` rect for service to topic, and a click there opens `flow-panel-publish.js` (each delivery opens its own arrow).
Step walk (0.20.0): every flow page has the flow's description under its title (`flow-head.js`: a `<details>` around `descBlock` in its `wide` mode, open or closed kept in localStorage), a numbered step on each arrow and a walk bar above the diagram. `flow-steps.js` (pure) says which lane events are steps (calls, publish rows, unresolved calls, store stubs; not returns, pills, middleware, notes) and gives each a content key (`stepKeys` in `core/description.ts`, `#step:<from>><to>|<label>|<transport>`, `~2` for a repeat); `flow-walk.js` (pure) is the current step, the `step=` URL param and the keys (← → Home End, never in a text box, never `[ ]` or 1-9). `flow-walk-view.js` owns the walk of a tab: `flow-render.js` hands it each top-lane drawing (geometry from `renderLane`), `flow-step-tiles.js` draws the tiles and the halo from that geometry (class `steptile`, apart from the async `numtile`), `flow-stepbar.js` is the bar, the aria-live line and the step's description box. Step descriptions are rows of the `descriptions` table whose callee is the step key; the current step is kept across redraws by its key. CSS: `flow-walk.css`.
Squeeze (0.22.0): when a lane is wider than the room, lifelines fold into fold columns. `flow-squeeze.js` is pure: `planSqueeze` runs `planFold` in stages until the step's two ends fit (0 fold, caller kept; 1 the caller folds too; 2 compact folds `FOLD_COMPACT` wide, "⋯ N"; 3 kept columns narrow to `COL_NARROW`; else scroll, and `scrollLeftFor` in `flow-walk.js` brings both ends into view or at least the source end). `planFold({ n, ends, fit, widthOf })` keeps the caller (column 0) and the current step's columns, folds the columns between them first (one fold per contiguous run), then, while it still does not fit, the farthest from the step; a plan that is wider than the unfolded lane is dropped; `foldGroups`, `displayCols`, `foldedInside`, `eventCols` are its helpers. `flow-draw-layout.js` takes it as `layoutLane(lane, fit, { keep })` inside the fit loop (shrink the plain gap to `COL_MIN` first, then fold; `columnGaps` runs on display columns, a fold is `FOLD_W` wide and an arrow into it stops at its left edge); a folded lifeline's x is its fold's left edge, `barX` returns the fold's edge on that side, and `geometry` gains `folded`, `groups` and `plan(keep)`. `flow-draw-fold.js` draws the fold head (`.sq-fold`) and band (`.sq-band`), puts dots and the target name (`.sq-dots`, `.sq-to`) on arrows into a fold, and reduces a row wholly inside a fold to its label (the step tile stays); bars and lifelines of folded columns are not drawn. Not the middleware `.fold` / `data-mwfold`. `flow-walk-view.js` gives `endsOf(built)` (the current step's columns before the draw) and calls `onRestep(cols)` on a viewer's move; `flow-render.js` `restep` redraws only when `plan(cols)` differs from the drawn fold and puts focus back on the same arrow. Toolbar checkbox in `flows.js` (localStorage `flow-mapper.squeeze`, on by default); a click on a fold sets the tab's `sqOff` (`flow-tab-view.js`) until the checkbox is changed; the tab relanes on a width change (150 ms debounce). Async sub-flow cards get Squeeze too, keeping the caller and their first step. CSS: `flow-walk.css`.

RabbitMQ (0.18.0): an exchange publish reuses the chain above (`flow-chain.js` exchange marker via `flow-amqp.js`); RPC over AMQP is a sync call in olive (`flow-amqp.js`: chip per caller/server pair, reply labels; `flow-panel-amqp.js`: the panel's AMQP card).

Design tokens are in `css/tokens.css`. Transport colours (http, sns, sqs, amqp, data store,
broken) mean the same thing in every view.

## Conventions

- Keep files under ~250 lines (tests 350); split by concern when they grow. `npm run check:size` (part of `npm test`) enforces it; `scripts/check-size.ts` has an allowlist of existing oversize files that may shrink but never grow.
- core/ stays pure (no `node:` imports) so the browser can run it.
- Use `import type` for type-only imports (required by type stripping).
- DB changes add a new `server/db/migrations/NNN_name.sql` (applied ones are frozen); see CLAUDE.md.
- Every behaviour change gets a test in `tests/`.
