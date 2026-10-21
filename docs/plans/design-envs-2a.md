# Increment 2a: references, one-level import, edit forms, flow names (build spec)

Base: main at 9682352 (0.24.1). Read first: design-envs.md (decisions), design-envs-1b.md §0 (anchor grammar, ItemRow, sealed
envs never take the new paths), mockup `design/mockups/design-env.html` frames 4, 6, 7 and **10** (approved rev 4).
Two sequential parts, each its own worktree, QA pass and merge: **2a-1 backend (0.25.0)**, then **2a-2 UI (0.26.0)**.
Every file ≤ 250 lines (tests ≤ 350, `npm run check:size`); core/ stays pure (no `node:`, `import type` for types). 2b (search
every environment, `find_in_envs`) and 2c (drag to add a call, subsystem bands) are out of scope.

## 0. Ground rules for both parts
- **Sealed envs never take the new paths.** Reference decoration, import, forms: design envs only. A sealed trace / entry list
  gains no field except `name`/`summary` (flow names are annotations on every env, decision 6). Golden traceHash stays green.
- **No duplicated copy code.** Import works on ItemRows (the `baseline_items` encoding) and reuses `envItemRows`, the infra-owner
  rule of `env-copy-channels.ts` (moved to `core/infra-owner.ts`, both call it), `downstreamIngress`, `prepareOps`, `appendOps`.
- **Every form edit and every import is ops** through `appendOps` (validated, all or nothing, newer edit wins on apply). The form
  builders are pure core, so REST, MCP and the preview build the same ops.
- **Reference** (one definition, `core/references.ts`): an ingress row `I` of a design env is a reference iff
  (a) it has an *origin* (a baseline row `ing:` for it, or an import op in the draft being read), (b) `handlers(I)` =
  `[I.handler, ...I.events[].handler]` filtered non-empty is not empty, and (c) none of those handlers is a `functions` row of
  `I.service`. A design-made endpoint with a dangling handler is **not** a reference (it is "not designed yet").
  Its source = the origin's `sourceEnv`. A Components copy makes every copied endpoint a reference; a Full copy none.

---------------------------------------------------------------------------------------------------------------------
# Part 2a-1: backend (0.25.0)

## 1. Migration `server/db/migrations/008_draft_origin.sql` (additive)
```sql
-- 0.25.0: an op that imports an item from another environment records where it came from. Until the draft is applied the
-- import's baseline lives here (marks read it from the ops); apply copies it into baseline_items. NULL for every other op.
ALTER TABLE draft_ops ADD COLUMN origin TEXT;   -- JSON {"env": "<source env>", "version": <source snapshot version> | null}
```
**Why on the ops, not in `baseline_items` at import time:** writing baseline rows for items that exist only in a draft would show
them as Removed in the env and in every other draft, and leave orphans on discard, undo or revert. On the op they follow the
draft's own life for free: undo / revert / svc delete drop them, discard keeps them for the record, the preview (ops in memory)
works unchanged. A separate `draft_baseline` table was rejected: it needs the same cleanup rules done by hand.

