# Increment 1b: diff, marks, drafts (build spec)

Base: main at 0.21.0 (1a merged). Read first: design-envs.md (decisions), DESIGN-IMPORT.md (the plan format we must apply),
mockup frames 2, 4, 5, 7. Two sequential parts, each its own worktree, QA pass and merge:
**1b-1 backend** (0.23.0) then **1b-2 UI** (0.24.0). F2 owns 0.22.0; do not take it. Every file ≤ 250 lines (tests ≤ 350);
`npm run check:size` enforces it. core/ stays pure (no `node:`, `import type` for types).

## 0. Ground rules that apply to both parts
- **One anchor grammar** (`core/anchors.ts`), used by marks, draft ops, plan mapping and (phase 4) threads. Fixed here; never change it later.
- **One row shape.** Everything the diff and the drafts touch is an `ItemRow`, the same encoding as `baseline_items` (1a):
  `{service, list, key, data}`; `list` ∈ `header | functions | ingress | egress | resources | channels | bindings | dto | event_dto | schema | flow`.
  `header` key `''`, data = header without `name` (`{kind, ...meta}`); `dto` key `ingress|role|status` (status `''` when none),
  data `{content, meta}`; `event_dto` service `''`, key = type, data `{content, meta}`; `schema` service `''`, key `storeKey|source`,
  data = content; `flow` (drafts only, never in a baseline) key = ingress, data `{name?, description?, steps?, doc?}`.
- **Sealed envs never take the new code paths.** No draft, no overlay, no marks: their reads keep `loadModel` and the existing cache entry.
  The golden traceHash test (1b-1, first commit) proves it.
- **Newer edit wins** on apply (maintainer decision 1): no conflict stop; the apply report lists what it overwrote.

### Anchor grammar (core/anchors.ts)
| Anchor | Item | ItemRow (service, list, key) |
|---|---|---|
| `svc:<s>` | component header (delete = whole component) | s, header, '' |
| `fn:<s>/<id>` `ing:<s>/<id>` `egr:<s>/<id>` `res:<s>/<id>` `bind:<s>/<id>` | entity | s, functions/ingress/egress/resources/bindings, id |
| `ch:<bindKey>` | channel (env-wide key; op needs `service` = owner) | owner, channels, bindKey |
| `dto:<s>/<role>/<status or ->/<ingress>` | endpoint DTO (ingress last: ids may hold `/`) | s, dto, `ingress|role|status` |
| `evt:<type>` | event DTO | '', event_dto, type |
| `schema:<source>/<storeKey>` | store schema (`code|db|manual` first: keys hold `/`) | '', schema, `storeKey|source` |
| `flow:<s>/<ingress>` | flow name + description (drafts) | s, flow, ingress |
| `<anchor>#<fieldPath>` | one field of a dto/evt/schema (`devices[].certFingerprint`) | n/a (marks only) |

Service names never contain `/`, so `<s>/` splits on the first `/`; everything after the prefix (and before the last `#`
for field anchors) is the key, verbatim. System-graph node ids are already `svc:<name>` and `ch:<key>`: the UI joins on them.
DESIGN-IMPORT's mapping `dto:<s>/<ingress>/<role>` becomes the form above (doc update; mapping anchors are informational).

---------------------------------------------------------------------------------------------------------------------
# Part 1b-1: backend (0.23.0)

## 1. Migration `server/db/migrations/006_drafts.sql` (additive; no table rebuild)
007 is taken by E1 (`007_events.sql`, event stream). 1b uses 006 only; any further 1b migration is numbered 008+.
```sql
CREATE TABLE drafts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  env        TEXT NOT NULL REFERENCES envs (name) ON DELETE CASCADE,
  slug       TEXT NOT NULL,                       -- in URLs and MCP: ?draft=<slug>
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'applied', 'discarded')),
  plan       TEXT,                                -- import plan (JSON) kept for review: mapping, questions, links
  report     TEXT,                                -- apply report (JSON): results, replaced, warnings
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  closed_at  TEXT, closed_by TEXT,
  UNIQUE (env, slug)
);
CREATE TABLE draft_ops (
  draft_id  INTEGER NOT NULL REFERENCES drafts (id) ON DELETE CASCADE,
  seq       INTEGER NOT NULL,                     -- MAX(seq)+1 inside the append transaction
  op        TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  anchor    TEXT NOT NULL,
  service   TEXT NOT NULL DEFAULT '', list TEXT NOT NULL, key TEXT NOT NULL,
  data      TEXT,                                 -- JSON, whole item (upsert only)
  base_hash TEXT,                                 -- hash of the env item when the draft first touched it; NULL = absent
  author    TEXT NOT NULL, by_ai INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL,
  PRIMARY KEY (draft_id, seq)
);
CREATE INDEX draft_ops_item ON draft_ops (draft_id, service, list, key);
CREATE TABLE flow_names (env TEXT NOT NULL, service TEXT NOT NULL, ingress TEXT NOT NULL, name TEXT NOT NULL,
  author TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (env, service, ingress));   -- written by apply; UI in 2a (see M1)
ALTER TABLE changelog ADD COLUMN draft_id INTEGER;
```
`store/envs.ts` TABLES gets `drafts` and `flow_names` (delete of a design env). Postgres notes as 005 (TEXT JSON, ISO TEXT times).

