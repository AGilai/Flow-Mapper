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
UI / agent ── GET /api/envs/:env/... ─► server/routes/queries.ts ─► graph-cache.graphFor(env)
                                                                     └► core/graph-index.buildIndex(model)  (resolve once, cached)
                                                                         └► core/system-graph | service-view | trace | paths | health
```

## core/ (one concern per file)

| File | What |
|---|---|
| `types.ts` | Model, entities, Link, Resolution |
| `glob.ts` | bind-key glob matching and specificity |
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
| `reach.ts` | reverse reachability: entry points whose flows run a function |
| `channels.ts` | topic/queue/bus view: publishers, subscriptions, consumers, events |
| `hub.ts` | the compact hub views: edge markers, per-queue outcomes, problem-first order and fold, the event page's consumers |
| `channel-flow.ts`, `channel-summary.ts` | the flow of one channel: merged subscription rows, event type x destination grid, summary and callouts |
| `events.ts` | event types over the links: deliveries, derived producers, per-event handlers, event checks |
| `event-flow.ts`, `event-flow-summary.ts` | the flow of one event type: producer service, topic, queue, consumer service with the outcome (handled, no handler, possible, filtered), summary and callouts |
| `endpoint-info.ts` | an ingress with its handler, repo link to the handler's code, and DTOs |
| `impact.ts` | bug impact (flows through linked entities) and suggested priority |
| `integrity.ts` | references inside one service |
| `description.ts` | flow descriptions, pure: the trace hash, outdated flag, grouping of stored records, the two "Generate…" prompts |
| `schema-validate.ts` | small JSON Schema validator for our schema's keywords |

## server/

| File | What |
|---|---|
| `main.ts`, `app.ts`, `config.ts`, `context.ts` | startup and wiring |
| `http/router.ts`, `http/static.ts` | routing; serves web/ and type-stripped core/ |
| `db/connection.ts`, `db/migrations/*.sql` | SQLite and append-only migrations (applied in place, backed up first; see DESIGN.md) |
| `store/snapshots.ts` | ingest (full/delta), CRUD, changelog |
| `store/schemas.ts` | data-store schemas per source |
| `store/dtos.ts` | request/response DTOs per ingress endpoint (a response per status) and event DTOs, with provenance |
| `store/descriptions.ts` | flow descriptions: human record (REST) and AI record (MCP `set_description`), outdated flag against the current trace |
| `store/bugs.ts` | bug workflow, attachments, log scanning |
| `graph-cache.ts` | per-environment GraphIndex cache, health history |
| `routes/*.ts` | REST endpoints by area |
| `mcp/*.ts` | MCP protocol, tools, HTTP and stdio transports |

## web/

`js/main.js` boots and routes (hash routes, so it works on any static host). Each page is one
module in `js/views/`; anything a page shares lives in `js/components/` or `js/graph/`.
`js/api.js` talks to the server, or to `js/api-local.js` in the preview build.

Scale choices: the system map draws on canvas with a grid-accelerated force layout clustered by
team, quiet edges that brighten on focus, and labels placed by importance without overlap;
tables render one page at a time; long lists are capped with "type to narrow"; the flows page draws one activation bar per call
(`flow-lane.js`, `flow-scan.js`: pure layout rules; `flow-draw.js`: SVG), folds internal calls into a pill, ends
publishes at a rail and lists the async work in an index of expandable cards (`flow-async.js`, `flow-index.js`);
flow tabs (0.13.0): `flows.js` owns the open tabs and mirrors them in the URL (`tabs=` stable keys, `tab=`); `flow-tabs-state.js` is the pure part (keys, URL encode/decode, open/close/reopen order, "distinct" selection, keyboard map), `flow-tab-data.js` loads a tab by key (a sub-flow tab is one row of its origin's async tree, no request), `flow-tab-view.js` is one tab's DOM (breadcrumb, diagram, async list; kept alive while hidden, which is the tab memory), `flow-tabs.js` the strip and overflow list, `flow-tabs-anim.js` the 280 ms open animation, `flow-list.js` the entry-point list;
`flow-mw.js` holds the pure rules for ingress middleware segments (fold over 3, row spans), drawn on top of the bar by `flow-draw.js`; `flow-inside.js` and `flow-inside-panel.js` are the drill-down (middleware chain first). flow descriptions (0.14.0): `flow-desc.js` (store shared by every spot, the Human/AI two-box block, the one-line variant, the Human note editor), `flow-desc-dialog.js` (the Generate dialog, two copyable prompts), `flow-desc-tip.js` (bar hover popover); `flowRoot(key)` in `flow-tabs-state.js` says which flow a tab's descriptions belong to. sub-flows as full flows (0.15.0): `flow-render.js` draws one flow (lane + its own async list) and is used by a tab and by every expanded card; a card traces its consumer lazily from its ingress with the delivered event (`GET /trace?ingress=&event=`, so no API change), shares traces by request key through `createTabData().traceFor`, and `flow-sub.js` holds the pure helpers (caller lifeline, request from a row, cache key). Data-store stubs and deep levels can be hidden.

Design tokens are in `css/tokens.css`. Transport colours (http, sns, sqs, amqp, data store,
broken) mean the same thing in every view.

## Conventions

- Keep files under ~250 lines; split by concern when they grow.
- core/ stays pure (no `node:` imports) so the browser can run it.
- Use `import type` for type-only imports (required by type stripping).
- DB changes add a new `server/db/migrations/NNN_name.sql` (applied ones are frozen); see CLAUDE.md.
- Every behaviour change gets a test in `tests/`.