## 2. Core (pure)
| File | Lines | Exports |
|---|---|---|
| core/infra-owner.ts | N ~25 | `infraOwnerName(taken: Set<string>, source: string): string` (`<source>-infra`, `-2`… on clash); `infraBindingId(service, id) = \`${service}.${id}\``. `env-copy-channels.ts` uses both (behaviour identical: env-copy tests unchanged) |
| core/references.ts | N ~90 | `interface Origin {sourceEnv; takenAt; inDraft?: boolean}`; `originsOf(base: {service,list,key,sourceEnv,takenAt}[], draftBase?): Map<rowId, Origin>`; `referencesOf(cur: ItemRow[], origins, copiedAt: string \| null): EnvRefs` |
| core/flow-refs.ts | N ~100 | `decorateDesignTrace(t: Trace, refs: EnvRefs, kindOf: (s) => string \| undefined): DesignTrace`; `refsReached(g: GraphIndex, refs: EnvRefs): Map<\`${service}:${ingress}\`, number>` (distinct reference endpoints a flow reaches; graph reachability over call/egress steps and `downstreamIngress`, memo per fn with a cycle guard, WeakMap per graph; same "not followed" rules as flow-counts: frontier, unresolved, leaves) |
| core/import-level.ts | N ~190 | `importSet(i: ImportInput): ImportSet` (rules in §4); throws `ImportError {code: 'NO_ITEM' \| 'BAD_ANCHOR' \| 'NOTHING_TO_IMPORT', message}` |
| core/import-preview.ts | N ~80 | `previewOf(set: ImportSet, anchor, source): ImportPreview` (counts, the panel's summary); `importOps(set): {ops: DraftOpInput[]; origins: OpOrigin[]}` (one upsert per item, `service` on `ch:` ops, aligned arrays) |
| core/import-baseline.ts | N ~50 | `importBaseline(ops: DraftOp[], present: Set<rowId>): OriginRow[]`: ops with `origin` in seq order; a `delete svc:<s>` drops earlier entries of s; last origin op per rowId; kept only if rowId ∈ `present` (imported then deleted in the draft = nothing, never a Removed mark). Row = `{service, list, key, data: op.data (header: without groupPath, as copy writes it), sourceEnv: origin.env, sourceVersion: origin.version, takenAt: op.at}` |
| core/edit-forms.ts | N ~170 | form types (§5) + `componentOps`, `endpointOps`, `flowOps`, `dtoOps`, `deleteOps`; `designEditOps(edit: DesignEdit, rows: ItemRow[]): DraftOpInput[]` (dispatch; throws `EditError {code, message, field?}`) |
| core/edit-calls.ts | N ~150 | `callOps(e: CallEdit, rows)`, `deleteCallOps(e: DeleteCallEdit, rows)`, `egressIdFor(service, target, rows)`, `defaultMode(transport, bindKey)` |
| core/design-rules.ts | N ~80 | `designIssues(after: Map<rowId, ItemRow>, touched: {index, row}[], groups: string[]): {index, code, message}[]` (§5 rules) |
| core/call-view.ts | N ~60 | `callView(g, refs, service, egressId): CallView` |
| core/draft-ops.ts | C +3 | `DraftOp.origin?: OpOrigin \| null`; `export interface OpOrigin {env: string; version: number \| null}` |

```ts
// core/references.ts
export interface RefEndpoint { service: string; ingress: string; bindKey: string; source: string }
export interface EnvRefs {
  endpoints: Record<string, RefEndpoint>;                                  // 'ing:<s>/<id>' → a reference
  components: Record<string, { refs: number; endpoints: number }>;         // 'svc:<s>' with ≥ 1 reference endpoint
  origins: Record<string, { from: string; at: string; imported: boolean; inDraft?: true }>; // 'ing:' with behaviour from a source
}                                                                           // imported = takenAt ≠ env copied_at
// core/flow-refs.ts
export interface PartialStep { message: number; anchor: string; service: string; ingress: string; label: string; source: string }
export type DesignTrace = Trace & { partial?: { steps: PartialStep[] } };  // absent when no step continues into a reference
// messages gain `reference?: {anchor, source}`; service participants gain `serviceKind?: string`
```
`decorateDesignTrace`: every message with `target` and kind `entry | egress | deliver` whose `ing:<target.service>/<target.ingress>`
is in `refs.endpoints` gets `reference`; `partial.steps` = those messages, first per anchor, `message` = 0-based index in
`t.messages` (the UI maps it to its step number; never compute step numbers here). Types live here, **core/trace.ts is untouched**.

## 3. References on the server
| File | Lines | Change |
|---|---|---|
| server/refs.ts | N ~70 | `refsFor(ctx, env, draft: string \| null): EnvRefs` (memo `refs:<env>\|<draft>`, deps = env; sealed → empty); `designTrace(ctx, env, draft, t)` (design env → `decorateDesignTrace` with `kindOf` from the graph's services; sealed → `t` as is) |
| server/marks.ts | C | export `cached`; with a draft, `base` = baseline rows overridden by `importBaseline(loadOps, ids of the overlay)` (by rowId); memo deps add every origin env; result gains **`refs: EnvRefs`** (= `refsFor`; marks are already refetched after every draft edit, so the UI needs no second request) |
| core/diff/index.ts | C +1 | `EnvMarks.refs?: EnvRefs` (set by the server and the preview, not by `diffEnv`) |
| server/store/item-rows.ts | C | `sourceNowRows`: each baseline header (and its rows) is looked up in **its own** `sourceEnv` (load `envItemRows` once per distinct source); a row whose source env is gone is compared with itself (no drift); `draftBaseline(db, env, ops, overlay) = importBaseline(ops, ids(overlay))` |
| server/routes/queries.ts | C | `trace`: `ctx` + `designTrace(...)` on the result. NO_HANDLER (start ingress has no handler fn): details become `{source, service, ingress, reference: boolean, anchor: 'ing:…'}`, source = the reference's own source (falls back to env.source); message "This endpoint is a reference: its behaviour lives in <source>". `entry-points`: each item gains `name?`, `summary?` (first 140 chars of the human flow description), and in a design env `reference?: true` (the entry itself is a reference) and `partial?: number` (from `refsReached`) |
| server/mcp/tools/flows.ts | C | `trace` tool: same decoration; `entry_points` tool: same fields |

## 4. Import one level into a draft
### Rules (`importSet`)
`ImportInput = {source, anchor, srcRows: ItemRow[], srcGraph: GraphIndex, srcVersions: Map<service, number>, here: ItemRow[]
(env + draft overlay), groups: string[], groupPath?: string, infraOwner: string}`. Every wanted row already in `here` (by rowId)
is **not** re-imported: it goes to `alreadyHere` with `differs = !same(list, a, b)` (the design's version is kept, even if edited).
- **`ing:<S>/<I>`** (an endpoint and its behaviour):
  1. `I` must be in `srcRows` (`NO_ITEM`). Header of `S` if `here` lacks it: source header minus `version/harvestedAt/commit`;
     `groupPath` = `i.groupPath` if given (must be in `groups`, else `NO_GROUP`), else the source's if it is one of `groups`, else none.
  2. The ingress `I`; its DTOs (`dto` rows of `S`, `I|*|*`).
  3. Functions: closure from `handlers(I) ∪ I.middleware` over `call` steps whose target is a function of `S` (inside the component only).
  4. For each step of those functions: `egress` target → that egress row; `resource` target → that resource row.
  5. Schemas: `schema` rows whose storeKey is a `bindKey` of a resource in (4), even when the resource is already here.
     Event DTOs: types (no globs) in imported egress `events`, step `event`, `I.events[].type`.
  6. For each imported egress `E`, `downstreamIngress(srcGraph, E)` → `{ingress T, via}`: every `channel` in `via` → its row; every
     `binding` in `via` → its row. Owner of a channel / binding row: its source owner if that header is in `here` (or comes along),
     else `infraOwner` (binding id then `infraBindingId(owner, id)`, as a Components copy writes it); `infraOwner`'s header
     (`{kind:'infra', description:'Channels and bindings imported from <source>.'}`) comes along when absent.
  7. `T` in the same component `S` (a self-call through a queue): `T` and its closure come along (still inside `S`).
     `T` in another component: listed in `references` with `state` = `designed` (here, with a handler fn) | `reference` (here,
     without) | `new-reference` (absent: its header if absent + the ingress `T` + its DTOs come along, **no functions**; one level,
     never recursive).
- **`svc:<S>`** (component only, objects): header (as 1.), every `ingress`, `egress`, `resources`, `channels`, `bindings` of `S`, its DTOs,
  schemas of its resources' stores, event DTOs of its events. **No functions, no downstream**: its endpoints become references.
- Any other anchor kind → `BAD_ANCHOR`. No item left after the `alreadyHere` filter → `NOTHING_TO_IMPORT`.
- Origin per item: `{env: source, version: srcVersions.get(row.service) ?? null}`; rows under `infraOwner` and env-scoped rows: `version: null`.
```ts
type Why = 'header' | 'ingress' | 'handler' | 'inside' | 'middleware' | 'egress' | 'resource' | 'schema' | 'event_dto' | 'dto' | 'channel' | 'binding' | 'owner' | 'reference';
interface ImportItem { row: ItemRow; why: Why; origin: OpOrigin }
interface RefTarget { service: string; ingress: string; bindKey: string; label: string; state: 'designed' | 'reference' | 'new-reference' }
interface ImportSet { level: 'endpoint' | 'component'; items: ImportItem[]; alreadyHere: { anchor: string; label: string; differs: boolean }[]; references: RefTarget[] }
interface ImportPreview {
  source: string; anchor: string; level: 'endpoint' | 'component'; total: number;               // total = items.length = ops
  counts: Record<'headers' | 'ingress' | 'functions' | 'egress' | 'resources' | 'channels' | 'bindings' | 'dtos' | 'messages' | 'schemas', number>;
  summary: { handler?: string; inside: number; calls: { anchor: string; label: string }[]; stores: { key: string; access?: string }[] }; // frame 10's dl
  items: { anchor: string; why: Why; label: string }[]; alreadyHere: ImportSet['alreadyHere']; references: RefTarget[]; warnings: string[];
}
```

### Server, REST, MCP
| File | Lines | Change |
|---|---|---|
| server/store/draft-import.ts | N ~100 | `importPreview(db, env, slug, {source, anchor, groupPath?})` and `importIntoDraft(db, env, slug, {source, anchor, groupPath?, author?, byAi?})`: guard `'draft'`; `source` must exist (404) and ≠ env (400); `here` = overlay; `infraOwner` = an `infra` service of `here` named `<source>-infra…` if any, else `infraOwnerName(services of here ∪ source, source)`; `srcGraph` = `ctx.view(source).g` (cached graph, passed in); import = `importOps` → `appendOps(..., {author, byAi, origins})` in one tx → `{from, to, counts, preview}` |
| server/store/drafts.ts | C | `appendOps(db, env, slug, inputs, who: {author?, byAi?, origins?: (OpOrigin \| null)[]})` writes `origin` JSON; `loadOps` reads it; public inputs never carry `origin` (`validateOpShape` refuses an `origin` key: "origin is set by import only") |
| server/store/draft-apply.ts + server/store/baseline-write.ts (N ~30) | C | after `ingestIn` and `writeSide`: `writeImportBaseline(db, env, importBaseline(allOps, ids(envItemRows(env))))` (INSERT OR REPLACE into `baseline_items`); summary changelog `changes.imported = n`. Dry run rolls it back with the rest |
| server/routes/draft-edits.ts | N ~60 | the import and edit routes below |
| server/mcp/tools/import.ts | N ~50 | `import_preview`, `import_into_draft` |

| Method | Path | Body / query → result |
|---|---|---|
| GET | `/api/envs/:env/drafts/:slug/import/preview?source=&anchor=&groupPath=` | `ImportPreview` (read only) |
| POST | `/api/envs/:env/drafts/:slug/import` | `{source, anchor, groupPath?, author?}` → 201 `{from, to, counts, preview}`; 404 source / `NO_ITEM`; 400 `BAD_ANCHOR`, source = env; 409 `NOTHING_TO_IMPORT`, `ENV_SEALED`, `DRAFT_CLOSED`; 422 `NO_GROUP` |

MCP: `import_preview {env, draft, source, anchor, groupPath?}` (read) and `import_into_draft {env, draft, source, anchor, groupPath?}`
(AI edit, `by_ai = 1`). Descriptions say: one level, never recursive; what stays a reference is listed with its own anchor to import next;
imported items carry their source's current revision as baseline (no New mark); nothing is written to the env until `apply_draft`.

## 5. Edit forms as ops
### Shapes (`core/edit-forms.ts`; one `DesignEdit` union, the UI form, REST and MCP send it as is)
```ts
type DesignEdit =
  | { kind: 'component'; name: string; serviceKind: 'service' | 'gateway' | 'lambda' | 'infra' | 'client-app'; groupPath?: string; team?: string; description?: string }
  | { kind: 'endpoint'; service: string; id?: string; transport: Transport; bindKey: string; handler?: string; entryPoint?: boolean; events?: { type: string; handler?: string }[]; description?: string }
  | { kind: 'call'; from: { service: string; fn: string }; before?: number;                 // insert before this step seq (default: last)
      to: { service: string; ingress: string } | { endpoint: EndpointEdit } | { bindKey: string; transport: Transport };  // existing | new endpoint | not designed yet
      edit?: { egress: string; seq: number };                                               // replace this existing call
      mode?: Mode; operation?: string; condition?: string; event?: string; description?: string }
  | { kind: 'delete-call'; service: string; fn: string; seq: number }
  | { kind: 'flow'; service: string; ingress: string; name?: string; description?: string; entryPoint?: boolean; order?: { fn: string; seqs: number[] } }
  | { kind: 'dto'; service: string; ingress: string; role: 'request' | 'response'; status?: string; content: unknown }
  | { kind: 'event-dto'; type: string; content: unknown }
  | { kind: 'delete'; anchor: string };                                                     // component (svc:), endpoint (ing:), dto:, evt:
```
Builder rules (each returns whole-item upserts/deletes; the current item comes from `rows` = the overlay):
- **component**: `upsert svc:<name>` `{kind: serviceKind, groupPath?, team?, description?, ...kept}` (existing header: other fields
  such as `repo`, `details` are kept). Name `^[a-z0-9][a-z0-9-]{0,62}$` (`BAD_NAME`). No rename in 2a (form says "delete and add").
- **endpoint**: id default = `in.` + slug of the bindKey's last segment, unique in the service (`-2`…); handler default `<id>.handle`;
  when the handler function is absent, also `upsert fn:<s>/<handler>` `{id, name: handler, steps: []}` so the endpoint draws a bar
  and is a flow start (a design endpoint is never a reference). `undecided` bind key: `tbd:<service>/<name>` (the form fills it).
- **call** (an arrow that traces): (1) `upsert egr:<from.service>/<egressIdFor>` `{id, bindKey: target ingress bindKey | to.bindKey,
  transport: target's | to.transport, mode: e.mode ?? defaultMode}`; (2) `upsert fn:<from.service>/<from.fn>` = the function with a
  new step `{type: 'egress', target: egressId, operation?, condition?, event?, mode?}` inserted before `before` (seqs renumbered
  1..n, `altGroup` kept), creating the function when absent; (3) `to.endpoint` → the endpoint ops first. `edit` replaces that step
  (and the egress when its key, transport or mode change; a shared egress is never mutated: a new id is made). `egressIdFor` =
  `out.<target service>.<slug of operation | target ingress id>`, unique. `defaultMode`: async for sns, sqs, eventbridge, amqp
  (not `amqp-rpc:`), event; sync otherwise (incl. undecided). Per-call `description` → the callee description store is 4: ignored, warning.
- **delete-call**: remove the step; delete the egress when no other step of that service targets it.
- **flow**: `entryPoint` → ingress upsert; `name`/`description` → `upsert flow:<s>/<ingress>` merged into the draft's flow item;
  `order` → the function's steps in that order (every seq exactly once, else `BAD_ORDER`), renumbered 1..n. Reorder stays within one function.
- **dto / event-dto** → `dto:` / `evt:` upsert `{content, meta: null}` (existing `meta` kept). **delete** → `delete <anchor>`.
### Validation added (`core/design-rules.ts`, called by `prepareOps` after the whole request is laid over, like the schema check)
`NO_TARGET`: a step with a `target` in a function this request upserts must name a function / egress / resource of that service.
`NO_GROUP`: a header's `groupPath` must be '' or one of the env's groups. `BAD_KIND`: header kind outside the enum. The preview's
`editDraft` runs `designIssues` too. `prepareOps(rows, inputs, {groups})` gets the env's groups (`getEnvRow(...).groups`).
### Routes / MCP
| Method | Path | Body / query → result |
|---|---|---|
| POST | `/api/envs/:env/drafts/:slug/edits` | `{edit: DesignEdit, author?}` → 201 `{from, to, counts, ops: DraftOpInput[], warnings}`; 422 `EditError.code` (with `field`) or the op codes |
| GET | `/api/envs/:env/call?service=&egress=&draft=` | `CallView` = `{egress, steps: {fn, seq, operation?}[], targets: {service, ingress, bindKey, reference?: RefEndpoint}[]}` (the form reads it; **`targets[i].reference` is the edit-across-reference contract**) |

MCP: `edit_design {env, draft, edit}` (same builder; `by_ai = 1`; description lists the union), `get_call {env, service, egress, draft?}` (read).
**Manual CRUD removed** (lead decision M2: "keep 409 until 2a, then remove"): routes `POST/PATCH/DELETE /api/envs/:env/services[/:service]`,
`POST/PUT/DELETE …/services/:service/:list[/*key]`, MCP `upsert_entity`/`delete_entity`, store `createService`, `updateService`,
`upsertEntity`, `deleteEntity`, `deleteService` (keep `deleteServiceIn`), `Writer 'manual'` and `ENV_DRAFT`. GETs stay. API.md gets a
"Removed in 0.25.0: edit a design through a draft" note.

## 6. Flow names
`server/store/flow-names.ts` N ~60: `listFlowNames(db, env)`, `putFlowName(db, g, env, {service, ingress, name, author})` (env must
exist; ingress must be in `g` (422 `NO_INGRESS`); name trimmed, ≤ 200; `''` deletes) — any env kind (annotation, decision 6), no draft.
`server/routes/flow-names.ts` N ~30: `GET /api/envs/:env/flow-names[?draft=]` → `{service, ingress, name, author, updatedAt}[]` (with a
draft: a draft `flow:` op's `name` wins); `PUT /api/envs/:env/flow-names` `{service, ingress, name, author?}` → `{service, ingress, name: string | null}`.
**Where a rename goes** (decision D4): Edit mode with an open draft → `edits {kind:'flow', name}` (applied with the draft); otherwise PUT.
`server/draft-reader.ts` C: `rowsReader(rows, fallback: DataReader)` — `flowText` falls back to the db reader when the draft has no flow
op for it (today a draft read loses DB names). MCP `get_flow_names {env, draft?}`, `set_flow_name {env, service, ingress, name, draft?}`
(with `draft` → the flow edit op). Entry points and the trace's `start` carry `name` (§3).

## 7. Preview (scripts/build-preview.ts, web/js/api-local-design.js)
data.js gains `rows[<source>]` for every env that is the source of a design (prod); draft ops keep `origin`. api-local-design: marks
`base` = baseline + `importBaseline`, `refs` = `referencesOf`, `importPreview` / `importIntoDraft` / `designEdit` / `call` /
`flowNames` / `setFlowName` (in memory) with the same core; trace and entry points decorated as the server does. Apply stays refused.
api-local-design is at 101 lines: put the new functions in `web/js/api-local-edits.js` (N ~120), composed by it.

## 8. Tests (2a-1). One concern per suite; existing assertions change only where listed, with the reason in the commit
1. **references.test.ts** (pure): Components copy → every copied ingress a reference with source prod; Full copy → none; design-made
   endpoint with no handler fn → not a reference; events-only consumer; an import op in a draft gives origin `inDraft`; `components` counts.
2. **flow-refs.test.ts** (pure): `decorateDesignTrace` marks the right messages, `partial` first per anchor, indices valid;
   `refsReached` = brute force (trace every entry, count reference anchors) over sase-hld + hld-import.
3. **import-level.test.ts** (pure, samples): `ing:users-svc/in.getPosture` from prod into sase-hld + hld-import overlay → handler
   `get_posture` + `load_devices` (inside), egress to auth-svc verify, schemas of `postgres:users-db/users`, DTOs; `cache`/`usersDb`
   in `alreadyHere`; `auth-svc/in.verify` in `references` with state `reference`, no auth-svc functions (never recursive); `svc:` import
   into a blank design: no functions, all endpoints references; an async egress brings its channel + bindings under the infra owner
   (users-svc `userEvents.publish`, eventbridge); a new-reference stub; `NO_ITEM`, `BAD_ANCHOR`, `NOTHING_TO_IMPORT`; groupPath rule.
4. **import-baseline.test.ts** (pure): last origin op wins; svc delete drops; imported then deleted → no row; header without groupPath.
5. **draft-import-api.test.ts**: preview `total` = ops appended; after import, `/marks?draft=` has no mark under the imported anchors
   and `refs` no longer lists `in.getPosture`; undo of the import ops → no ghost; a later edit of an imported function → Changed;
   apply → `baseline_items` rows with `source_env 'prod'`, `source_version` = prod's users-svc version, marks after apply clean;
   discard → no baseline rows; import from a design source (`sase-hld-v2` style Full copy); against=source after a prod delta to
   users-svc shows drift on the imported function; MCP tools give the same ops with `by_ai = 1`; sealed target 409.
6. **edit-forms.test.ts** (pure): every builder; egress id uniqueness; mode defaults incl. `amqp-rpc:` and undecided; insert before /
   renumber; edit of a call on a shared egress makes a new egress; delete-call keeps a still-used egress; endpoint creates the handler
   stub; `BAD_ORDER`, `BAD_NAME`.
7. **design-edits-api.test.ts — a hand-drawn flow traces end to end**: blank design with groups; via `edits`: component `agent`
   (client-app), `edge`, `core`; endpoint on `agent` (entryPoint); call agent→edge with a new endpoint; call edge→core undecided
   (`tbd:`); call edge→`http:GET nowhere/x` (not designed yet). `trace` with `?draft=` from agent's entry reaches edge's handler and
   core's (undecided arrow), the missing target is `unresolved`/neutral; `entry-points` lists it; apply → same `traceHash` as the
   draft read, contract has no `dangling-egress` for the undecided pair; `NO_TARGET`, `NO_GROUP`, `BAD_KIND` 422s; `GET call` on a
   call into a copied endpoint returns `targets[0].reference.source = 'prod'`, on a designed one none.
8. **flow-names.test.ts**: PUT/GET on sealed and design; `''` deletes; unknown ingress 422; draft flow op name wins with `?draft=` and
   DB names survive a draft read (reader fallback); entry points carry `name`/`summary`; MCP set with `draft` appends a `flow:` op.
9. **trace-refs.test.ts**: sase-hld + hld-import: the agent flow's message into `users-svc/in.getPosture` has `reference {source: 'prod'}`
   and `partial.steps` lists it; tracing `auth-svc/in.verify` → 409 NO_HANDLER `reference: true`; entry points `reference`/`partial`;
   prod trace and entry points have none of these fields (deepEqual with 0.24.1 output minus `name`).
10. **env-guard.test.ts** (update): MANUAL list deleted; removed routes absent from `router.list()` and answer 404; MCP `upsert_entity`
    / `delete_entity` absent; DRAFT gains `POST …/drafts/:slug/import`, `POST …/drafts/:slug/edits`; EXEMPT gains `PUT …/flow-names`;
    MCP_READ gains `import_preview`, `get_call`, `get_flow_names`; MCP DRAFT gains `import_into_draft`, `edit_design`; `set_flow_name` exempt.
    Any remaining test that called the removed routes moves to `edits` (same assertions).
11. **migrations.test.ts**: 007 DB with ops → 008: `origin` NULL, `.pre-008.bak`; then on a copy of the live DB (never `data/`): counts unchanged.
12. **trace-golden**: the fixture gains exactly one entry (`users-svc/in.getPosture`, the demo endpoint); every other hash byte-identical.
13. **preview-design.test.ts** (extend): api-local import preview, refs and marks for sase-hld + hld-import equal the server's; `designEdit` in memory; apply refused.

## 9. Demo, docs, version (2a-1)
- `samples/users-svc.json`: ingress `in.getPosture` `http:GET users-svc/users/{id}/posture` → `get_posture` (call `load_devices`;
  resource `cache`; egress `out.auth.verify` `http:POST auth-svc/verify`), `load_devices` (resource `usersDb`), a response DTO in
  `samples/dtos/`. Counts asserted by other suites move by one where they count prod ingress (reason in the commit).
- `samples/envs/sase-hld.plan.json`: pop-edge egress `out.users.posture` (`http:GET users-svc/users/{id}/posture`) + a step in
  `TunnelHandler.open`, flow steps text updated. Effect in `hld-import`: step 3 continues into a reference (partial flow), Import works.
  The seed does **not** import (the maintainer clicks it; re-seeding restores the before state).
- docs/API.md (Import, Edits, Call, Flow names, `refs` in marks, trace `reference`/`partial`/`serviceKind`, entry-point fields,
  NO_HANDLER details, removed routes, error codes), ARCHITECTURE.md (references, import, forms, origin column), DESIGN.md (reference
  definition, why origin lives on the op, one level), DESIGN-IMPORT.md §9 (`import_into_draft`, `edit_design`), DEMOS.md row:
  `/api/envs/sase-hld/drafts/hld-import/import/preview?source=prod&anchor=ing:users-svc/in.getPosture` (API until 2a-2). `package.json` → **0.25.0**.

## 10. Risks (2a-1)
1. `NO_TARGET` could refuse existing plans / copies: it checks only functions the request upserts; the sase plan and every 1b test must pass unchanged.
2. Removing routes: anything outside the repo that still calls them gets 404 (it has had 409 since 0.23.0). Grep web/ and scripts/ first.
3. `refsReached` on a Full copy of scale-test: < 150 ms warm (assert in test 2); memo per graph.
4. Marks memo now depends on origin envs: a prod ingest drops design marks memos (correct, slightly more recomputation).
5. Live DB: 008 only adds a column; dry-run on a backup copy, restart per CLAUDE.md.

---------------------------------------------------------------------------------------------------------------------
# Part 2a-2: UI (0.26.0). Starts after 2a-1 is merged. Frames 4, 6, 7, 10 are the approved design; designer notes §3.5–3.7, §1.17, §1.19.

## 11. Data
- `web/js/design/marks-store.js` C (+~25): `refOf(ingAnchor)`, `componentRefs(svc)`, `originOf(ingAnchor)` from `marks.refs`.
- `web/js/api.js` C: `importPreview`, `importIntoDraft`, `designEdit(env, slug, edit)`, `call(env, service, egress)`, `flowNames`, `setFlowName`.
  After `designEdit` / `importIntoDraft`: refetch marks (one request) and the open traces (tab cache keyed by draft op count).

## 12. Components (all ≤ 250; prefixed classes; app's `.seg`, `.select`, `.input`, `.fgrid` per designer §1.17)
| File | Lines | What |
|---|---|---|
| web/js/icons.js | C | symbol `i-lock` (SVG, not the 🔒 emoji: emoji rendering differs per OS; same size as `i-chg`) |
| web/js/components/lock.js | N ~40 | `lockChip(ref, {short})` → `.st` "reference from prod" with `i-lock`; `lockSvg(x, y)`; neutral `--ink-2`, never `--warn` |
| web/js/views/flow-refs-draw.js | N ~90 | at the bar end of a message with `reference`: lock + note "behaviour in <source>"; chip "Import into design" (Edit with a draft) or link "Open in <source>" (View); lifeline head locked (dashed outline, sub "reference from <source>") **iff every message into that participant has `reference`** (D6); client-app start (§13) |
| web/js/views/flow-partial.js | N ~50 | the neutral `.info` line under the stepbar: "Partial flow: N steps continue into references, so their behaviour isn't in this design: step k <service · label>, …" + "Import step k" links; step numbers from the walk's own numbering of `partial.steps[i].message` |
| web/js/views/flow-boundary.js | C | NO_HANDLER with `reference: true`: "This endpoint is a reference from <source>" + Import into design (Edit + draft) + Open in <source> |
| web/js/design/import-panel.js | N ~140 | frame 10 aside: kind chip + lock, h3 "Import <service> · <label>", sub "from <source> (now) into draft <name> · one level"; "Comes along: N items" dl (Handler + "and N functions it calls inside <s>", Calls it makes, Stores, Messages); "Already here: N" (collapsed, `differs` says "kept as in this design"); "Stays a reference: N" each with its own Import (opens its preview); the "Imported items are unchanged against <source>, so they get no spark. Edit them here and they show as Changed." note (D2); primary "Import N items into draft" · Cancel; states: loading, `NOTHING_TO_IMPORT` sentence, error box, toast "Imported N items into draft <name>" |
| web/js/design/forms/form-kit.js | N ~100 | `fgrid` rows, select/input/textarea, inline field errors from `EditError.field`, Done / Delete (danger, confirm) / Cancel; keyboard per designer §3.6; Done = one `designEdit` call, toast "Saved to draft <name>" |
| web/js/design/forms/component-form.js | N ~100 | name (new only), kind (incl. Client app), subsystem (env groups), team, description; Delete "Delete <name> and its N endpoints?" |
| web/js/design/forms/endpoint-form.js | N ~120 | transport (incl. "Not decided yet" → `undecided`, fills `tbd:`), bind key with a per-transport placeholder, handler, entry point, events (consumers); DTO links open dto-form |
| web/js/design/forms/call-form.js | N ~150 | frame 4 panel: From (fixed), To (components), Endpoint (its ingress + "+ New endpoint" → inline endpoint fields + "Not designed yet"), Transport (from the endpoint, editable only for new), Mode, Operation, Condition; Delete call; opens `GET call` first and shows ref-callout when `targets[].reference` |
| web/js/design/forms/ref-callout.js | N ~50 | frame 10 callout (`.callout` neutral, dot `--ink-2`): "The other side of this call is a reference: <s · label> lives in <source>. Your edit changes the call only, not what <s> does with it." + "Import <s>'s flow first" (opens import-panel) · "Edit the call only" (enables the fields; not remembered: every open asks) |
| web/js/design/forms/flow-form.js | N ~100 | name, description, entry point; steps of the bar's function as a list with ↑ ↓ buttons (keyboard), Done sends `order` |
| web/js/design/forms/dto-form.js | N ~80 | role, status, content (JSON textarea, parse error inline), uses schema-table for a preview |
| web/js/design/edit-open.js | N ~90 | in Edit mode with a draft: head click/Enter → component form; arrow → call form (entry arrow → endpoint form); "+ call" under a bar → call form `{from: {service, fn}}`; "+ component" → component form; View mode keeps today's panels |
| web/js/views/flow-name.js | N ~70 | the flow title as an editable name (pencil button, Enter saves, Esc cancels; "Name this flow" when unnamed); where the write goes per D4 |
| web/js/views/flow-list.js | C | name (bold) over the entry key (mono) and `summary` (frame 7); lock after the name when `reference` or `partial`; filter matches names; "Unnamed flows show their entry key." footnote |
| web/js/views/flow-tabs.js, flow-tab-view.js | C | tab title = name, else entry key; tab sub = `service · key` |
| web/js/views/service.js (+ service section file if it grows) | C | head chip "N reference endpoints"; endpoint rows: Behaviour column "reference from prod" + Import into design · "imported from prod, Oct 21" (`origins[].imported`) · "from prod" · "in this design" |

"+" for a new component (D5): a "+ component" button at the end of the flow head row and on each subsystem group row of Inventory
(group preset); subsystem bands in the flow view come with phase 3 and the "+" moves there. "+ call" sits under the last step of
each bar in Edit mode (a button, focusable; drag is 2c).

## 13. Leftovers
- **Client-app entry**: a trace whose start service has `serviceKind 'client-app'` drops the `client` column and its entry arrow; the
  agent's own lifeline is first with sub "client app" (stripe `--st-client`), the trigger (`details.trigger`) as the head's title, and
  the walk starts at the agent's first call (frame 10: "sase-agent · client app"). Find where an `other` entry gets the queue-like
  head (flow-cols / flow-draw-layout) and branch there; sealed flows unchanged.
- **"in draft" chip at 760**: when the chips don't fit between the step tile and the arrow end (`|x2 − x1| < total + 56`), draw them
  on a second line under the arrow label; never over the return label. Screenshot at 760 in the QA set.

## 14. Tests and QA (2a-2)
- Pure: `tests/flow-refs-ui.test.ts` (head lock iff all messages into it are references; auth-svc in frame 10 not locked),
  `tests/flow-partial.test.ts` (text and step numbers from the walk numbering), `tests/edit-open.test.ts` (which form for which click
  and mode), `tests/flow-name-target.test.ts` (D4 rule).
- Preview: `npm run preview`; forms work on in-memory drafts, import preview from bundled prod rows, Apply refused with its message.
- Visual (designer agent, scratch server, seed): frame 10 at `#/flows?env=sase-hld&draft=hld-import&mode=edit&tabs=sase-agent/in.tunnel.open&step=3`
  (lock, partial line, Import panel open via `act.mjs click:[data-qa=import-ref]`), the ref callout (click step 3's arrow), frame 4 call
  form, component form from "+ component", frame 7 flow list with names, service page of users-svc; 1440 and 760, light and dark;
  then do the import and screenshot again (lock gone, no spark, "imported from prod"). Checklist: UI-GUIDE §10 + the lines below.
- Golden traceHash and every 2a-1 suite unchanged.

## 15. Docs, demo, version (2a-2)
UI-GUIDE.md §10 gains: "A reference (lock) is neutral: a copied endpoint whose behaviour is in its source. Import into design copies
one level; what it calls stays a reference. A partial flow says which steps continue into references. Editing a call into a reference
asks every time." design/AUDIT.md rows for the import panel and forms. DEMOS.md rows: the frame 10 URL above ("click Import into
design on step 3, then Import 2 items"), and "add a POP component and a call by form": Edit → "+ component" `pop-swg` in Network
(POP) → "+ call" under pop-edge's bar → To pop-swg, + New endpoint `socket:tls/pop-swg/apply` → Done; the flow redraws with the new
call, "in draft" chip. `package.json` → **0.26.0**. After deploy: re-seed samples (no `--bugs`), give the maintainer the links.

## 16. Risks (2a-2)
1. Click handlers: Edit mode must not break View's arrow panel; edit-open is the only switch (tested).
2. Refetch storms: one marks request and one trace refetch per saved edit; never on step walk.
3. Lock vs warn: the lock is neutral (`--ink-2`), never `--warn`; the callout is neutral too (frame 10).
4. The flow page files are near 250: put new drawing in flow-refs-draw.js / flow-partial.js, not in flow-draw*.js.

## 17. Decisions for the maintainer (recommendation first)
- **D1** Import baseline stays on the import ops (`draft_ops.origin`, migration 008) until apply, then goes into `baseline_items`. Recommend yes.
- **D2** Imported items can be edited in the same draft (they show Changed); frame 10's note "become editable once the draft is applied"
  changes to "Edit them here and they show as Changed". Recommend yes.
- **D3** A callee the design lacks comes along as a reference stub (component header + endpoint + DTOs, no behaviour), so the imported
  call resolves and shows the lock. Alternative: leave it "not designed yet". Recommend the stub.
- **D4** Flow name edits: Edit mode with a draft → a draft op (applied with the draft); View mode or a sealed env → written at once. Recommend yes.
- **D5** Until subsystem bands exist (phase 3): "+ component" at the end of the flow head row and on Inventory subsystem rows. Recommend yes.
- **D6** A flow head shows the lock only when every call of this flow into that component reaches a reference (frame 10's auth-svc has
  references but is not locked); the service page and panel give the count. Recommend yes.
- **D7** No rename of components / endpoints in 2a (delete and add); a rename op with reference rewrites later. Recommend defer.
- **D8** The prod sample gains `users-svc GET /users/{id}/posture` for the demo (golden fixture +1 entry, all others identical). Recommend yes.

## Lead decisions (2026-10-21)
D1 yes (import baseline on draft ops, migration 008, copied to baseline_items on apply). D2 yes (imported items are
editable in the same draft and then show Changed; frame 10's "editable once applied" note is superseded). D3 stub.
D4 yes. D5 yes. D6 yes. D7 defer. D8 yes.

## Component colours (frame 11, lead decision 2026-10-21; override via bug)
Option A: pastel colour per component on lifeline heads (stripe + 14% tint) and activation bars (28% fill, nested
42%), arrows keep the transport colour. Palette `--cmp-1..8` from frame 11 (light/dark). Assignment is stored per
environment: a component gets the next free slot the first time it is seen in that env and keeps it (no clashes up
to 8; past 8 the palette repeats in order). Client apps, externals and data stores stay neutral; topics/queues keep
their transport colour. Backend (2a-1): store the assignment (e.g. `envs.colors` JSON in migration 008) and return
it in `GET /api/envs/meta`; a copy keeps the source's assignment. UI (2a-2): apply it on flows (heads, bars, folds,
step-bar dots) and the map node ring; UI-GUIDE §2/§8 updated with frame 11's wording.

## Inventory: filter by subsystem (maintainer feature request, lead decision 2026-10-21)
2a-2 adds a "Subsystem" select next to "All teams" on the Inventory (All subsystems, each group of the env in its
order with its label, "Not set"), a Subsystem column, and in design envs rows grouped by subsystem (frame 7). The
filter is in the URL (`subsystem=`). Backend: inventory rows already carry the service; add `groupPath` to rows if
missing (2a-1 may include it; otherwise 2a-2 adds it). Sealed envs show the select only when any service has a
groupPath.

## Lead note after 2a-1 (2026-10-21)
- Import counts are whatever the preview returns. On the Components-copied `sase-hld`, importing `users-svc/in.getPosture`
  brings 2 items (the functions `get_posture` and `load_devices`). The rest is already in the design and is listed under
  "Already here". Frame 10's "11 items" is an illustration only. The UI shows `total` from `import_preview`, never a
  fixed number.
- An endpoint whose handler was imported reads "imported from <source>" (a function's `origin` counts).

## Harvester bugs folded into 2a-2 (lead decisions 2026-10-21; override via bug)
These follow existing patterns, so no new mockup frame. The designer compares them against the nearest approved frame.
- **#60 Flows list marks:** each entry point in the Flows list carries the same New / Changed / Removed mark as the map
  (spark, yellow ring, struck-through). The tooltip is the "what changed" text from `GET /marks`. Marks are against the
  current "Compared with" choice (baseline | source) and `?draft=`. Shown only in design envs.
- **#61 "Changed only":** a toggle next to the Flows filter box. It shows entry points with New or Changed marks, and
  Removed ones as a second option. It combines with the search text and is kept in the URL as `changed=1`
  (`changed=all` also shows removed). Hidden in sealed envs.
- **#57 Flow text in draft review:** with `?draft=`, the flow page shows the draft's flow name, description and step
  descriptions (read from the draft, as 2a-1 serves them). Review changes lists flow-text ops as "Flow text: <name>"
  rows.
- **#59 Empty flow:** when the trace returns `noHandler: true` (0.25.1), the flow page opens with the entry
  lifeline only and a muted hint: "No handler function. This entry point has no behaviour in <env> yet." Description and
  links still work.
- **#54 Links (0.25.1 backend):** `links.main` is shown as a link next to the title (service view, flow header). `sub`
  links follow as small chips with an ↗ glyph. The entry-point list shows an ↗ icon when `main` is set. Links open in a
  new tab with `rel="noopener"`. Edit forms get a Links group with a main link plus a repeatable sub list.
- **#49 Runtime icon:** `details.runtime` (or `runtime`) set to `k8s-pod | k8s-deployment | k8s-daemonset | k8s-operator | k8s-job`
  adds a small Kubernetes glyph (a heptagon outline, drawn inline in icons.js, not a brand logo) at the top-left of the
  component on the map and inside the lifeline head. The tooltip is the runtime name. The edit form offers a runtime
  select.

## Flows list: collapsible, filter by subsystem and component (maintainer feature request 2026-10-21; layout by lead)
- **Collapsible list:** the Flows page's entry-point column gets a collapse control in its header (same chevron
  pattern as the rail). Collapsed, it becomes a narrow strip that shows the active flow's name and the filter summary,
  and the diagram takes the width. The state is kept per viewer (localStorage, wrapped in try/catch).
- **Two filter groups above the text filter, in this order:**
  1. **Subsystem:** a collapsible group. Its header is "Subsystem", followed by a summary of what is applied ("All", or
     "platform, network", or "3 of 5"). Expanded, it shows "Select all · Deselect all" and one checkbox per subsystem
     from `groupPath` (top level), with a count of entry points. Default is all selected. Collapsed, it shows only the
     summary.
  2. **Component:** the same pattern, listing the components of the selected subsystems only (it follows the subsystem
     choice). Select all / Deselect all act on that visible set. Default is all.
- The list shows entry points whose service is in the selected components. The filters combine with the text filter
  and the "Changed only" toggle (#61). Components with no `groupPath` fall under "(none)".
- The URL keeps `subsystems=a,b` and `components=x,y`; the parameter is left out when everything is selected, so links
  stay short. The same parameter names work with inventory's `subsystem=`, which takes one value.
- Accessibility: each group header is a button with `aria-expanded`. The checkboxes are real inputs in a fieldset
  with a legend. Keyboard works without a mouse.
- Sealed envs with no groupPath show a single "(none)" subsystem. Hide the Subsystem group when there is only one
  subsystem, but keep Component.