## 2. Core (pure, browser-safe)
| File | Lines | Exports |
|---|---|---|
| core/anchors.ts | ~110 | `type AnchorKind = 'svc'|'fn'|'ing'|'egr'|'res'|'bind'|'ch'|'dto'|'evt'|'schema'|'flow'`; `parseAnchor(a): {kind, service?, key, field?} \| null`; `anchorOfRow(r: ItemRow): string`; `rowOfAnchor(a, service?): {service, list, key}` (throws `Error('anchor …')` on bad input); `fieldAnchor(a, path)`; `parentOf(a): string \| null` (entity/dto → `svc:`, field → its item, nested field → parent field) |
| core/item-rows.ts | ~100 | `interface ItemRow {service; list; key; data}`; `rowId(r) = service + '\u0000' + list + '\u0000' + key`; `rowsToModel(env, rows): Model` (same output as `loadModel`: services sorted by name, entities by service, list, key, `service` attached, `steps ?? []`, header `version`/`harvestedAt` from data or `0`/`''`); `rowsToExtras(rows): {dtos: Dto[], eventDtos: EventDto[], schemas: StoreSchema[], flows}` in the store's output shapes |
| core/diff/normalise.ts | ~70 | `stableJson(v)` (sorted keys); `normItem(list, data)` drops `service`, `provenance`, `source`, `details.doc` at any depth; header also drops `name`, `version`, `harvestedAt`, `commit`, `groupPath`, `details`; dto/event_dto keep `content` only; `same(list, a, b)`; `rawHash(data) = hash53(stableJson(data))` (hash53 from core/description.ts) |
| core/diff/side.ts | ~80 | `interface Side {rows: Map<rowId, ItemRow>; services: Set<string>; ownerOfChannel: Map<key, service>; producers: Map<type, service[]>; storeUsers: Map<key, service[]>}`; `sideOf(rows)` |
| core/diff/steps.ts | ~90 | `alignSteps(a: Step[], b: Step[]): {added: Step[]; removed: Step[]; changed: {was: Step; now: Step}[]}`; LCS on `sig = type|target|operation|event|mode|condition|kind`, **never `seq`**; aligned pairs whose `normItem` differs are changed |
| core/diff/fields.ts | ~130 | `fieldsOf(content): Map<path, {type, required, enum?}>` (`isJsonSchema` → `schemaRows`; else flatten example JSON: objects `a.b`, arrays `a[]` merging all elements, type `string|number|integer|boolean|null|object|array`); `diffFields(base, cur): FieldMark[]` = `{path, mark, was?, type}`; children of a new/removed field are dropped; `was`: `"was string"`, enum `"+ quarantined"` / `"− legacy"`, `"now required"` |
| core/diff/entities.ts | ~150 | `rawMarks(base: Side, cur: Side, opts): Map<anchor, MarkInfo>` per row: absent in base → new; absent in cur → removed (+ ghost); both and `!same` → changed. functions → `alignSteps` (what: `+1 step: out.auth.token`); dto/event_dto/schema → `diffFields`, one anchor per field mark, item changed iff any field mark (pure re-ordering of keys is no change) |
| core/diff/propagate.ts | ~120 | `prune(marks)`: drop any anchor whose ancestor (via `parentOf`; channels via `ownerOfChannel`) is new, or removed for removed; `rollUp(marks, cur, base)`: unmarked parent of a marked child → changed with a `what`; dto → its `ing:` → `svc:`; evt → each producer `svc:` (egress `events` contain the type); schema → each `svc:` with a resource whose bindKey is the store key; `counts(...)` |
| core/diff/what.ts | ~70 | phrases joined by ` · `, max 3 then `+N more`: `+1 endpoint`, `−2 calls`, `~1 endpoint`, `+1 call: <callee>` (exactly one new call; `opts.calleeOf`), `header: team, description`, `message UserUpdated: 1 new field`, `message request of in.x: 1 changed field`, `collection users: 1 new field` |
| core/diff/index.ts | ~60 | `diffEnv(base: ItemRow[], cur: ItemRow[], opts: DiffOpts): EnvMarks` |
| core/draft-ops.ts | ~140 | `netOps(ops)`, `overlayRows(rows, net)`, `draftChanges(envRows, net)`, `validateOpShape(op)` |
| core/draft-manifests.ts | ~110 | `draftManifests(net, envRows, at): {manifests, replaceHeader: Set<service>, deletes: string[], side: NetOp[]}` |
| core/import-plan.ts | ~190 | `planToOps(plan, envRows): {ops: DraftOpInput[]; warnings: string[]; skipped: {links: number}; questions: {total; blocking: string[]}}` (throws `PlanError {path, message}[]`) |

