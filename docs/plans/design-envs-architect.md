# Architect: design environments: target architecture
Sources: migrations 001-004, store/*, graph-cache, core types/index/resolve/trace, mcp/tools, routes, api*.js, build-preview, mockup.

## 0. Facts that change the plan (verified in code)
- **Old versions are NOT kept.** `snapshots` holds one row per (env, service); `replaceEntities` deletes and
  rewrites the entities; `changelog.changes` holds only keys (`{added:{list:[key]}}`), not data; `health_history`
  holds counts. The mockup's line "versions are already kept per snapshot" is wrong: only the version *number*
  is kept. The baseline must be **frozen into its own table at copy/import time** (§1.2).
- DTOs (`endpoint_dtos`, `event_dtos`) and `store_schemas` sit outside the versioned path: no version, no changelog.
  Draft apply has to write them next to the ingest, in the same transaction.
- `tx()` is `BEGIN IMMEDIATE` and does not nest, and `ingestBatch` opens its own. Draft apply needs ingest plus
  side tables in **one** transaction, so `tx` becomes re-entrant (SAVEPOINT when `db.isTransaction`).
- Service header has `additionalProperties: false` and kind enum `service|gateway|lambda|infra`. Egress
  `transport` is required (enum). So `group`, `client` and "transport not decided" are schema changes
  (manifest.schema.json + samples together). `group` is stored in `snapshots.meta` JSON, so it needs no column.
- Over the size limit or at it: snapshots.ts 268, mcp/tools.ts 227, flow-draw.js 244, api-local.js 128 (it will grow).
  Split them before extending them (§3).
- `GET /api/envs` = `SELECT DISTINCT env FROM snapshots`. Harvesters create envs implicitly; that must keep working.

## 1. Data model
### 1.1 Migration `005_envs.sql` (phase 1a)
```sql
CREATE TABLE envs (
  name TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('harvested', 'design')),
  source_env  TEXT, mode TEXT CHECK (mode IN ('blank', 'components', 'full')),   -- design only
  baseline_at TEXT,                         -- when the baseline was frozen ("from prod, Oct 21 14:02")
  groups      TEXT NOT NULL DEFAULT '[]',   -- ordered [{path:'platform', label:'Platform'}]; path may be 'platform/identity'
  levels      TEXT NOT NULL DEFAULT '["Subsystem"]', -- level names, outermost first; "Domain" later
  description TEXT, created_by TEXT NOT NULL DEFAULT 'anonymous',  -- free text; env_members later
  created_at  TEXT NOT NULL
);
INSERT INTO envs (name, kind, created_at)
  SELECT env, 'harvested', MIN(updated_at) FROM snapshots GROUP BY env;

-- Frozen source rows. Absent = New. Present but missing from the env = Removed.
CREATE TABLE baseline_items (
  env TEXT NOT NULL, service TEXT NOT NULL DEFAULT '',  -- service '' = env-scoped (event DTO, schema, link)
  list           TEXT NOT NULL,             -- header | <entity list> | dto | event_dto | schema | link
  key            TEXT NOT NULL,             -- entity key; dto: ingress|role|status; schema: store_key|source
  data           TEXT NOT NULL,             -- JSON as it was in the source
  source_env TEXT NOT NULL, source_version INTEGER, taken_at TEXT NOT NULL,
  PRIMARY KEY (env, service, list, key)
);
CREATE TABLE flow_names (env TEXT NOT NULL, service TEXT NOT NULL, ingress TEXT NOT NULL, name TEXT NOT NULL,
  author TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (env, service, ingress));  -- descriptions' key, no FK
```
- Ingest calls `ensureEnv(db, env)` (`INSERT … ON CONFLICT DO NOTHING`, kind harvested), so new harvested
  envs still appear by themselves. `listEnvs` reads `envs` UNION the snapshot envs, to be safe during rollout.
- Per-item `source_env` makes imports work: an endpoint imported from `ztna-hld` is compared with *its* source.
  "Compared with: source now" loads each source env's current rows for the keys that have a baseline row.
- **Full copy of a design** copies the source's `baseline_items` too. Recommended, so marks against prod survive
  duplication (decision D3).
### 1.2 Diff per level (pure, in core/diff/*)
Input on both sides is `DiffInput = {model: Model, dtos, eventDtos, schemas, links}`. The server builds the
baseline side from `baseline_items` and the current side from the env (plus a draft overlay).
- **Normalise before comparing**: drop `service`, `provenance`, `source.commit`/`runId` and, on the header,
  `group`/`version`/`harvestedAt`/`commit`. Otherwise every copied item would read Changed after groups are assigned.
- **component** = header + the item lists of the service. **endpoint** = ingress. **call** = egress, plus the
  function step that reaches it. **channel**, **binding**, **resource**: by key.
- **message** = endpoint DTO (`dto:<svc>/<ingress>/<role>/<status>`) and event DTO (`evt:<type>`).
  **field**: `isJsonSchema(content)` → `schemaRows()` (core/json-schema.ts, already pure); otherwise flatten the
  example JSON to `path → typeof`. A field is New, Removed, or Changed on type/enum/required, with `was` text.
  **Collection field**: the same, over `store_schemas.content` per (key, source).
- **Roll-up**: a mark goes on the highest new anchor only (the children of a new parent get none). Any
  marked descendant makes the parent Changed, with a "what" phrase ("+1 endpoint", "message UserUpdated: 1 new field").
- Output is `EnvMarks = {marks: Record<anchor, {mark, what?, was?}>, ghosts: Record<anchor, data>, counts}`.
  Ghosts are the baseline data of Removed items, so the UI can draw them struck through.
- **Anchors** (core/anchors.ts, shared by marks, draft ops and threads): `svc:<s>`, `ing:<s>/<id>`, `egr:<s>/<id>`,
  `fn:<s>/<id>`, `ch:<key>`, `bind:<s>/<id>`, `res:<s>/<id>`, `dto:…`, `evt:<type>`, `schema:<key>/<src>`,
  `<anchor>#<field.path>`, `flow:<s>/<ingress>`, `call:<s>/<egressId>`, `grp:<path>`, `link:<id>`.
### 1.3 Migration `006_drafts.sql` (phase 1b)
```sql
CREATE TABLE drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,     -- PG: GENERATED ALWAYS AS IDENTITY
  env TEXT NOT NULL REFERENCES envs (name) ON DELETE CASCADE,
  slug TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'applied', 'discarded')),
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, applied_at TEXT, UNIQUE (env, slug)
);
CREATE TABLE draft_ops (
  draft_id INTEGER NOT NULL REFERENCES drafts (id) ON DELETE CASCADE, seq INTEGER NOT NULL,
  op        TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  target    TEXT NOT NULL,     -- header | entity | dto | event_dto | schema | link | group
  service TEXT NOT NULL DEFAULT '', list TEXT NOT NULL DEFAULT '', key TEXT NOT NULL,
  data      TEXT,              -- JSON, whole item (upsert)
  base_hash TEXT,              -- hash53 of the item in the env when the draft first touched it; NULL = absent
  origin    TEXT,              -- import: JSON {env, version}; becomes a baseline_items row at apply
  author TEXT NOT NULL, by_ai INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL, PRIMARY KEY (draft_id, seq));
ALTER TABLE changelog ADD COLUMN draft_id INTEGER;  -- which draft an apply came from
```
Ops are whole-item upserts/deletes, the same granularity as `upsertEntity`, so form edits map 1:1. The later
members model adds `draft_members` without touching these tables. Contributors = `DISTINCT author` over ops.
### 1.4 Later migrations
- `007_abstract_links.sql` (P3): `abstract_links (env, id, name, from_ref, to_ref, mode CHECK sync|async,
  transport NULL, description, created_at, updated_at, PK (env, id))`. A ref is an anchor: `grp:…`, `svc:…` or `ing:…`.
  Written only through drafts (target `link`). Refining both ends to endpoints emits ops in core: upsert an egress on
  the from-service and delete the link. Roll-up is computed, never stored.
- `008_threads.sql` (P4): `threads (id, env, draft_id NULL REFERENCES drafts ON DELETE SET NULL, anchor,
  anchor_label, status CHECK open|resolved, created_by, created_at, updated_at)`, index (env, anchor);
  `thread_posts (id, thread_id FK CASCADE, author, by_ai, model, body, created_at)`. Polling with `updatedSince`,
  as in bugs. `anchor_label` lets the list say "subject removed" when the anchor no longer resolves.
- Per-call descriptions (P0 or P4) need **no migration**: `descriptions.callee` takes `call:<svc>/<egressId>`.
  Only `check()` and `calleeService()` learn the prefix.
### 1.5 Postgres-friendliness
TEXT ISO timestamps, JSON in TEXT (→ jsonb), 0/1 integers for booleans, `ON CONFLICT … DO NOTHING/UPDATE` (no
`INSERT OR`), no `json_extract` (JSON handled in TS), and AUTOINCREMENT only on surrogate ids. The deletion
cascade of a design env is done in TS (`store/envs.ts`), because the old tables have no FK to `envs`.

## 2. Drafts: read, apply, conflicts
- **Net ops** (core/draft-overlay.ts): fold by (target, service, list, key); the last op wins; an upsert after a
  delete is a replace. The counts `+a −r ~c` come from net ops compared with the env.
- **Read**: `overlay(model, extras, netOps)` → new Model + extras, then `buildIndex`. It is cached in graph-cache
  under `env#draft:<id>` (LRU, cap 8). `changed(env)` drops the env and all its drafts. Every read route takes
  `?draft=<slug>`. Marks for the draft = diff(baseline, overlay), so "in draft" chips = diff(env, overlay), from the same code.
- **Apply** (store/draft-apply.ts, one `tx`):
  1. **Conflicts**: for each net op, `hash53(current item) !== base_hash` → stop with
     `409 DRAFT_CONFLICT {items:[{anchor, base, now}]}`. Nothing is written (stop-and-list, as the spec shows; D1).
  2. core/draft-manifests.ts turns the net ops into manifests: one per touched service, `kind:'delta'`
     (`baseVersion = current`, `version = current+1`, `upsert`/`delete`), or `kind:'full'` for a new service.
     Deleted services go through `deleteService`.
  3. `ingestIn(db, manifests, 'draft')` (the tx-less body of `ingestBatch`) runs validation, integrity, diff and
     the changelog exactly as today, plus `draft_id` on the changelog row.
  4. Side tables are written (DTOs, event DTOs, schemas, links, groups), and `origin` ops become `baseline_items` rows.
  5. The draft is marked `applied`, then `ctx.changed(env)` runs.
- Per-item hash, not service version (any edit bumps the version, so versions give false conflicts).
- **Guards**: `/api/ingest`, entity CRUD routes and the MCP tools `ingest_manifest`/`upsert_entity`/`delete_entity` refuse a
  design env (`409 DESIGN_ENV`, "write through a draft"). Drafts are refused on harvested envs. The guard lives in
  routes/tools, not in the store, so draft apply can use the store.

## 3. Module map (new = N, changed = C; rough lines)
**Phase 0, flow page (frame 9).** core/flow-steps.ts N ~110: step numbers from `Trace.messages`, returns
excluded, and squeeze fold columns for step k. web/js/views/flow-walk.js N ~120 (‹ › walk, keys, step-desc box);
flow-squeeze.js N ~90 (applies the fold to the column layout before drawing; flow-draw.js only reads the result);
flow-desc-box.js N ~100 (title box, moved out of the panel; reuses flow-desc.js). descriptions.ts C (+call anchor).

**Phase 1a, environments.** migration 005 N. **Split snapshots.ts** → snapshots.ts C ~90 (read side:
listEnvs/getService/loadEntities/loadModel/listChangelog, and it re-exports the two below, so no caller changes) +
store/ingest.ts N ~150 (diff, apply, ingestBatch, `ingestIn`) + store/crud.ts N ~110.
db/connection.ts C (re-entrant tx). store/envs.ts N ~120 (list with meta, get, ensureEnv, assertKind,
delete design env across all tables). store/env-copy.ts N ~150 (INSERT…SELECT per table + baseline rows, group
assignment into meta, referenced event DTOs/schemas only). store/baseline.ts N ~100 (baseline → DiffInput;
source-now input). core/neighbours.ts N ~70 (one hop with a "calls users-svc" reason). core/groups.ts N ~80 (path
helpers, service → group, region summaries). core/types.ts C (`ServiceKind | 'client'`, `Service.group?`),
system-graph.ts C (`client` node kind, `group` on nodes). schema/manifest.schema.json C plus samples.
routes/envs.ts N ~90. web: components/env-picker.js N, views/env-new.js N ~200 (+ env-new-table.js N ~120).

**Phase 1b, drafts backend + marks.** migration 006 N. core/anchors.ts N ~80; core/diff/types.ts N ~40;
core/diff/entities.ts N ~160; core/diff/fields.ts N ~120; core/diff/env-marks.ts N ~150 (roll-up, ghosts, counts,
verdict facts); core/draft-overlay.ts N ~140; core/draft-manifests.ts N ~120; core/draft-conflicts.ts N ~50.
store/drafts.ts N ~150 (CRUD, append op with base_hash, undo last op); store/draft-apply.ts N ~130;
store/draft-view.ts N ~80 (overlaid model + extras). graph-cache.ts C ~110 (LRU, draft keys, marks memo).
context.ts C: `view(env, draft?) → {g, extras}`, `marks(env, {draft, against})`. routes/drafts.ts N ~110,
routes/marks.ts N ~40; queries/inventory/instances/dtos routes C (read `?draft`, about 18 `ctx.graph(` call sites).
web: marks.js N (decorates any view from the anchor map), components/mark.js N (spark, ring),
views/draft-bar.js N, views/draft-review.js N, views/field-diff-table.js N (frame 5), system-regions.js N
(columns per subsystem; system.js is 170 and only calls it), inventory-status.js N (filter + "what changed").

**Phase 2, editing UI.** views/forms/{component,endpoint,call,flow}-form.js N (each <200),
core/flow-edit.ts N ~150: turns "add call A→B on lifeline" into function step + egress (+ ingress stub) ops, so
hand-drawn flows trace correctly. views/flow-edit-canvas.js N (drag ⊕, after forms), views/import-dialog.js N,
store/flow-names.ts N ~50 + routes in routes/descriptions.ts C, core/env-search.ts N ~60 (search over many GraphIndex).

**Phase 3.** migration 007; core/rollup.ts N ~120; core/abstract-links.ts N ~100 (refine → ops);
store/abstract-links.ts N ~80; routes/links.ts N; web views/subsystems.js N, level-control.js N.
**Phase 4.** migration 008; store/threads.ts N ~150; routes/threads.ts N ~70; web threads-panel.js, discussions.js N.

**MCP split** (before phase 1a): mcp/tools.ts → mcp/tools/index.ts (concat), shared.ts (obj/env/envOf/graphOf
with draft), map.ts, flows.ts, data.ts (dtos/schemas/stores/keys), bugs.ts; new envs.ts, drafts.ts, threads.ts.
Each file ≤200 lines. **api-local split**: api-local.js composes api-local-bugs.js (moved) + api-local-design.js N.

## 4. API + MCP
REST (all under /api):
- `GET /envs` (names, unchanged) · `GET /envs?detail=1` → `[{name, kind, sourceEnv, mode, baselineAt, groups, levels,
  components}]` · `POST /envs {name, source, mode, groups:[{path,label}], services:[{name, group}], createdBy}` ·
  `GET /envs/:env/neighbours?source=&services=a,b` · `PATCH /envs/:env {groups, levels, description}` ·
  `DELETE /envs/:env` (design only).
- `GET /envs/:env/marks?against=baseline|source&draft=` → EnvMarks. Every existing view takes `?draft=`.
- `GET|POST /envs/:env/drafts` · `GET|PATCH|DELETE /envs/:env/drafts/:slug` (DELETE = discard) ·
  `POST /envs/:env/drafts/:slug/ops {ops:[{op,target,service,list,key,data}], author, byAi}` ·
  `DELETE /envs/:env/drafts/:slug/ops/last` · `GET …/changes` (net ops + counts + conflicts preview) ·
  `POST …/apply` → `{results: WriteResult[]}` or 409 · `POST …/import {source, anchors:[…]}` (ops with origin).
- `GET /search?q=&envs=all` · `PUT /envs/:env/flow-names {service, ingress, name}`.
- P3: `GET /envs/:env/rollup` · links through draft ops. P4: `GET|POST /envs/:env/threads`, `POST /threads/:id/posts`,
  `PATCH /threads/:id {status}`, `GET /threads?updatedSince=`.
MCP: `list_envs`, `create_env`, `diff_env` (marks), `open_draft` (create/get), `edit_in_draft` (ops),
`draft_changes`, `apply_draft`, `discard_draft`, `find_in_envs`, `import_into_draft`, `set_flow_name`; P3
`refine_link`, `get_rollup`; P4 `list_threads`, `get_thread`, `reply_thread`. Read tools gain an optional `draft`.
**Static preview**: build-preview.ts adds `envMeta`, `baselines` (DiffInput per design env) and `flowNames`.
api-local-design.js computes marks with the same core/diff, and keeps drafts and threads **in memory** (like
bug edits today) through core/draft-overlay. Apply and import are refused with "not available in the preview".
The demo design env (samples/designs/sase-hld.json: copy spec plus one draft of ops, applied by the seed) shows up
in the preview without any special case.

## 5. Phase order (challenged)
- **P1 as proposed cannot show a single mark.** A copy is identical to its baseline, and harvesters can't
  write to design envs, so the drafts *backend* (ops, overlay, apply, MCP `edit_in_draft`) ships with marks. Order:
  P0 flow page (frame 9, no schema, parallel) → P1a envs, copy, groups, client, splits (frame 1) → P1b drafts
  backend + diff + read-only marks + draft bar (frames 2, 5, 7; the assistant can author from here) →
  P2 forms, flow names, import, then canvas editing (frames 4, 6) → P3 subsystems → P4 threads.
- Preparatory refactors (snapshots/tools/api-local splits, re-entrant tx) land first, behaviour-neutral, tests green.

## 6. Top risks
1. **Live DB upgrade.** Migration 005 backfills `envs` from real data. It has to be tested on a copy of `data/`.
   The auto-create on ingest (`ensureEnv`) must not slow down or fail harvester batches.
2. **Hand-made flows must trace.** The trace walks function steps → egress → resolve. A design call without
   function/step/bindKey won't draw. core/flow-edit.ts has to build valid, integrity-checked triples, and tests are needed
   for "draw a call, then trace it".
3. **Diff noise.** Harvested provenance and source fields, or group assignment, would mark everything Changed.
   The normalisation list needs tests on prod-like samples.
4. **Memory on a 2 GB box.** Draft graphs, the source-now compare and all-env search each build a GraphIndex.
   The LRU cap and lazy marks memo are needed, and so is a size check on the live DB.
5. **Route sprawl for `?draft`.** About 18 `ctx.graph(` call sites change. Do it once, through `ctx.view(req)`, not ad hoc.

## 7. Decisions needed from the maintainer
- **D1** Apply conflicts: stop and list them (recommended; it matches the spec), or let the newer edit win.
- **D2** "Transport not decided": add `undecided` to the Transport enum (recommended; resolve treats it as matching
  nothing special, and harvesters never send it), or use `transport:'other'` + `details.undecided:true`.
- **D3** Full copy of a design: inherit its baseline (recommended; marks vs prod persist), or start a fresh baseline.
- **D4** Components mode copies egress (calls) but no functions. Recommended, because frame 2 shows prod-to-prod
  edges "came along". Flow names, descriptions and threads are allowed on harvested envs too (they are not map data).
- **D5** Reorder: the drafts backend moves into phase 1 (P1b), and the flow page becomes P0.
