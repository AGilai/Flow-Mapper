# Design environments: senior developer's plan

Read: BRIEF, mockup rev 3 (frames 1-9 and "What the build needs"), flow-lane/scan/draw/cols/render/tab-view/desc, graph/*, system.js,
graph-cache, snapshots store, migrations 001/003, queries/map/inventory routes, core/trace types, core/description. Line counts are from `wc -l`.

## 0. Split before building (files at or over the limit that the features would touch)

| File | Lines | Why it must split | Split into |
|---|---|---|---|
| web/js/views/flow-draw.js | 244 | step numbers, folds, marks, bands and edit handles all land in `renderLane`, one 210-line function | `flow-spans.js` (pure: spans + `layout(col)`, now flow-draw.js:36-61), `flow-draw-head.js` (head cards, :63-87), `flow-draw-rows.js` (one fn per event type, :125-182), `flow-draw-events.js` (listeners, :201-241). renderLane stays as the ~70-line assembler and **returns geometry** `{ colX, ys, top, width }` (today local, needed by squeeze scroll and edit mode) |
| web/js/graph/canvas-graph.js | 262 | regions, marks, ghosts, link drawing | `canvas-input.js` (pointer, pinch, zoom, hit-test), `canvas-regions.js` (district labels today, subsystem boxes later) |
| server/store/snapshots.ts | 268 | copy, draft apply need non-tx ingest | `snapshot-read.ts` (list/get/load), `snapshot-ingest.ts` (apply, diff, **`ingestIn` without tx**), `snapshot-crud.ts` |
| server/mcp/tools.ts | 227 | ~10 new tools | `tools-envs.ts`, `tools-drafts.ts`, `tools-threads.ts`; `tools.ts` only concatenates |
| web/js/views/system.js | 170 | level control, subsystem grouping, marks, ghosts | `system-build.js` (rebuild: node/edge set + grouping + layout cache), `system-level.js` (level switch) |
| core/trace.ts | 447 | over already; **do not touch it** | marks join on the client by stable keys (see 3), so trace needs no change |

## 1. Features: files, shapes

### F1 Flow page: description, numbered steps, prev/next walk, step description, Squeeze (every env)
- **Steps (pure, new `web/js/views/flow-steps.js`)**: `stepsOf(lane) -> [{ n, row, event, from, to, key, label }]`. A step = lane event of
  type `call | hop(trunk or branch) | unresolved | store`; not `return | pill | mw | frontier | amqpnote`. A fan-out trunk + its branches = one
  step? Decide: one step per arrow row (simplest, matches frame 9). `key` = stable call key (see 3): `egr:<svc>/<egressId>`, `res:<svc>/<resId>`,
  `ing:<svc>/<id>` for the entry. Numbers drawn in `flow-draw-rows.js` as a small circled index at the arrow start.
- **Walk state** lives in the tab (`flow-tab-view.js`): `cur` step, `‹ ›`, ←/→ keys (guard `isContentEditable`, as mockup). New `flow-stepbar.js`
  (bar + collapsible step description). It sets `.cur` on the row (`[data-e=row]`), scrolls the step's x-range and row into view using the
  geometry renderLane now returns. Reuse `markArrow` (flow-tab-view.js:52) instead of a second highlight path.
- **Step description**: per-call key in the existing `descriptions` table (`callee = 'call:<svc>/<egressId>'`), no migration. `descBlock(store,
  root, callee, …)` already takes any callee. **Fix first**: `calleeService` (core/description.ts:31) splits on ':' and would read `call` as a
  service; `traceHash` per callee must hash only the step's messages. New `stepHash(trace, key)` in core/description.ts (stays < 130 lines).
- **Flow description**: exists (`descBlock(..., wholeFlow)` in flow-tab-view.js:32); only restyle into the wide `<details>` under the title.
- **Squeeze (pure, new `web/js/views/flow-squeeze.js`)**: `squeeze({ columns, spans, base, fit, keep }) -> Set<colIndex>` folded.
  `keep` = both ends of the current step + the caller column. Greedy: compute gaps with `columnGaps` (flow-cols.js:23); while total width > fit,
  fold the column farthest (by index) from the kept pair that is not kept; folded cols get width 28 and every span whose ends are both folded
  or that crosses only folded gaps gets `need = 0` (label hidden, number kept "on the fold", frame 9 note). Recompute gaps after each fold.
  Returns also `{ hiddenSteps: n[] }` for the note text. Toolbar toggle "Squeeze" in flows.js (on by default, `?squeeze=0` persists off).
  Draw: `flow-draw-head.js` renders a folded head as a dashed stub (`.fold rect`), bars on folded cols as a thin line.

### F2 Status marks (read-only), Compared with baseline | source now
- **Server diff core (pure)**: `core/diff-keys.ts` (stable keys per level), `core/diff-model.ts` (component/endpoint/egress/channel/resource/link),
  `core/diff-steps.ts` (calls inside a function: LCS on step signature, **never by `seq`**), `core/diff-json.ts` (DTO + collection schema
  fields by JSON path), `core/marks.ts` (highest-new-only pruning + "Changed one level up" propagation). Each < 150 lines.
- Shape: `Marks = { against: 'baseline'|'source', counts, items: Record<key, 'new'|'changed'|'removed'>, was: Record<key, string>,
  removed: Record<key, { label, group?, service? }> }`. Keys: `svc:x`, `ing:x/id`, `egr:x/id`, `ch:key`, `res:x/id`, `grp:path`,
  `link:id`, `step:x/fn#sig`, `dto:x/ing/role#$.a.b`, `evt:type#$.a`, `schema:key#$.a`.
- **Endpoint, not response changes**: `GET /api/envs/:env/marks?against=baseline|source[&draft=id]` (entity level + `fieldsChanged` flags) and
  `GET …/marks/fields?anchor=dto:x/ing/role` (field rows incl. removed ones). UI joins by key on system map, inventory, service page, flow
  lane (message -> key: `m.service + m.egress`, `m.store`, `m.target.ingress`), DTO/schema views. Trace, service-view, inventory responses stay
  as they are, the static preview returns `{ items: {} }` from api-local.js. New route file `server/routes/envs.ts`, new `server/marks-cache.ts`.
- Web: `web/js/components/mark.js` (spark / ring / struck helpers, SVG + HTML), `graph-style.js` draws the spark at node top-right.

### F3 Environments, copy, baseline, group, client
- Migration `005_envs.sql`: `envs (name PK, kind, source, mode, baseline_at, groups JSON, levels JSON, created_at, created_by)`; backfill
  `INSERT INTO envs SELECT DISTINCT env, 'harvested', … FROM snapshots`. `listEnvs` (snapshots.ts:26) must read `envs`, or a Blank env
  (no snapshot rows) does not exist.
- **Baseline storage**: there is no history to diff against. `snapshots` keeps ONE row per service and `entities` is replaced on every write
  (001_init.sql:2-24; snapshots.ts:81 replaceEntities); `changelog` stores keys only. "Versions are already kept per snapshot" in the mockup
  is wrong. So the copy writes the copied rows twice: into `<env>` and into a hidden env `<env>@baseline` (same tables: snapshots, entities,
  endpoint_dtos, event_dtos, store_schemas, links). `loadModel`/`buildIndex` work on it unchanged. `envs.kind = 'baseline'` hides it.
- `server/store/env-copy.ts`: one tx of `INSERT … SELECT` per table, modes blank | components (lists ingress/egress/resources/channels/
  bindings, no functions) | full; one-hop neighbours from `graphFor(source)`. Order matters: snapshots before DTO rows (FK, 001_init.sql:111).
- `service.group` lives in snapshots.meta JSON (no column). Schema: `group` (path, `^[a-z0-9-]+(/[a-z0-9-]+)*$`) and kind `client`
  in schema/manifest.schema.json:171 + samples. Name it `subsystem` in view shapes: "group" already means 4 other things (layout district,
  InventoryItem.group, stores.groupOf, Message.group).

### F4 System map grouped by subsystem + subsystem level
- `layout.js`: option `bands: string[]` -> group centres on a row (x = i * bandW) plus a weak x-clamp to the band; deterministic. ~20 lines.
- `canvas-regions.js`: per-group bbox (pure `regionBoxes(nodes, pos, pad)`) drawn behind nodes with the label on top; districts reuse it.
- Ghost nodes for `removed` components from `marks.removed` (no edges, muted).
- Subsystem level: **SVG, not the canvas** (3-10 boxes with lists, open circles, drag a link). New `web/js/views/subsystem-map.js` (render),
  `subsystem-link-drag.js` (edit mode), `subsystem-panel.js` (rolled-up call list, refine form).
- Data: `GET /api/envs/:env/views/subsystems` from pure `core/rollup.ts`: `rollup(sys: SystemGraph, groupOf, links) -> { groups:[{ path,
  components:[name] }], lines:[{ from, to, transport, mode, count, edges:[id] }], links:[AbstractLink & { ends: resolved level }] }`. Uses
  `collapsedEdges` (service -> service through channels). Abstract link store `server/store/links.ts`, migration `006_links.sql`.

### F5 Drafts and editing (forms, then canvas)
- Migration `007_drafts.sql`: `drafts (id, env, name, status, created_by, created_at, base JSON {service: version})`,
  `draft_ops (draft, seq, op JSON, base_hash, author, at)`.
- Pure `core/draft-ops.ts`: `Op = { kind: 'service.put'|'service.del'|'entity.put'|'entity.del'|'dto.put'|'link.put'|'link.del', service?,
  list?, key?, data? }`; `applyOps(model, ops) -> Model` (structuredClone once, then in place). `core/draft-conflicts.ts`:
  `conflicts(ops, currentModel) -> [{ op, reason }]` by `base_hash` (hash53 of the entity JSON at op time, core/description.ts:16).
- Server: `server/store/drafts.ts` (CRUD, ops), `server/draft-apply.ts`: one tx; per touched service a manifest: **kind `full` for a new
  service** (delta on a missing service is refused, snapshots.ts:166), else delta with `baseVersion` = current and `version` = current + 1;
  DTO/link ops written in the same tx. `tx()` is not re-entrant (connection.ts:83 `BEGIN IMMEDIATE`), so apply calls `ingestIn`, not
  `ingestBatch`. Read with a draft: every read route takes `?draft=id`; `ctx.graph(env)` becomes `ctx.graphOf(req)` (27 call sites in
  routes, 18 in mcp/tools.ts), cached under `env#draft`.
- Forms (panel): `web/js/forms/component-form.js`, `endpoint-form.js`, `call-form.js`, `flow-form.js` (name), shared `form-kit.js`.
- **Canvas editing** (`web/js/views/flow-edit-layer.js` + `flow-edit-intents.js`): overlay on the lane body using renderLane's geometry: ⊕
  under each bar, drag ghost line, drop target = nearest column by x. Intent `addCall { fromBar, toCol, afterRow }` -> pure
  `insertionPoint(lane, row, bar) -> { service, fn, afterSeq }` (from the last event of the same bar above the row: `msg.fn`, `msg.seq`)
  -> ops: egress on caller, ingress on callee (or pick existing), step inserted after `afterSeq` (renumber in that fn only). "Add lifeline":
  `buildLane` drops columns with no events (flow-lane.js:188-189), so pass `pinned: [service]` participants that are kept. Label edits go to
  the panel form (frame 4: "click an arrow opens its form"); no in-SVG text editing.
- Flow names: `008_flow_names.sql` own table (`descriptions.source` has a CHECK, 003_descriptions.sql:15; adding a source = table rebuild).
- Import: `core/find-in-envs.ts` (search across GraphIndexes), `POST …/drafts/:id/import` turns found items into `entity.put` ops.

### F6 Discussions (later phase): `009_threads.sql`, `server/store/threads.ts` (copy of the bug-comment pattern, `updatedSince`),
`web/js/components/thread.js`, anchors = the same stable keys as marks (one key grammar for marks, threads, descriptions).

## 2. The pure core to extract first, with tests

| Module | Test cases |
|---|---|
| web/js/views/flow-spans.js (moved from flow-draw) | same widths as today on existing lane fixtures (golden numbers from tests/flow-lane.test.ts traces) |
| flow-steps.js | returns, pills, mw, amqpnote are not steps; fan-out trunk + branches numbering; unresolved and store are steps; a "called again" column keeps its step order; nested async cards are not numbered |
| flow-squeeze.js | fits already -> no fold; step ends at col 0 and col 9 -> folds 1..8 farthest first, not the caller; adjacent ends -> folds the outer columns; fit smaller than the two kept heads -> folds all others, never a kept one; a span between two folded cols needs 0; deterministic order on ties |
| core/diff-keys.ts + diff-model.ts | identical models -> no marks; new service -> `svc` new only (its endpoints not repeated); endpoint added on old service -> `ing` new + `svc` changed; bindKey change -> changed with `was`; removed service carries label + group; Components copy compared with "source now" ignores functions and services outside the baseline set |
| core/diff-steps.ts | insert a step in the middle: one new, none changed (seq shifts ignored); reorder; delete; duplicate identical steps |
| core/diff-json.ts | field added, removed, type changed (`was`), child of a new field not marked, arrays (`devices[].x`), JSON Schema vs plain example DTO (reuse core/json-schema.ts flattening) |
| core/marks.ts | highest-new-only pruning; a changed field marks its message and endpoint "changed"; counts for the head sentence |
| core/rollup.ts | two calls same transport -> one line count 2; both directions -> two lines; intra-subsystem calls dropped; component with no group -> "ungrouped"; abstract link with both ends at endpoints is not drawn twice (it is a real call already) |
| core/draft-ops.ts + draft-conflicts.ts | put/del per list, op on a service created earlier in the same draft, del then put, conflict when the entity hash changed, no conflict when an unrelated entity of the same service changed |
| layout.js `bands` | same input -> same positions; every node's x within its band; order follows `bands` |
| insertionPoint | drop under the first row of a bar -> afterSeq 0; drop after a nested call -> after that call's seq in the outer fn; drop in a middleware segment -> the middleware fn |

## 3. Hidden complexity and traps (file:line)

1. **No baseline exists in the data model** (see F3). Plan storage for it in phase 1; doubles rows for a full copy (disk is 19 GB, fine).
2. `listEnvs` = `SELECT DISTINCT env FROM snapshots` (snapshots.ts:26-28): a Blank env and the hidden baseline env both break it.
3. `tx()` is not re-entrant (server/db/connection.ts:83-93): copy, draft apply and "import into draft" must use inner non-tx functions.
4. Delta ingest of an unknown service is refused (snapshots.ts:165-166) and versions must strictly grow (:161); a draft apply must build
   full manifests for new components and bump versions itself.
5. Graph cache is unbounded and `dropIfChangedElsewhere` clears every env (graph-cache.ts:11-17). Adding baselines, drafts and "source now"
   multiplies entries on a 2 GB box: make it an LRU (~8 indexes) and cache **marks** (small) rather than baseline indexes. "Source now" marks
   must also drop when the source env changes: `ctx.changed(src)` invalidates marks of every env whose `source = src`.
6. Message has no stable id; `data-e` is a row index (flow-draw.js:127) that changes on every redraw (Squeeze, step walk, fold). The step walk
   and the drill-down's `markArrow` (flow-tab-view.js:54 `__events.findIndex(e.msg === m)`) must find rows by message identity after a
   redraw, and a draft refetch replaces the message objects, so select by stable key + occurrence, not by object.
7. `renderLane` lays out twice-plus: the `fit` loop shrinks columns (flow-draw.js:59-60). Squeeze must run inside that loop's model (fold
   first, then shrink), else the two fight. Header and body are separate SVGs (:77, :196) and must fold identically.
8. Number collision: queues already show numbered async rows "1", "3.1" (flow-async.js:109 `deliveryNumbers`, flow-draw.js:116-121). Step
   numbers need a distinct glyph and wording ("Step 3"), and the walk covers the top lane only; nested cards (flow-render.js depth > 0) not.
9. `buildLane` column choice (flow-lane.js:62-69 `pickCol`) opens a second column when an arrow would cross an open bar. "Group by subsystem"
   reorders columns after the fact (:188-189 sort), which brings those crossings back and splits a service across bands; with grouping on,
   pin one column per service and accept crossings (draw bands as runs of the sorted order).
10. `ServiceKind 'client'` collides with trace `Participant.kind 'client'` (trace.ts:28, the caller column) and system filters keep only
   `kind === 'service' | 'gateway'` (system.js:76, 83, 94; system-graph.ts:58). Emit client components as node kind `service`, `svcKind: 'client'`.
11. "group" is overloaded (layout.js:15 districts, inventory.ts:16/47/70, stores.groupOf, trace Message.group). Use `subsystem` in views.
12. `descriptions` keys callees by service and `calleeService` splits on ':' (core/description.ts:31); per-call keys need a prefix that
   function understands, and the AI "outdated" hash must cover one step, or every per-call note goes outdated on any change.
13. DTOs, event DTOs and store schemas are not in manifests (001_init.sql:100-133): copy, baseline, diff and draft ops each need a second
   path for them; endpoint_dtos cascades on snapshot delete, so a draft "delete component" also drops its DTOs on apply.
14. Removed calls cannot appear in a flow: the trace runs on the current model only. Phase 1: list removed calls under the diagram
   ("2 calls removed since the baseline") from `marks.removed`; a merged ghost trace is a separate, later decision for the maintainer.
15. Edit mode reuses click handlers that already mean select / look inside / fold (flow-draw.js:215-234, a 200 ms fold timer); edit mode
   needs its own handler set, not flags threaded through the existing ones.
16. Static preview (web/js/api-local.js) must answer every new read route (envs, marks, subsystems, drafts=none) or `npm run preview` pages
   break; CI runs it.
17. `buildLane` drops columns that no event touches (flow-lane.js:188): an added lifeline without a call vanishes until it has one.

## 4. Effort and build order

| # | Work | Size |
|---|---|---|
| 0 | Splits in section 0, `ctx.graphOf(req)`, LRU cache, `ingestIn` | M |
| 1 | F1 flow page: steps + walk + step bar (S), per-call descriptions (S), flow description restyle (S), Squeeze (M) | M |
| 2 | F3 envs table, copy (3 modes), hidden baseline, group + client in schema and samples | M |
| 3 | F2 diff core down to fields + marks endpoint + marks cache | L |
| 4 | Marks in UI: map, inventory, service page, flow lane, field tables, Compared-with switch | M |
| 5 | F4a map grouped by subsystem (bands, regions, ghosts) | M |
| 6 | F5 drafts core + store + apply + `?draft` reads + conflicts | L |
| 7 | F5 panel forms (component, endpoint, call, flow name) | L |
| 8 | F5 canvas editing (add call by drag, add lifeline, open form) | L |
| 9 | Import across envs + MCP draft tools | M |
| 10 | F4b subsystem level: rollup (S), links store + refine (M), SVG view + link drag (M) | L |
| 11 | F6 discussions + all-discussions page + AI per-call text through MCP | M |

Order rationale: do 0 and 1 first. They ship to every harvested env with no schema change, and the flow-draw split plus the geometry it
returns are what Squeeze, marks on calls and canvas editing (8) all need. Then 2 -> 3 -> 4 (phase 1 as the lead proposed). Move 5 into
phase 1 only if the maintainer needs the grouped map to read a design; it is independent of drafts. Within phase 2 build drafts against
the API and MCP first (6, 9). Forms (7) give full CRUD. Canvas editing (8) comes last because it is the riskiest UI and is only a
gesture layer over the same ops. The subsystem level (10) needs drafts for abstract links, so it follows 6. Everything is one stable key
grammar (section F2) shared by marks, threads and per-call descriptions. Fix it in step 3 and do not change it afterwards.
Total: about 4 L + 6 M, roughly 6-8 implementer-weeks with QA. Phase 1 (0-4) is about 2.5 weeks.