```ts
// core/diff/index.ts
export type Mark = 'new' | 'changed' | 'removed';
export interface MarkInfo { mark: Mark; what?: string; was?: string }
export interface DiffOpts { against: 'baseline' | 'source'; calleeOf?: (service: string, egressId: string) => string | undefined }
export interface EnvMarks {
  against: 'baseline' | 'source'; draft: string | null; source: string | null; baselineAt: string | null;
  marks: Record<string, MarkInfo>;                                   // after prune + roll-up; field anchors included
  ghosts: Record<string, { label: string; service?: string; type?: string }>;  // removed items (UI draws them struck)
  counts: Record<'components' | 'endpoints' | 'calls' | 'channels' | 'messages' | 'fields', { new: number; changed: number; removed: number; unchanged?: number }>;
}
// core/draft-ops.ts
export interface DraftOpInput { op: 'upsert' | 'delete'; anchor: string; service?: string; data?: unknown }
export interface DraftOp extends DraftOpInput { seq: number; service: string; list: string; key: string; baseHash: string | null; author: string; byAi: boolean; at: string }
export type NetOp = DraftOp;                       // the last op per rowId, in seq order
export interface DraftChange { anchor: string; change: 'added' | 'removed' | 'changed'; label: string; under?: string; authors: string[]; at: string; stale: boolean }
export interface DraftChanges { counts: { added: number; removed: number; changed: number }; items: DraftChange[]; authors: string[] }
```
**Rules.** `netOps`: fold in seq order, last op per rowId wins; a `delete svc:<s>` removes every earlier net entry of `s` (all
lists, dto, flow). `overlayRows`: env rows, then net ops in seq order (svc delete drops all rows of `s`). `draftChanges`:
upsert of absent → added, upsert of present with `!same` → changed, equal → nothing, delete of present → removed, delete of
absent → nothing; children of an added `svc:` are listed with `under` but **not counted** (highest-level rule); `stale` =
env item's `rawHash` ≠ op `baseHash` (will be overwritten). Counts in the bar, the Review list and `/changes` come from this one function.
`draftManifests`: per touched service: no snapshot in env → `kind:'full'`, `version: 1`, all its net rows; exists →
`kind:'delta'`, `baseVersion = cur`, `version = cur+1`, `upsert`/`delete` per list, header from the net header op (or the env
header) and `replaceHeader` when a header op exists (whole-item, so a removed field goes). `svc:` deletes go to `deletes`.
dto/event_dto/schema/flow ops go to `side`. Every manifest: `schemaVersion:'1.0'`, `env`, `harvestedAt: at`.

**Source-now side** (`against=source`): for each baseline service `S` with a header row: the source env's current rows of `S`
(all lists, except `functions` when the baseline has no function of `S`: a Components copy), its DTOs; a baseline service the
source does not have (the synthetic `<source>-infra`) is looked up item by item by (list, key) in any service of the source;
env-scoped rows whose key is in the baseline. A component the source no longer has is `new` with what `no longer in <source>`.

