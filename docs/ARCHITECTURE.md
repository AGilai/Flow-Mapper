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
| `impact.ts` | bug impact (flows through linked entities) and suggested priority |
| `integrity.ts` | references inside one service |
| `schema-validate.ts` | small JSON Schema validator for our schema's keywords |

## server/

| File | What |
|---|---|
| `main.ts`, `app.ts`, `config.ts`, `context.ts` | startup and wiring |
| `http/router.ts`, `http/static.ts` | routing; serves web/ and type-stripped core/ |
| `db/connection.ts`, `db/migrations/*.sql` | SQLite and migrations |
| `store/snapshots.ts` | ingest (full/delta), CRUD, changelog |
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
tables render one page at a time; long lists are capped with "type to narrow"; sequence diagrams
can hide internal calls, data-store calls and deep levels.

Design tokens are in `css/tokens.css`. Transport colours (http, sns, sqs, amqp, data store,
broken) mean the same thing in every view.

## Conventions

- Keep files under ~250 lines; split by concern when they grow.
- core/ stays pure (no `node:` imports) so the browser can run it.
- Use `import type` for type-only imports (required by type stripping).
- New DB changes go in a new `server/db/migrations/NNN_name.sql`.
- Every behaviour change gets a test in `tests/`.