## 3. Server
| File | Lines | Change |
|---|---|---|
| store/item-rows.ts | N ~90 | `envItemRows(db, env)`, `baselineRows(db, env)`, `sourceNowRows(db, env)` (rule above; `source_env` per row) |
| store/drafts.ts | N ~180 | `createDraft(db, env, {name, slug?, createdBy})` (guard `'draft'`; slug from name `[a-z0-9-]`, `-2` on clash) · `getDraft(db, env, slug)` (404; `open` only unless `{any:true}`; closed → 409 `DRAFT_CLOSED`) · `listDrafts(db, env, status?)` · `renameDraft` · `discardDraft(db, env, slug, by)` · `loadOps(db, id)` · `appendOps(db, env, slug, ops, {author, byAi})` · `undoLast` · `revertItem(db, env, slug, anchor)` · `draftView(db, env, slug) → {rows, net}` |
| store/draft-validate.ts | N ~90 | per op at append, against the overlay so far: anchor parses; `upsert` needs data; header → `validateServiceHeader({name: s, ...data})`; entity → `validateEntity` and `keyOf(list, data) === key`; entity/dto/flow op on a service absent from the overlay → 422 `NO_SERVICE`; dto → `normStatus`, role request/response; schema → source in `SOURCES`; `ch:` without `service` and no existing owner → 422. All-or-nothing per request (one tx) |
| store/draft-apply.ts | N ~170 | `applyDraft(db, env, slug, {by, source, dryRun})` and `applyDraftIn(db, env, slug, opts)` (no tx, used by dry runs) |
| store/draft-side.ts | N ~100 | `writeSide(db, env, side, g, by)`: DTO / event DTO / schema rows via the unguarded writers; flow ops → `flow_names` upsert + `putHuman` description (steps as a numbered list appended to the description; per-step keys are 2a) |
| store/draft-plan.ts | N ~80 | `ingestPlan(db, env, slug, plan, {author, byAi, dryRun})`: `planToOps` → `appendOps` in one tx, stores `drafts.plan` (without `manifests`), dry run = append + `applyDraftIn` + rollback, returns contract reports |
| store/snapshots-ingest.ts | C | export `ingestIn(db, manifests, source, opts: ApplyOpts)` (body of `ingestBatch` without tx/DryRun); `ApplyOpts = {writer: Writer; tolerateExisting?: boolean; replaceHeader?: Set<string>; draftId?: number}`. `tolerateExisting` → `assertIntegrity(name, after, before)` (copied services have dangling handlers: without this every delta to them is 422). `replaceHeader` → header = manifest.service, not merged. `draftId` → written on the changelog rows. `ingestBatch(db, ms, source, {dryRun, draft?})`: dry run uses writer `'dry'`; with `draft` it first runs `applyDraftIn` |
| store/envs.ts | C | `Writer = 'harvester' \| 'manual' \| 'draft' \| 'dry'`. harvester: design → 409 `ENV_DESIGN` (as now). **manual: sealed → `ENV_SEALED`, design → 409 `ENV_DRAFT`** ("edit a design through a draft: POST /api/envs/<env>/drafts"). draft: sealed → `ENV_SEALED`, unknown → 404. dry: any kind |
| store/dtos.ts, schemas.ts | C | split each writer into guarded wrapper + unguarded `putDtoRow`, `deleteDtoRow`, `putEventDtoRow`, `deleteEventDtoRow`, `putSchemaRow`, `deleteSchemaRow`; `loadDtos`/`loadSchemas` take `{dryRun}` (validate + tx + rollback; guard `'dry'`) |
| server/draft-reader.ts | N ~70 | `interface DataReader {endpointDtos(s, i); listDtos(f); listEventDtos(); getEventDto(t); listSchemas(key?); flowText(s, i)}`; `dbReader(db, env)`; `rowsReader(rows)` |
| graph-cache.ts | C ~100 | entries `{g, reader?}`; key `env` or `env#draft:<slug>`; `viewFor(db, env, slug \| null)`; `invalidate(env)` drops `env` and every `env#…` key and marks memo with that env in its deps; `invalidateDraft(env, slug)`; `size()` counts all; draft entries built from `overlayRows(envItemRows, netOps(loadOps))` → `buildIndex(rowsToModel)` |
| server/marks.ts | N ~80 | `marksFor(ctx, env, {against, draft})`: memo (cap 16) keyed `env|draft|against`, deps = env (+ every `source_env` for source); `calleeOf` from the graph's resolved egress links (the lookup service-view uses); sealed env → empty result with `baselineAt: null`; `against=source` with a deleted source → 409 `NO_SOURCE` |
| context.ts | C | `graphOf(req)`, `readerOf(req)` (`req = {params: {env}, query}`; `draft` from `query.get('draft')`), `view(env, draft?) → {g, reader}`; `changedDraft(env, slug)` |
| routes/drafts.ts | N ~150 | routes below |
| routes/marks.ts | N ~30 | `GET /api/envs/:env/marks` |
| routes: queries, inventory, instances, dtos, descriptions, envs (neighbours), map (`GET services`) | C | every `ctx.graph(req.params.env)` → `ctx.graphOf(req)`; every DTO/event DTO/schema read → `ctx.readerOf(req)`. `GET …/services/:service[/:list]` read `?draft=` through the overlay too. Grep must find no `ctx.graph(` left in routes/ |
| mcp/tools/common.ts | C | `draftArg = {type:'string', description:'Open draft slug: read the environment as the draft would leave it'}`; `viewOf(c, a)` |
| mcp/tools/{map,flows,stores}.ts | C | every read tool: `draft: draftArg` in its schema, `viewOf(c, a).g` / `.reader` instead of `c.graph(envOf(a))` |
| mcp/tools/drafts.ts | N ~170 | `open_draft`, `list_drafts`, `draft_changes`, `edit_in_draft`, `apply_draft`, `discard_draft` |
| mcp/tools/design.ts | N ~80 | `get_marks`, `apply_import_plan`; `ingest_manifest` / `load_dtos` / `load_schemas` gain `draft` (dry run only) and `dryRun` |
| scripts/build-preview.ts, server/http/static.ts | C | transpile `core/` **recursively** (core/diff/); add `envItemRows`/`baselineRows` per design env and open drafts with ops to data.js (`rows`, `baselines`, `drafts`) |
| schema/manifest.schema.json, core/types.ts | C | transport `undecided`; `details` (free object) on `service` header and `function`; `Service.details?`, `Fn.details?` |

**Apply** (`applyDraftIn`, all inside the caller's tx; `applyDraft` = `tx` + this + `ctx.changed(env)` + `invalidateDraft`):
1. `getDraft` (open; else 409 `DRAFT_CLOSED`), `guardEnv(env, 'draft')`, `net = netOps(loadOps)`; no effective change → 409 `DRAFT_EMPTY`.
2. `replaced` = net ops whose env item `rawHash` ≠ `baseHash`: `{anchor, baseHash, nowHash, now}` (newer edit wins, for the record).
3. `draftManifests(net, envItemRows, now)`; `ingestIn(db, manifests, source, {writer:'draft', tolerateExisting:true, replaceHeader, draftId})`.
4. deletes: unguarded `deleteServiceIn(db, env, name, draftId)` (split out of `deleteService`; DTOs go by FK cascade).
5. `g = buildIndex(loadModel(db, env))`; `writeSide(db, env, side, g, by)` (schema `known` = stores of `g`).
6. One summary changelog row: `service ''`, `kind 'draft'`, `changes = {draft: slug, name, counts, replaced: anchors}`, `draft_id`.
7. draft → `status 'applied'`, `closed_at/by`, `report = {results, replaced, warnings}`. Return `{applied: true, results, replaced, changelogId}`.
`dryRun`: same in a tx, then throw the existing `DryRun` → `{dryRun: true, results (with contract), replaced}`; nothing written.

### REST (all JSON; errors as today `{error: {code, message, details}}`)
| Method | Path | Body / query → result |
|---|---|---|
| GET | `/api/envs/:env/drafts?status=open\|all` | `DraftInfo[]` (`{id, slug, name, status, createdBy, createdAt, updatedAt, closedAt, ops, authors, counts}`) |
| POST | `/api/envs/:env/drafts` | `{name, slug?, createdBy?}` → 201 `DraftInfo`; sealed 409 `ENV_SEALED`; slug taken 409 `EXISTS` |
| GET | `/api/envs/:env/drafts/:slug` | `DraftInfo & {ops: DraftOp[], plan}` (any status) |
| PATCH | `/api/envs/:env/drafts/:slug` | `{name}` → `DraftInfo` |
| DELETE | `/api/envs/:env/drafts/:slug` | discard → `{discarded: slug}`; ops kept for the record; draft cache entry dropped |
| POST | `/api/envs/:env/drafts/:slug/ops` | `{ops: DraftOpInput[], author?, byAi?}` → 201 `{from, to, counts}`; 422 `INVALID` with `details[i]` |
| DELETE | `/api/envs/:env/drafts/:slug/ops/last` | → `{removed: seq}` (undo) |
| DELETE | `/api/envs/:env/drafts/:slug/ops?anchor=` | revert one item: removes all its ops → `{removed: n}` |
| GET | `/api/envs/:env/drafts/:slug/changes` | `DraftChanges` |
| POST | `/api/envs/:env/drafts/:slug/apply?dryRun=1` | → apply result above |
| POST | `/api/envs/:env/drafts/:slug/plan?dryRun=1` | plan JSON (`planVersion: 1`) → 201 `{ops, counts, warnings, skipped, questions}` (+ `results` on dry run) |
| GET | `/api/envs/:env/marks?against=baseline\|source&draft=` | `EnvMarks` |
| any GET under `/api/envs/:env/…` | `?draft=<slug>` | the env as the draft would leave it; unknown draft 404; closed 409 `DRAFT_CLOSED`; sealed env 404 |
| POST | `/api/ingest?dryRun=1[&draft=<slug>]` | now allowed into a design env (nothing written); with `draft`, validated against env + draft |
| POST | `/api/envs/:env/dtos?dryRun=1`, `/schemas?dryRun=1` | validate only, any env kind |

### MCP (inputSchema via `obj(...)`; every tool takes `env`)
- `open_draft {env, name?, slug?}`: slug of an open draft → that draft; else creates (`name` required) → `DraftInfo`.
- `list_drafts {env, status?: 'open'|'all'}` · `draft_changes {env, draft}` → `DraftChanges`.
- `edit_in_draft {env, draft, ops: [{op: 'upsert'|'delete', anchor, service?, data?}] (1..500), author?}` → `{from, to, counts}`; `by_ai = 1`, author default `'assistant'`.
- `apply_draft {env, draft, dryRun?}` · `discard_draft {env, draft}`.
- `get_marks {env, against?, draft?, prefix?, fields?: boolean}`: `fields:false` (default) leaves field anchors out; `prefix` filters anchors.
- `apply_import_plan {env, draft, plan: object, dryRun?}`. Read tools all take `draft`. Description of each says what it writes.

### Import plan → ops (core/import-plan.ts; DESIGN-IMPORT §7)
- `planVersion !== 1` → `PLAN_VERSION`. `environment.name`, if present, must equal `env` (`PLAN_ENV`); different groups → warning.
- `manifests[]`: a string (folder reference) → error "inline it"; `validateManifest` with `env` overridden (errors at
  `manifests[i]…`); the service must not exist in env or draft (`PLAN_EXISTS`: "reclassify as extension"); ops: `svc:` header
  (with `groupPath`), then every entity.
- `extensions[]`: service must exist (`PLAN_NO_SERVICE`); each `upsert[list][]` → entity upsert; `groupPath` → header upsert
  with it; `delete` present → error; `baseVersion` ≠ the baseline's `source_version` → warning.
- `flows[]` → `flow:<entry.service>/<entry.ingress>` `{name, description, steps, doc}`. `dtos[]` → `dto:`/`evt:`; `schemas[]` → `schema:`.
- `links[]` → not stored as ops (phase 3), counted in `skipped.links`, kept in `drafts.plan`. `questions` with `blocking:true` are returned, not enforced (M3).
- Transitional encoding `transport:'other' + details.transport:'undecided'` → `transport:'undecided'` (drop the detail); warning with the count.

### Follow-ups bundled here
- `undecided`: schema enum + `Transport`; resolves by key like any other; default mode sync, unicast; health/contract treat it as
  linked when keys match; harvesters never send it (HARVESTER-GUIDE says so).
- Client-app entry `client:<app>/<trigger>` (transport `other`, `entryPoint: true`) must be listed by `entryPoints` and trace
  through its handler's egress steps into copied prod endpoints.

## 4. Tests (1b-1). New suites one concern each; existing assertions change only where listed, with a reason in the commit
1. **tests/trace-golden.test.ts + tests/fixtures/trace-golden.json, first commit, on unchanged main code**: `traceHash` of every
   `entryPoints` of seeded prod (samples + deltas). Must stay green through both parts.
2. **anchors.test.ts**: round trip every kind; keys with `/`, `:`, spaces, `#` in a channel key; field suffix; bad input throws; `parentOf` chain.
3. **diff-entities.test.ts** (QA D1–D4, D7, D8, D12): identical → no marks; new component → only `svc:` marked; new endpoint on a
   copied component → `ing:` new + `svc:` changed `+1 endpoint`; removed egress → removed + ghost; changed transport/bindKey/handler;
   `undecided` ↔ `http` is changed; provenance/source/groupPath/version/`details.doc` only → no mark; key rename = removed + added;
   step inserted mid-function → one added step, nothing changed; key order irrelevant.
4. **diff-fields.test.ts** (D5, D6): new/removed/changed type (`was string`); enum `+ quarantined`; required; nested object;
   `devices[].certFingerprint` unmarked under new `devices`; JSON Schema vs example DTO; collection schema; roll-up to `ing:`,
   to the producer `svc:` (evt) and the store user `svc:` (schema) with the frame-7 phrases.
5. **draft-ops.test.ts** (O1–O5): fold order; delete then re-create; svc delete wipes earlier child ops; `draftChanges` counts =
   items (top level only); `rowsToModel(envItemRows(prod))` deep-equals `loadModel(prod)` (parity); `draftManifests` full vs delta, `replaceHeader`.
6. **drafts-api.test.ts** (A1–A6, K1, K2): create/list/rename/discard (env and changelog untouched, cache entry gone);
   validation 422s (`NO_SERVICE`, key ≠ anchor, bad header); apply = one delta per touched service (+1 version), full for new
   ones, changelog rows carry `draft_id` + one `kind 'draft'` row; A3 one tx: an integrity error in the 2nd service leaves the
   1st unchanged; A5 → 409 `DRAFT_EMPTY`; newer edit wins: an op whose item changed since (another draft applied first) is
   overwritten and listed in `replaced`; dry run writes nothing; copied component with dangling handler takes a delta (tolerateExisting);
   20 concurrent appends → seq 1..20, no loss; two applies at once → one 200, one 409 `DRAFT_CLOSED`; MCP tools give the same rows with `by_ai = 1`.
7. **draft-reads.test.ts**: every GET route of `router.list()` under `/api/envs/:env/` called with `?draft=`: 200 and reflects
   the overlay where relevant (trace of a new flow, endpoint DTO from the draft, inventory has the new component); unknown 404,
   closed 409; same through every MCP read tool with `draft`. A draft read never invalidates the env entry (cache `size()`).
8. **marks-api.test.ts** (D9, D11, D13): fresh copy → no marks; draft marks; `against=source` after a prod delta shows drift,
   baseline mode does not; prod deletes a copied service → `new` "no longer in prod" in source mode only; counts = per-anchor
   marks; Full copy of `scale-test` + draft marks < 200 ms warm; memo dropped on env write and on source write.
9. **import-plan.test.ts** with `tests/fixtures/plan-sase.json` (the demo plan): ops and counts; each error code; undecided
   conversion; dry run writes nothing and returns contract; apply → `trace` from `sase-agent/in.tunnel.open`
   (`client:sase-agent/tunnel-open`) reaches `pop-edge` and `auth-svc`; flow name in `flow_names`; description set.
10. **env-guard.test.ts** (update): MANUAL → 409 `ENV_SEALED` on sealed **and 409 `ENV_DRAFT` on design**; new DRAFT class
    (draft write routes and MCP draft tools: `ENV_SEALED` on sealed, allowed on design); `dryRun` ingest/DTO/schema into a
    design env allowed; `get_marks`, `list_drafts`, `draft_changes` in MCP_READ. Rewrite the design-env CRUD cases in
    api.test.ts:68, env-copy.test.ts:65/93, dtos.test.ts:88 to drafts (same assertions on versions/changelog/cascade).
11. **migrations.test.ts**: 005 DB with rows → 006: tables exist, changelog rows keep `draft_id NULL`, `.pre-006.bak`; then on a
    copy of the live DB (`sqlite3 data/flow.db ".backup /tmp/x.db"`, never `data/`): counts per env unchanged.
12. **undecided.test.ts**: schema accepts; egress/ingress pair links; health counts it linked; contract no `dangling-egress`.

## 5. Demo, docs, version (1b-1)
- `samples/envs/sase-hld.plan.json`: a DESIGN-IMPORT plan (planVersion 1) adding `sase-agent` (client-app, groupPath `agent`,
  ingress `in.tunnel.open` `client:sase-agent/tunnel-open`, handler stepping to pop-edge), `pop-edge` (groupPath `network`,
  `socket:tls/pop-edge/tunnel-open`, egress `http:POST auth-svc/token` and one `undecided` call), an extension of `auth-svc`
  (`in.token.device`) and a changed field in a copied DTO, one flow "Agent connects to POP" with steps, one link (skipped).
  `samples/envs/sase-hld.json` gains `"drafts": [{"slug": "hld-import", "name": "HLD import", "plan": "sase-hld.plan.json"}]`;
  seed.ts and build-preview.ts create those drafts **open** through `ingestPlan` after `copyEnv` (skipped when the env exists).
  The plan file doubles as `tests/fixtures/plan-sase.json` (test reads samples directly; no copy).
- docs/API.md (Drafts, Marks, `?draft=`, `ENV_DRAFT`, dry runs into design envs, plan route, `undecided`, `details` on header and
  function, anchor table), ARCHITECTURE.md (core/diff, anchors, item rows, drafts store, cache keys), DESIGN.md (whole-item ops,
  newer edit wins, why marks are a separate endpoint), DESIGN-IMPORT.md (§6 undecided now real, §3 `details.doc` on header and
  function, §8 dry run into the design env + draft, §9 rewritten to `apply_import_plan`, dto anchor form), HARVESTER-GUIDE.md
  (`undecided` and header `details` are for designs), DEMOS.md row: `#/inventory?env=sase-hld&draft=hld-import` (API-only until 1b-2:
  link to `/api/envs/sase-hld/marks?draft=hld-import`). `package.json` → **0.23.0**.

## 6. Risks (1b-1)
1. Live DB upgrade: 006 only adds; test on a backup copy (M5) before deploy; restart per CLAUDE.md.
2. Route sprawl: ~18 route + ~18 MCP sites. Do it in one commit, guarded by test 7 (every GET route with `?draft=`).
3. Diff noise on prod-like data: test 3 runs over a Components and a Full copy of the full samples: zero marks before any edit.
4. `rowsToModel` drifting from `loadModel` breaks draft traces silently: parity test in 5 is mandatory.
5. Memory on 2 GB: draft graphs share the LRU (`FLOW_GRAPH_CACHE_MAX`); marks memo cap 16; source-now builds no index.
6. The design-env CRUD routes now always refuse (M2). External scratch scripts that used them (DESIGN-IMPORT §8.6) move to drafts.

---------------------------------------------------------------------------------------------------------------------
# Part 1b-2: UI (0.24.0). Starts after 1b-1 is merged. Design before code: frames 2, 4, 5, 7 are the approved mockup.

## 7. State and data
- `web/js/state.js` C: `state.mode: 'view'|'edit'`, `state.draft: slug|null`, `state.compare: 'baseline'|'source'`;
  `setDesign(patch)` notifies listeners; read from / written to the URL query (`mode=edit`, `draft=`, `compare=source`) by
  router.js, so links land in a draft. Switching env clears all three. Sealed env: always view, no draft.
- `web/js/api.js` C: every GET under `/api/envs/<env>/` appends `draft=<state.draft>` when set (one helper `withDraft(path)`);
  new calls `marks(env, against)`, `drafts(env)`, `openDraft`, `draft`, `draftChanges`, `editDraft(env, slug, ops)`,
  `undoDraft`, `revertDraftItem`, `applyDraft`, `discardDraft`, `renameDraft`.
- `web/js/design/marks-store.js` N ~90: loads `/marks` once per (env, draft, compare), `markOf(anchor)`, `ghostsUnder(prefix)`,
  `fieldMarks(itemAnchor) → Map<path, MarkInfo>`, `onMarks(fn)`; refetched after every draft edit/apply/discard.
- `web/js/api-local-design.js` N ~150 (composed by api-local.js): marks = `diffEnv(baselines[env], overlayRows(rows[env],
  netOps(drafts)))`, draft graph = `buildIndex(rowsToModel(...))`, drafts and ops **in memory** (create, edit, undo, discard
  work), `applyDraft` → error "Apply is not available in the preview: it needs the server."

## 8. Components (prefixed classes per designer notes §0; tokens `--new`, `--new-ink`, `--draft` in tokens.css, both dark blocks)
| File | Lines | What |
|---|---|---|
| web/js/components/status-mark.js | N ~70 | `markBadge(info, {title})` (`.mark.new|.chg|.rm` + glyph; title "New since baseline prod, Oct 21 14:02"), `sparkSvg(x, y, kind)` (star new, ring changed), `wasText(info)` |
| web/js/icons.js | C | symbols `i-new`, `i-chg` |
| web/css/marks.css | N | badges, `.gone` (opacity .38 + line-through, `--muted`, never `--bad`), field rows `.fd tr.isnew/ischg/isrm` 3px inset edge, twinkle once, none under reduced motion |
| web/js/design/mode-toggle.js | N ~70 | `.seg` View · Edit (`data-qa=mode-view|mode-edit`), only on design envs; Edit with no draft opens the picker |
| web/js/design/draft-picker.js | N ~90 | context-menu style: "New draft…" (name prompt) + open drafts (name, `+a −r ~c`, authors) |
| web/js/design/draft-bar.js | N ~150 | sticky under toolbar (`data-qa=draft-bar`): name, "by X and N others", `+a −r ~c` mono, Review changes · Discard · Apply to <env>; Apply disabled at 0 ("No changes yet"); busy "Applying…"; stale items → `--warn` callout "N items changed in <env> since this draft touched them; Apply overwrites them" + Show; network error `.error-box` in the bar |
| web/js/design/draft-review.js | N ~130 | panel list from `/changes`, grouped by component, marks per row, `under` rows indented, per-row Revert, Undo last; Apply confirm step "Apply N changes to <env>"; success toast "Applied · Open changelog", back to View |
| web/js/design/draft-discard.js | N ~50 | confirm naming count and other authors |
| web/js/design/compare-switch.js | N ~50 | `.seg` "Baseline: <src>, <date>" · "<src> now" (`data-compare=baseline|source`), disabled with title when the source is gone |
| web/js/graph/graph-marks.js | N ~80 | canvas: spark/ring at node top-right from `markOf(node.id)`, what-label under the name (`+1 endpoint`) in `--new-ink`; ghosts of removed components muted, no edges. Called from canvas-graph after labels |
| web/js/views/inventory-status.js | N ~110 | filter `.seg` All · New · Changed · Unchanged with counts (from `counts.components`), "What changed" column from `what`, rows linked |
| web/js/views/flow-marks.js | N ~100 | heads: spark/ring by `svc:`; arrows: mark of `egr:<m.service>/<m.egress>`, else of a new `ing:` target; in Edit with a draft: "in draft" chip on added items and faded "removed in draft" (from `/changes`), via one `svgChip(text, x, y, variant)` shared with the rpc chip |
| web/js/views/flow-removed.js | N ~60 | "N calls removed since the baseline" list under the diagram (ghosts with `egr:` under the flow's services) |
| web/js/components/field-diff.js | N ~90 | merges `schemaRows` with `fieldMarks` and removed ghosts into rows; head sentence "1 new, 1 changed, 1 removed"; empty "No field changed since the baseline." |
| components/schema-table.js | C | optional `marks` arg → row classes + badge + was |
| views/system.js, inventory.js, service.js, endpoint-panel.js, store.js, event.js, flow-draw-heads.js, flow-draw-rows.js, sidebar.js | C | call the modules above; each stays ≤ 250; service page: section titles get badges; page head of design envs: `design` chip + "from <src>, <date>" + compare switch |

Regions by subsystem on the map (frame 2 columns) and the subsystem level are **phase 3**: 1b-2 draws marks on today's layout.
"Transport not decided" edges: `--ink-2` solid, chip "kind tbd", passes the transport filter like `other`.

## 9. Tests and QA (1b-2)
- Pure: `tests/marks-store.test.ts` (anchor lookup, field map, ghosts), `tests/flow-marks.test.ts` (arrow → anchor rule:
  egress mark wins, new target ingress next, children of a new component unmarked), `tests/inventory-status.test.ts` (filter counts = rows).
- Preview: `npm run preview`; a test imports `api-local-design.js` against a built data.js: marks for `sase-hld` + `hld-import`
  equal the server's `/marks` for the same seed (same core); apply refused.
- Visual (designer agent, scratch server, seed): frames 2, 4, 5, 7 at 1440 and 760, light and dark; URLs
  `#/?env=sase-hld&draft=hld-import`, `#/flows?env=sase-hld&draft=hld-import&mode=edit&tabs=sase-agent/in.tunnel.open`,
  endpoint panel of a changed DTO, `#/inventory?env=sase-hld&draft=hld-import`; `act.mjs`: `click:[data-qa=mode-edit]`,
  `click:[data-compare=source]`, Review open, Discard dialog. Checklist: designer notes §4 F2/F4/F5/F7 minus regions and discussions.
- Golden traceHash and every 1b-1 suite unchanged.

## 10. Docs, demo, version (1b-2)
UI-GUIDE.md §10 "Design environments and status marks" (designer notes §2 text), design/AUDIT.md rows for the new pages,
DEMOS.md: the four links above. `package.json` → **0.24.0**. After deploy: re-seed samples (no `--bugs`), give the maintainer the links.

## 11. Risks (1b-2)
1. Marks and draft refetch on every edit: one marks request per (env, draft, compare); never refetch on step walk or polling.
2. Arrow identity after redraw (developer trap 6): join marks by anchor computed from the message, never by row index.
3. Yellow budget: `--new` only on spark/New tint; `--warn` never a glyph (designer §2).
4. Preview drift: api-local-design must use the same core functions; the parity test in §9 guards it.

Follow-up (not in 1b): once E1's `server/events/bus.ts` lands, `applyDraft`/`discardDraft`/`createDraft` may publish
`draft.applied` / `draft.discarded` / `env.changed` through it, so open pages refresh marks without polling.

## 12. Decisions for the maintainer (recommendation first)
- **M1** `flow_names` table lands in 006 (apply writes plan flow names; naming UI stays 2a), so 2a needs no names migration (007 belongs to E1; later ones 008+). Recommend yes.
- **M2** Manual CRUD routes now refuse both kinds (`ENV_SEALED` / `ENV_DRAFT`). Keep them as 409 until 2a, then remove. Recommend keep.
- **M3** Plan questions with `blocking: true`: report only (recommend), or refuse `apply_draft` until answered.
- **M4** Changelog: per-service rows (tagged `draft_id`) plus one summary row `kind 'draft'` per apply. Recommend yes (versions stay per service).

## Lead decisions (2026-10-21)
M1 yes (flow_names in 006). M2 keep 409 on manual CRUD for both kinds until 2a, then remove. M3 blocking plan
questions are reported, not enforced. M4 yes (one row per service tagged draft_id + one summary row per apply).
Demo marks show with `&draft=hld-import`, as specified.
