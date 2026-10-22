# Flow-Mapper API

All endpoints are JSON unless noted. Errors look like
`{"error": {"code": "VERSION_MISMATCH", "message": "...", "details": ...}}`.

`:env` is an environment name (`prod`, `staging`, …). Manifests without `env` go to `default`.

## Ingest (harvesters)

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/ingest` | a manifest, or `{"manifests": [...]}` | `kind: full` replaces the service; `kind: delta` patches it. `?dryRun=1` validates and returns the changes without writing (200) |

Responses: `201 {results: [{env, service, fromVersion, toVersion, changes, changelogId, contract}]}`;
a dry run returns `200 {dryRun: true, results: [...]}` with the same result shape (nothing written).

A batch (`{"manifests": [...]}`) is one transaction: if any manifest is invalid or stale, the whole batch is rejected and nothing is written (a dry run likewise writes nothing). `contract` (warning `unresolved-detail-unknown-path` when an `unresolved` what=`detail` names a path other than `details.databases`, `client.databases`, `details.keyTemplate`, `details.dbIndex`, `details.ttlSeconds`; the entry is kept, never rejected) reports what the manifest leaves out or cannot link, judged against the env as it would be
after the whole batch. It never rejects:

```json
{"errors": 0, "warnings": 1, "infos": 1, "findings": [
  {"level": "warn", "code": "dangling-egress", "service": "orders-svc", "kind": "egress", "id": "pay.charge",
   "message": "egress 'pay.charge' (http:POST payments/charge) matches no ingress or channel in env 'prod'",
   "fix": "Check the bindKey spelling against the callee's ingress or the declared channel; ..."}]}
```

`level` is `error`, `warn` or `info`; `kind` is `ingress`, `egress`, `step`, `binding`, `channel` or
`service`. Codes are listed in HARVESTER-GUIDE.md ("Contract report"). Over MCP, `ingest_manifest`
returns the same and takes `dryRun: true`.

| Code | Status | Meaning | Harvester should |
|---|---|---|---|
| `INVALID` | 422 | Schema or internal-reference errors; `details` lists them | fix the manifest |
| `VERSION_NOT_NEWER` | 409 | `version` ≤ stored version | bump the version |
| `VERSION_MISMATCH` | 409 | delta `baseVersion` ≠ stored version; `details.currentVersion` | send a full manifest |
| `NOT_FOUND` | 404 | delta for a service that was never ingested | send a full manifest |

In a batch (`manifests` with more than one entry) the failing manifest is named: `message` starts with `manifests[<i>] (<service>):` and `details` is an object `{batchIndex, service, ...}` (for `INVALID` the list moves to `details.errors`; `currentVersion` stays alongside). A single manifest keeps the plain shapes above.

Schema: [`schema/manifest.schema.json`](../schema/manifest.schema.json). Examples: [`samples/`](../samples). Guide for harvester authors: [HARVESTER-GUIDE.md](HARVESTER-GUIDE.md).

## Environments (0.21.0)

An environment is `sealed` or `design`. **Sealed**: filled only through the harvester APIs (ingest full/delta, DTOs, event DTOs,
schemas, Redis keys). Every environment that harvesters have written
to is sealed, and an ingest into a name that does not exist yet creates it sealed. **Design**: created by a copy (below);
harvester writes are refused with `409 ENV_DESIGN` (a dry run is allowed, see below).
**Removed in 0.25.0: edit a design through a draft.** The Map CRUD write routes (`POST/PATCH/DELETE /api/envs/:env/services[/:service]`,
`POST/PUT/DELETE .../services/:service/:list[/*key]`) and the MCP tools `upsert_entity` / `delete_entity` are gone (they answered `409` since 0.23.0; now a removed
write method answers `405` where its path still has a GET, `404` elsewhere), and with them the error code `ENV_DRAFT`. A design is edited through drafts (below): edit forms, import, raw ops. Annotations (flow descriptions, bugs) are allowed in both kinds. One guard in the store write path does this.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/envs` | Names only, `string[]` (the preview and harvester scripts read it). A Blank design environment is listed. |
| GET | `/api/envs/meta` | `[{name, kind, source, copiedAt, groups: [{key, label, icon?}], levels, createdAt, createdBy, counts: {components, ingress, egress, ...}, colors: {component: slot}}]`. `colors`: the colour slot 1..8 of each component of the environment (the UI's `--cmp-1..8`): given the first time the component is seen there (ingest, draft edit or import of a new component, a copy keeps its source's slots, older environments are filled in on first read), kept for good (a deleted component keeps its slot, so a component added again gets its colour back), no two alike up to 8, then the palette repeats in order; client apps get none |
| GET | `/api/envs/:env/meta` | the same for one |
| POST | `/api/envs` | Create a design environment by copying. Body below. 201 with its meta. |
| GET | `/api/envs/:env/components` | `[{name, kind, team, groupPath, counts: {endpoints, calls, channels, stores, dtos}}]`: what each component brings into a Components copy (`channels`: the queues, topics and exchanges it declares or uses plus the routing out of them; `channelKeys` lists them, and the page counts the union of the picked rows) |
| GET | `/api/envs/:env/neighbours?services=a,b` | One hop: components that call or are called by a listed one, directly or through a topic, queue or exchange: `[{service, team, kind, reasons, reason}]`. Listed ones and `infra` services are left out. |
| DELETE | `/api/envs/:env` | Design environments only (`409 ENV_SEALED` for a sealed one). Removes its rows in every table (bugs stay). |

`POST /api/envs` body: `{name, source, mode: 'blank' | 'components' | 'full', groups: [{key, label, icon?}], levels, services: [{name, groupPath}], behaviour, entryPoints, infraGroupPath, createdBy}`.
`name`: lowercase letters, digits, `-`, at most 63 (`422` otherwise; `meta` and `new` are reserved); `409 EXISTS` when taken;
`404` for an unknown source or component. `groups` are the subsystems in order (key is a path like `platform` or `platform/identity`);
a service's `groupPath` must be one of them. `levels` defaults to `["Subsystem","Component"]`. One transaction: nothing is left behind on failure.
- `blank`: only the environment row. `source` is optional here (#77): a known one is recorded as lineage, a missing or unknown one leaves `source` `null`. `components` and `full` need `source`: a missing one is `400 BAD_REQUEST` naming the field (`details.field: 'source'`); an unknown one is `404`. Same for MCP `create_env`.
- `components`: the listed services with their ingress, egress, channels, bindings, resources, their DTOs, the event DTOs and store schemas they refer to, and their Redis key rows. A Components copy is self-contained: the channels (topics, queues, exchanges, buses) the picked services use (publish to, consume from, bind to), the routing out of them (the bindings that leave a copied channel and the queues they lead to) and the bindings between copied items come along even when another service declares them. They are stored under ONE synthetic `infra` service named `<source>-infra` (numbered if that name is taken) with `groupPath` `infra` (0.28.3, #64) or the body's `infraGroupPath`, so the declaring services' other entities stay behind, and they are in `baseline_items` (unchanged against the baseline). A call whose far side is a service that was not picked (a consumer's ingress, an RPC server) is still "no match" in link health: that is the gap the design fills. **No functions or steps** unless `behaviour: true` (0.25.1, #58; default false; also on MCP `create_env`): then the picked services' functions and steps are copied into the environment and into `baseline_items`, so their flows trace like the source's, they diff as unchanged, and their endpoints are not references. Without it there are no flows; an ingress keeps its `handler` id, which dangles (later edits are not blocked by problems the service already had). `behaviour` must be a boolean (`422`), and only `components` mode reads it.
  - **`infraGroupPath`** (0.28.3, #64; components mode; default `infra`): the subsystem of the `<source>-infra` service. Validated like any `groupPath` (lowercase, `-`, a path like `platform/infra`; `422` otherwise); it need not be one of the request's `groups`: a name that is no subsystem reads as a derived box (`infra`) in the subsystem view. `''` leaves the service without one. Existing copies are not migrated: set `groupPath` on the `<source>-infra` header with one edit (a later edit of that header needs a groupPath that is a subsystem of the environment, so add it with a `subsystem` edit first if it is not).
  - **`entryPoints`** (0.28.3, #63; `components` and `full`; `'none'` is the default for `components` since 0.28.4 (#65), `'keep'` for `full`): with `'none'` every copied ingress gets `entryPoint: false` in the environment and in `baseline_items`, so the copies are not listed as entry points, show no marks and diff as unchanged. Ingress added later (drafts, edits) are unaffected. Any other value is `422`, and so is `'none'` with `mode: 'blank'`. Also on MCP `create_env`. Existing copies: set `entryPoint: false` per ingress with an edit, or use Changed-only.
- `full`: everything of the source: all services including functions, DTOs, schemas, Redis keys, flow descriptions. Not bugs. Copying a design keeps its subsystems (unless `groups` is sent).
`icon` is one of `platform agent network cloud shield database` (`422` otherwise). The groups the design starts with are also frozen as its baseline of subsystems (`envs.baseline_groups`, 0.28.0). A **Full copy of a design** also copies its abstract links (and flow relations) and keeps that design's baseline groups; Blank and Components copies, and any copy of a sealed environment, carry no links.
A design owns its rows: nothing is shared with the source. The copied rows of a sealed source are frozen into `baseline_items`
(what the design was copied from; the marks below compare with it); a copy of a design keeps that design's original baseline.

## Drafts, marks and `?draft=` (0.23.0)

A **draft** is a named list of whole-item ops on a design environment. Reading with `?draft=<slug>` shows the environment as the
draft would leave it; **apply** writes it, as one delta per touched service (a full manifest for a new one) in one transaction,
through the same code as a harvester push. Sealed environments have no drafts.

### Anchors

One grammar names an item, for ops, marks, plan mapping and (later) threads. `<s>` is a service name (never contains `/`);
the rest is the key, verbatim (ids and keys may hold `/`, `:`, spaces, `#`).

| Anchor | Item |
|---|---|
| `svc:<s>` | the component (header); delete = the whole component |
| `fn:<s>/<id>` `ing:<s>/<id>` `egr:<s>/<id>` `res:<s>/<id>` `bind:<s>/<id>` | function, endpoint, call, resource, subscription |
| `ch:<bindKey>` | channel (env-wide key; an op also needs `service` = the owner) |
| `dto:<s>/<role>/<status or ->/<ingress>` | endpoint DTO (`role` request or response; ingress last, it may hold `/`) |
| `evt:<type>` | event DTO |
| `schema:<source>/<storeKey>` | store schema (`code`, `db` or `manual` first: store keys hold `/`) |
| `flow:<s>/<ingress>` | flow name and description (drafts) |
| `grp:<path>` | a subsystem's settings `{label, icon?, order}` (0.28.0; the path may hold `/`) |
| `link:<id>` | an abstract link (0.28.0) |
| `rel:<id>` | a typed flow-to-flow relation (0.28.2): `id` = `'r' + hash(from|to|type)`; item `{from: 'flow:<s>/<i>', to, type, note?}` |
| `<anchor>#<fieldPath>` | one field of a DTO, event DTO or schema (marks only), e.g. `evt:UserUpdated#devices[].certFingerprint` |

### Draft routes

Errors are `{error: {code, message, details}}`. Draft writes need a design (`409 ENV_SEALED` otherwise, `404` for an unknown environment).

| Method | Path | Body / query -> result |
|---|---|---|
| GET | `/api/envs/:env/drafts?status=open\|all` | `DraftInfo[]`: `{id, slug, name, status, createdBy, createdAt, updatedAt, closedAt, ops, authors, counts: {added, removed, changed}}` |
| POST | `/api/envs/:env/drafts` | `{name, slug?, createdBy?}` -> 201 `DraftInfo`. The slug comes from the name (`-2` on a clash); a given one that is taken is `409 EXISTS` |
| GET | `/api/envs/:env/drafts/:slug` | `DraftInfo & {ops, plan, report}` (any status; `ops` are the raw ops with `seq`, `baseHash`, `author`, `byAi`, `at`) |
| PATCH | `/api/envs/:env/drafts/:slug` | `{name}` -> `DraftInfo` |
| DELETE | `/api/envs/:env/drafts/:slug` | discard -> `{discarded: slug}`; the ops stay for the record; the environment and its changelog are untouched. A discarded draft gives its slug up (0.25.1, #56): creating a draft with that slug works and starts empty; the old row is kept as `<slug>~<id>` (still listed with `?status=all`) |
| POST | `/api/envs/:env/drafts/:slug/ops` | `{ops: [{op: 'upsert' \| 'delete', anchor, service?, data?}], author?, byAi?}` (1..5000: a 114-component HLD makes about 2,300) -> 201 `{from, to, counts}`. All or nothing: `422` lists every bad op in `details[i] = {index, code, message}` (`NO_SERVICE` when an op names a component the environment and the draft do not have; `NO_TARGET` a step of an upserted function names no function / egress / resource of its component; `NO_GROUP` a header's `groupPath` is not one of the environment's subsystems; `BAD_KIND` a header kind outside `service, gateway, lambda, infra, client-app`; `INVALID` for a bad anchor, a key that differs from the anchor, a header or item that fails the manifest schema, an `origin` key: "origin is set by import only") |
| DELETE | `/api/envs/:env/drafts/:slug/ops/last` | undo -> `{removed: seq}` |
| DELETE | `/api/envs/:env/drafts/:slug/ops?anchor=` | revert one item -> `{removed: n}` (`svc:<s>` also drops the ops of that component's items) |
| GET | `/api/envs/:env/drafts/:slug/changes` | `{counts, items: [{anchor, change: added \| removed \| changed, label, under?, authors, at, stale}], authors}`. The one source of the counts in the bar, the review list and `DraftInfo`: the children of an added or removed component are listed with `under` and not counted. A component that moves subsystem carries `what: "subsystem: Network → Platform"` (0.28.0) and its two `grp:` boxes are listed under it (`under: svc:<name>`, not counted). `stale`: the item changed in the environment since the draft first touched it (apply overwrites it) |
| POST | `/api/envs/:env/drafts/:slug/apply?dryRun=1` | `{by?}` -> `{applied: true, results, replaced, changelogId, warnings}`; `dryRun` runs it all and rolls back: `{applied: false, dryRun: true, results, replaced}` (each result has its `contract` report) |
| GET | `/api/envs/:env/drafts/:slug/import/preview?source=&anchor=&groupPath=` | what an import would bring: `ImportPreview` (below). Reads only |
| POST | `/api/envs/:env/drafts/:slug/import` | `{source, anchor, groupPath?, author?}` -> 201 `{from, to, counts, preview}` (below) |
| POST | `/api/envs/:env/drafts/:slug/edits` | `{edit: DesignEdit, author?}` -> 201 `{from, to, counts, ops, warnings}` (below) |
| POST | `/api/envs/:env/drafts/:slug/plan/links` | 0.28.0: `{from?: slug, author?}` -> 201 `{from, to, ops, counts, links: {abstract, flow, skipped}, warnings}`: the `links` of the kept plan of `from` (default: this draft) as abstract links of this draft, for a draft imported before 0.28 (its links were kept, not applied). Items the draft already has are skipped; nothing left: `409 NO_CHANGE`; `409 DRAFT_CLOSED`, `ENV_SEALED`; `404` for an unknown `from` or a draft with no kept plan. MCP `apply_plan_links` |
| POST | `/api/envs/:env/drafts/:slug/plan?dryRun=1` | an import plan (below) -> 201 `{ops, counts, warnings, skipped: {links}, links: {abstract, flow, skipped}, questions: {total, blocking}}`; `?dryRun=1` also applies and rolls back and answers 200 with `dryRun: true, results, replaced` |

Ops are whole items: an `upsert` carries the complete item as `data` (a header is `{kind, team?, groupPath?, details?, ...}` without `name`;
a DTO or event DTO is `{content, meta?}`; a schema is its content; a flow is `{name?, description?, steps?, doc?}`), a `delete` carries none.
The last op per item wins; `delete svc:<s>` removes every earlier op of that component. Each op records `baseHash`, a hash of the
environment's item when the draft first touched it. **Newer edit wins**: apply never stops on a conflict; an item that changed in the environment
since is overwritten and listed in `replaced` (`{anchor, baseHash, nowHash, now}`), and in the summary changelog row.
Apply errors: `409 DRAFT_CLOSED` (applied or discarded; two applies at once give one 200 and one of these), `409 DRAFT_EMPTY`
(nothing differs from the environment), `422 INVALID` (a service would have broken references; nothing is written).
Problems a copied component already had (its handlers dangle after a Components copy) do not block a delta that does not cause them.
Apply writes: per touched service one changelog row (kind `full` or `delta`, tagged `draft_id`), the DTOs, event DTOs and schemas, the flow names
(`flow_names`) and the flow description (the description, then the steps as a numbered list), deletes of components, and one summary row
(`service ''`, kind `draft`, `changes {draft, name, counts, replaced}`).

### Reading as a draft

Every GET under `/api/envs/:env/` takes `?draft=<slug>`: the system map, service view, trace, paths, search, health, entry points, flow counts, model,
services (and one service's header and lists), endpoints, DTOs, events, inventory, stores, clients, channels, schemas, descriptions, instances, components,
neighbours. DTOs, event DTOs, schemas and flow texts come from the draft too. An unknown draft is `404`, a closed one `409 DRAFT_CLOSED`, on any of them;
a sealed environment has no drafts (`404`). A read never writes and never touches the environment's cache entry (draft views share the graph LRU, `FLOW_GRAPH_CACHE_MAX`).
Every MCP read tool takes `draft` too.

### Marks

`GET /api/envs/:env/marks?against=baseline|source&draft=<slug>` -> `{against, draft, source, baselineAt, marks, ghosts, counts, refs}` (`refs`: see References below).
`marks` maps an anchor to `{mark: 'new' | 'changed' | 'removed', what?, was?}`: `what` is a phrase (`+1 endpoint · +1 call: auth-svc`, `−2 calls`,
`header: team`, `message UserUpdated: 1 new field`, `message request of in.x: 1 changed field`, `collection users: 1 new field`; at most three, then `+N more`),
`was` the old value (`was string`, `+ quarantined`, `now required`). Field anchors (`...#devices[].certFingerprint`) are included.
`ghosts` describe removed items (`{label, service?, type?}`; a removed subsystem or link keeps its old label or name). `counts` is `{components, endpoints, calls, channels, messages, fields, subsystems, links, relations}` (the last three are 0.28.0, additive) with `new`, `changed`, `removed`
(and `unchanged` where a total exists), computed from the same marks. Rules: the highest level carries the mark (a new component's items and a new field's children carry none);
a changed child marks its parent changed (field -> its message -> its endpoint -> the component; a message's producers; a store's users); items are compared after
dropping noise (provenance, source, `groupPath`, version, `details.doc`, step numbers; key order). A fresh copy has no marks.
`against=baseline` (default) compares with the rows frozen at copy time; `against=source` with the source environment as it is now (rows the design has and the source
does not read as new; a copied component the source no longer has is `new` with `no longer in <source>`; `409 NO_SOURCE` when the source is deleted).
`draft` lays an open draft over the environment first. A sealed environment has no baseline: empty marks, `baselineAt: null`. Marks are memoised and dropped on a write to the environment or its source.
**Subsystems and links (0.28.0).** `grp:<key>` and `link:<id>` are ordinary anchors. A `link:` is New when the design made it (against the baseline and against the source: design lists are never in the source), Changed when it is refined or edited, Removed with a ghost. A `grp:` mark is derived: **New** (`what: whole subsystem new`) when its settings row is new or every component in it is New; **Changed** when a member component is New, Changed or Removed (`3 new components, 2 changed components`), a component moved in or out (`moved in: sxdns` / `moved out: ...`; only where the baseline knew the component's `groupPath`), a link with an end in it is marked (`+1 link`), or its label or icon changed (`label`, `icon`). **Reordering subsystems never marks** (`order` is dropped from the comparison). A roll-up line carries no stored mark: it takes it from the calls under it (`lineMark` in core/subsystem-rollup.ts). `groupPath` itself stays out of the component comparison, with one exception: **with `?draft=`, a component whose `groupPath` subsystem differs from the environment as stored** is marked `svc:<c>` Changed (`subsystem: Platform → Agent`) and its two boxes `moved out: <c>` / `moved in: <c>`. Against the baseline (no draft, e.g. after apply) a move stays silent, because the baseline never stores a `groupPath`. Draft changes list it too (below).
MCP: `get_marks {env, against?, draft?, prefix?, fields?}` (field anchors are left out unless `fields: true`).

### Dry runs into a design

`POST /api/ingest?dryRun=1`, `POST /api/envs/:env/dtos?dryRun=1` and `.../schemas?dryRun=1` (and the MCP `ingest_manifest`, `load_dtos`, `load_schemas` with `dryRun: true`) are allowed into
a design environment: they validate against it, write nothing, and answer with `dryRun: true`. `&draft=<slug>` (dry runs only) checks them against the environment as that open draft would leave it
(`ingest`: all manifests must name the draft's environment).

### Import plan

A plan (docs/DESIGN-IMPORT.md, `planVersion: 1`) becomes ops of a draft: `manifests[]` (inlined, full) -> a header op (`groupPath` included) and one op per item;
`extensions[]` -> one op per upserted item (a `groupPath` that differs from the component's -> a header op); `flows[]` -> `flow:<service>/<ingress>` ops; `dtos[]` and `schemas[]` -> `dto:` / `evt:` / `schema:` ops (schema `source` defaults to `manual`);
`environment.groups` the environment lacks become `subsystem` ops (`grp:<key>`, appended after its own, with a valid `icon`; a different label for a known key is a warning, the environment's is kept);
`links[]` (0.28.0) become abstract links `link:<id ?? slug(name)>` `{name, from, to, mode?, transport?, description?, doc?}` when both ends are `grp:` / `svc:` / `ing:` (or `egr:` as `from`) and there is no `type`; a typed link whose ends are flows (`flow:<s>/<i>` or `{service, ingress}`) becomes a relation `rel:<id>` (0.28.2, see "Flow relations"; counted in `links.flow`); a link that fails `checkLink` is a warning (`links[i]: ...: skipped`) and is skipped, so a plan with one bad link still imports; a typed link with `flow:` ends is skipped with the warning "flow relations land in 0.28.2". `links: {abstract, flow, skipped}` counts them and **`skipped.links` now counts only the links not applied** (it used to count all of them);
**a component has ONE subsystem (0.28.0):** a manifest or extension carrying `alsoIn` or `details.alsoIn`, or two different `groupPath` subsystems for one component in a plan, is refused with `422 TWO_GROUPS` (the message names the component and says to pick one); `questions` with `blocking: true` are reported in `questions.blocking`, not enforced. The plan itself (without `manifests`) is stored on the draft.
`transport: "other"` with `details.transport: "undecided"` (the earlier encoding) is stored as `transport: "undecided"`, with a warning. Errors (nothing is added): `422 PLAN_VERSION`, `PLAN_ENV` (the plan names another environment),
`PLAN_EXISTS` (a manifest for a component the environment or draft has: make it an extension), `PLAN_NO_SERVICE` (an extension of a component that is not there), `TWO_GROUPS`, `INVALID` (details: `[{path, message}]`, paths like `manifests[1].ingress[0].transport`).
MCP: `apply_import_plan {env, draft, plan, dryRun?}`.

### Import into a draft (0.25.0)

`ing:<service>/<id>` or `svc:<service>` of another environment (`source`: prod, or another design) comes into the draft **one level, never recursively**.
- **An endpoint** (`ing:`): the endpoint, its DTOs, its handler (and event handlers, middleware) and the functions it calls inside its component, the egress and stores those functions use,
  the schemas of those stores, event DTOs, and, for each call, the channels and bindings between it and its consumers. A channel or binding whose owner is not in the design goes under an
  `infra` component named `<source>-infra` (a binding's id gets the declaring component as prefix, as a Components copy writes them). A consumer in the same component comes along with its closure;
  a consumer in another component stays a **reference** and is listed (`references`: `state` `designed` when the design has its handler, `reference` when it has the endpoint only, `new-reference` when it is absent:
  its header, endpoint and DTOs come along as a stub, no functions) so the next level is an explicit choice.
- **A component** (`svc:`): its header, endpoints, calls, stores, channels, bindings, DTOs, schemas and event DTOs; no functions and nothing downstream: its endpoints become references.
- Rows already in the design are never imported again (the design's version is kept even if edited; `alreadyHere[].differs` says so). Nothing left: `409 NOTHING_TO_IMPORT`.
- A component new to the design gets the source's `groupPath` when the design has that subsystem, else none; `groupPath` in the request overrides it (`422 NO_GROUP` if it is not a subsystem; `''` = none).

`ImportPreview` = `{source, anchor, level: 'endpoint' | 'component', total, counts: {headers, ingress, functions, egress, resources, channels, bindings, dtos, messages, schemas}, summary: {handler?, inside, calls: [{anchor, label}], stores: [{key, access?}]}, items: [{anchor, why, label}], alreadyHere: [{anchor, label, differs}], references: [{service, ingress, bindKey, label, state}], warnings}`;
`total` is the number of ops the import appends. Errors: `404` unknown source or `NO_ITEM`, `400` `BAD_ANCHOR` or source = the environment, `409` `NOTHING_TO_IMPORT`, `ENV_SEALED`, `DRAFT_CLOSED`, `422 NO_GROUP`.
**Imported is not new**: each op records `origin {env, version}` (the source and its component's version then); until the draft is applied that is the item's baseline (marks read it from the ops, so imported items get no New mark, undo / revert / deleting the component leave no trace, and an item imported and deleted again is no Removed mark).
Apply copies it into `baseline_items` (summary changelog `changes.imported`). Editing an imported item in the same draft shows it Changed. `against=source` then shows drift when the source moves.
MCP: `import_preview {env, draft, source, anchor, groupPath?}` (read) and `import_into_draft` (an AI edit).

### Edits (0.25.0)

`POST /api/envs/:env/drafts/:slug/edits` takes one form-shaped edit and appends the whole-item ops that make it (validated all or nothing, like `ops`). The UI forms, MCP `edit_design` and the preview build the same ops from the same code.
`DesignEdit` is one of:
- `{kind: 'component', name, serviceKind: 'service' | 'gateway' | 'lambda' | 'infra' | 'client-app', groupPath?, team?, description?, links?, runtime?}`: a header (`name`: lowercase letters, digits, `-`; an existing header keeps its other fields; `''` clears one). No rename: delete and add.
- `{kind: 'endpoint', service, id?, transport, bindKey?, handler?, entryPoint? (true: always an entry point; false: never; null: back to the default rule), events?: [{type, handler?}], description?, links?}`: an endpoint (id defaults to `in.<last word of the bind key>`, handler to `<id>.handle`, created as an empty function when absent, so a design endpoint is never a reference; transport `undecided` fills `tbd:<service>/<name>`).
- `{kind: 'function', service, id, links?}`: the links of an existing function.
- `{kind: 'call', from: {service, fn}, before?, to, edit?, mode?, operation?, condition?, event?}`: an arrow that traces. `to` is `{service, ingress}` (an endpoint of the design), `{endpoint: <the endpoint form>}` (created with it) or `{bindKey, transport}` (not designed yet: a dangling call). The ops: an egress `out.<target>.<operation or endpoint id>` of the caller (mode defaults: async for sns, sqs, eventbridge, event and amqp publishes, sync for http, rpc, grpc, `amqp-rpc:` and undecided) and a step (`note`: the step's own text, shown as the arrow's note) inserted in the function before step `before` (default last; the function is created when absent; steps are renumbered). `edit: {egress, seq}` replaces that call (the egress changes in place unless another step shares it, then a new egress is made).
- `{kind: 'delete-call', service, fn, seq}`: the step goes, and its egress when nothing else of the component uses it.
- `{kind: 'flow', service, ingress, name?, description?, links?, entryPoint? (true | false | null), order?: {fn, seqs}}`: the flow's name and description (a `flow:` op; `''` clears the name), the endpoint's entry-point flag, the order of one function's steps (`seqs` lists every step number once, else `BAD_ORDER`).
- `{kind: 'dto', service, ingress, role, status?, content}`, `{kind: 'event-dto', type, content}`, `{kind: 'delete', anchor}` (`svc:`, `ing:` with its DTOs and flow text, `dto:`, `evt:`, and from 0.28.0 `grp:`, `link:`, `rel:`).
- 0.30.2 `about?` (Markdown-lite, at most 20 000 characters, `''` clears) on `{kind: 'component'}` and `about?` (`''` or `null` clears) on `{kind: 'subsystem'}`; a longer text is `422 INVALID`, `field: 'about'`. The manifest's `service.about` and the groups' `about` are read back with the header and the subsystems.
- 0.28.0 `{kind: 'subsystem', key, label?, icon?, order?}`: the settings of a subsystem (`grp:<key>`). The key never changes (the label is the rename); a new key needs a label (`INVALID`, field `label`); `icon: null` clears it; `order: n` moves it to position n and writes only the rows whose position changes.
- 0.28.0 `{kind: 'abstract-link', id?, name, from, to, mode?, transport?, description?, refinedBy?: null}`: an abstract link (`link:<id>`; the id defaults to the slug of the name, made unique). An existing link keeps its `doc` and `refinedBy`; `refinedBy: null` puts it back at subsystem level.
- 0.28.2 `{kind: 'flow-relation', from: {service, ingress}, to: {service, ingress}, type, note?, id?}`: a typed relation between two flows (`rel:<id>`; see "Flow relations"). `id` is the relation being changed: a new type or end moves it (the old row is deleted). Errors `BAD_TYPE` (field `type`), `NO_FLOW` (`from` / `to`), `SAME_FLOW`, `NO_ITEM`. `{kind: 'delete', anchor: 'rel:<id>'}` removes one; deleting a component or an endpoint also deletes the relations that name it, in the same request.
- 0.28.0 `{kind: 'refine-link', id, from?, to?, use?: {service, egress}, call?: <the call form without kind>}`: refine a link. `from` / `to` narrow an end to an anchor inside it (`NOT_INSIDE`; a missing end accepts any). `use` points at an existing call that starts inside `from` and reaches `to`: the ends become that egress and its endpoint and `refinedBy` is set. `call` makes a new call in the same request (the call builder's ops, then the link upsert); a call whose `to` is `{bindKey, transport}` (no endpoint yet) is `REFINE_DANGLING`. `use` and `call` together are `INVALID`.
- **A component edit with a new `groupPath` moves the component**: a component belongs to exactly one subsystem, the old value is replaced.
Errors (`422`, `error.code`, `error.details.field` for a form field): `BAD_NAME`, `BAD_KIND`, `NO_GROUP`, `NO_SERVICE`, `NO_TARGET`, `NO_ITEM`, `NO_STEP`, `BAD_ORDER`, `BAD_ANCHOR`, `NO_CHANGE`, `INVALID`, and (0.28.0) `BAD_KEY`, `BAD_ICON`, `GROUP_IN_USE` (a deleted subsystem is still named by a component's `groupPath` or a link end; checked over the whole request, so one that moves the components passes), `TWO_GROUPS` (one request gives a component two subsystems, or an `alsoIn`), `NO_END`, `BAD_END` (a `to` of kind `egr:`...), `SAME_END`, `NOT_INSIDE`, `REFINE_DANGLING`, plus the codes of `ops`. `NO_GROUP`: the subsystems are the `subsystem` rows of the request's result, so one added earlier in the same request counts; a `groupPath` whose first segment is a subsystem is accepted.
The `description` of one call is not stored (callee descriptions are another store); the answer says so in `warnings`.
MCP: `edit_design {env, draft, edit}` (an AI edit).

`GET /api/envs/:env/call?service=&egress=&draft=` -> `{egress: {service, id, bindKey, transport, mode?}, steps: [{fn, seq, operation?}], targets: [{service, ingress, bindKey, reference?}]}`: what the call form reads. `targets[i].reference` (`{service, ingress, bindKey, source}`) is present when that endpoint is a reference: editing the call changes the call only. MCP: `get_call`.

### Mermaid (0.27.4)

A flow as a Mermaid `sequenceDiagram`, and a sequence diagram as a flow in a draft.

**Export**, any environment (sealed ones and the static preview too): `GET /api/envs/:env/flows/mermaid?service=&ingress=&draft=` answers `text/plain`. MCP `export_mermaid {env, service, ingress, draft?}` -> `{text}`. It is the flow's full trace:
- `%% Flow: <name> (<service> · <ingress>)`, `%% Description: ...` lines, `sequenceDiagram`, `title <flow name>` (only when the flow has a name).
- `participant <id> as <label>` per lifeline, in lifeline order (ids are letters, digits and `_`). The label is the component name; a channel or data store is labelled by its key (`sns:order-events`, `postgres:users-db/users`); the entry client is an `actor`. Calls inside one component are left out.
- `A->>B: label` a sync call, followed by its `B-->>A: return` when the callee is a component; `A-)B: label` an async publish or delivery. An http call reads `METHOD /path`, anything else as the trace labels it.
- (0.33.1) `%% flow: <name>` and `%% link: <label> <url>` lines (the flow's name and links), `%% real: <bind key>` before a message that has one, frames as nested `alt`/`else`, `opt`, `loop`, `par`/`and`, `critical`/`option`, `break` ... `end`, `rect rgb(...)` around steps marked `changed` (soft yellow) or `new` (green, `rgb(214, 245, 214)`; any green reads back as `new`), a leaf step with `over` as `Note over A,B: text`, an internal step as `A->>A: text`, the step's `returns.label` on the return line (`return` when it has none). The import reads all of it back: CHANGELOG 0.33.1.
- (0.33.2, #81) **`returns: {label, detail?}`** on a step (manifest and draft function steps, plans, the `call` edit form, `edit_design` `{kind: 'call', returns}`, `null` clears): the label (1 to 80 characters, one line of plain text) is drawn on the dashed return arrow of a sync call (without it the arrow says `return`); the detail (plain text, up to 500) shows in the step panel ("Returns") and as the arrow's tooltip. The trace message carries `returns`; `GET .../call` lists it on each step. A bad value is a `422` (`returns.label is 1 to 80 characters`).
- `Note over A,B: text` is the step description (human, else AI, else the step's own note). `;` and `#` are written as `#59;` and `#35;`.

**Import**, design environments only, always into an open draft. A sealed environment answers `409 ENV_SEALED`.
- `POST /api/envs/:env/drafts/:slug/mermaid/preview {text, matches?, groupPath?}` writes nothing and answers `{title, description, summary {participants, actors, messages, returns, notes, groups, marked, links, warnings}, participants: [{id, label, actor, match, how, candidates, source?, note?, choice, createName}], matches, components, source, creates, imports: [{component, source, counts, total}], counts {components, endpoints, calls, notes, reused}, undecided, flow {service, ingress, name?}, edits: [DesignEdit], ops, warnings: [{line?, text}]}`.
- `POST /api/envs/:env/drafts/:slug/mermaid {text, matches?, groupPath?, author?}` (201) appends the ops in one transaction, all or nothing, as one **batch**: the same answer plus `batch` (8 hex characters; `null` and `added: 0` when nothing is new), `added`, `from`, `to`, `draftCounts`. Every op carries `origin {kind: 'mermaid', batch}` (an op copied from the source through `fromSource` carries `{env, version, batch}`). `422 NO_MESSAGES` when no message can start a flow.
- `DELETE /api/envs/:env/drafts/:slug/mermaid/:batch` is **Undo import**: it removes the batch's ops (`{batch, removed}`). It answers `409 DEPENDENT_OPS` with `error.details.blocking: [{seq, op, anchor, author}]` when a later op of the draft touches an item the batch made, an item of a component it created, or calls one of its new endpoints; undo or revert those first. `404` for an unknown batch.
- MCP `import_mermaid {env, draft, text, matches?, groupPath?, dryRun?}`: `dryRun: true` is the preview (the proposed `matches` and `participants` are the table; send corrected `matches` back), otherwise the import (an AI edit).

Parsing (`core/mermaid-parse.ts`) never throws. It reads `participant` / `actor` with `as`, the arrows `->> -->> -) --) -x --x -> -->`, `+` / `-` on arrows, `activate` / `deactivate`, `Note`, the blocks `alt opt loop par critical break` with `else` / `and` / `option`, `autonumber`, `title`, `%%` comments (`%% Description:` is the flow's description), `<br/>` and `#59;` entities. `rect` and `box` are ignored with a warning; any other line is skipped with `{line, text}` in `warnings`.

Matching of a participant to a component, in order: (1) its id, or its `as` label, equals a name; (2) normalized equal (case, `-` `_` space, a trailing `-svc` / `service`); (3) a close spelling (Levenshtein 2 or less, only when exactly one component is that close; needs 4 or more letters); (4) a name only the source environment has (`how: 'in-prod'`: **never imported by itself**, the default is `create`). `how` is `exact`, `alias`, `normalized`, `similar`, `in-prod`, `actor`, `infra` (a label that is a key, `sns:q` or `users-db.users`: a channel or store) or `none`. `matches` maps a participant id to a **choice**: a component name (or `{component}`), `{create: true, name?}`, `{fromSource: true}` (copy that component from the source, one level, the rules of `import` above, in the same batch), `{client: true}` (an actor that is the entry client, not a component) or `{skip: true}` (its messages are left out). Anything not given takes its default. `groupPath` is the subsystem of the components that are created or copied.

Mapping (`core/mermaid-edits.ts`), as the `DesignEdit` kinds above applied in order, each one seeing what the last made:
- A created participant is a `component` (service). Only new things are written: a component, an endpoint (same bind key) or a call (same function, bind key and occurrence) that is already there is reused, so importing the same text again adds nothing (`counts.reused`).
- The first message of the diagram starts the flow. From a client it is the entry endpoint of the callee (`entryPoint: true`); from a component, that component gets an `undecided` entry endpoint `tbd:<component>/<title>` and the message is its first call.
- A message `METHOD /path` is an http endpoint `http:METHOD <callee>/<path>`; any other label is an `undecided` endpoint `tbd:<callee>/<label>` with the label as the operation (`undecided` lists them). `-)` messages are calls with `mode: 'async'`. A call goes into the function the caller is inside of: the handler of the endpoint it was last called through. Returns (`-->>`) add nothing.
- Step text (`note`): the `Note` lines after the message, the part after `: ` of a label that is not `METHOD /path` (`Score: how risky` -> operation `Score`, note `how risky`), and the innermost block as a prefix (`[alt: allowed] ...`). The title is the flow's name, `%% Description:` its description.
- Warnings: skipped lines, a call into a client or inside one component, messages of skipped lifelines, and a caller whose handler is a reference (its behaviour is in another environment): its calls go into a new function of that name.

### References (0.25.0)

A **reference** is an endpoint of a design environment that came from another environment (a baseline row, or an import op of the draft being read) whose behaviour is not in the design: it names a handler (its own or an event consumer's) and none of those is a function of its component.
A Components copy makes every copied endpoint a reference, a Full copy none; an endpoint the design made with a dangling handler is "not designed yet", not a reference. Sealed environments have none.
- **Marks** (`GET /marks`) gain `refs`: `{endpoints: {'ing:<s>/<id>': {service, ingress, bindKey, source}}, components: {'svc:<s>': {refs, endpoints}}, origins: {'ing:<s>/<id>': {from, at, imported, inDraft?}}}`; `origins` are endpoints that came with their behaviour (`imported`: taken after the environment was copied, or its handler was imported; `inDraft`: by an import op of the draft being read). A sealed environment answers empty maps.
- **Traces** of a design (`GET /trace`, MCP `trace_flow`): a message into a reference carries `reference: {anchor, source}`; `partial: {steps: [{message, anchor, service, ingress, label, source}]}` lists the first message into each reference (`message` = 0-based index in `messages`), absent when the flow reaches none; service participants carry `serviceKind`. A sealed trace is unchanged.
- **Entry points** (`GET /entry-points`, MCP `list_entry_points`): `reference: true` when the entry itself is a reference, `partial: n` when its flow reaches n references (design environments only), `marked: n` (0.32.2, #75) when its flow runs n steps carrying a `mark` (design environments only; "Changed only" lists them). Every environment: `name` (the flow's name) and `summary` (first 140 characters of the human description) where set.
- **`GET /trace` of an entry with no handler** (0.25.1, #59): an ingress that names no handler for the requested start (an event type the consumer lists no handler for) answers `200` with an empty flow: `noHandler: true`, `participants` the caller and the service, `messages: []`, `start.fn` empty. It can be described, named and linked like any flow; consumers must not assume a step exists. An unknown ingress is still `404`; a handler id that names no function is the `409 NO_HANDLER` below only when the endpoint came from a source environment (a reference or a copied endpoint); an endpoint made in the environment itself, or in a sealed one, answers the empty flow. `GET /flow-names` also lists a flow that has links but no name (`name: null`).
- **`GET /trace` on a reference**: `409 NO_HANDLER`, `details {source, service, ingress, reference, anchor}`, message "This endpoint is a reference: its behaviour lives in <source>".

### Flow names (0.25.0)

A flow (an entry point) can have a name, shown wherever flows are listed. An annotation like descriptions: any environment, no draft.
`GET /api/envs/:env/flow-names[?draft=]` -> `[{service, ingress, name, author, updatedAt}]` (with a draft its `flow:` ops' names win); `PUT /api/envs/:env/flow-names` `{service, ingress, name, author?}` -> `{service, ingress, name | null}` (`name` trimmed, at most 200, `''` removes; `422 NO_INGRESS` for an unknown endpoint, `404` for an unknown environment).
In a design with an open draft a rename can instead be `edits {kind: 'flow', name}` (applied with the draft). Names are in `entry-points`, `flows/counts`, `search` (which also matches them) and the `start` of a trace, with or without `?draft=` (Fix #52); a draft read keeps the names stored in the database.
MCP: `get_flow_names {env, draft?}`, `set_flow_name {env, service, ingress, name, draft?}` (with `draft`: a flow op, an AI edit).

### `undecided` and `details`

`transport: "undecided"` (schema, `ingress` and `egress`) is for designs: the transport of a call or endpoint is not chosen yet. It resolves by bind key like any other transport (use a `tbd:<callee>/<operation>` key on both ends), reads as sync and unicast,
counts as linked in link health when the keys match, and shows as a dangling call when the other end is missing. Harvesters never send it. `details` (a free object) is also accepted on a service header and on a function, for the `details.doc` provenance of an import.

## Subsystems (0.28.0)

The **subsystem level** is the first segment of a component's `groupPath` (`platform/identity` -> `platform`). **A component belongs to exactly one subsystem** (maintainer decision: no `alsoIn`).
Settings (label, icon, order) are `subsystem` rows (`grp:<path>`): stored in `envs.groups` (`[{key, label, icon?}]` in display order), so `GET /api/envs/meta` already served them. A top segment with no
settings row is a **derived** subsystem, labelled with its key; a subsystem named by no component and no row is absent. Icons: `platform agent network cloud shield database`.
Abstract links are design content: written through drafts in design environments (a sealed environment has none); the subsystem level itself is a read-only view that works in every environment with `groupPath`s.

| Method | Path | Body / query -> result |
|---|---|---|
| GET | `/api/envs/:env/subsystems` | `{levels, subsystems: [{key, label, icon, about?, order, derived, components: [{name, kind}]}], notSet: [component]}` (settings in order, then derived ones alphabetically) |
| GET | `/api/envs/:env/views/subsystems` | `SubsystemMap`: `{boxes, lines, abstract, notSet}` (below) |
| GET | `/api/envs/:env/abstract-links?subsystem=` | `AbstractView[]`; `subsystem` keeps links with an end in it |
| GET | `/api/envs/:env/abstract-links/:id` | `AbstractView & {suggestions}`; `404` for an unknown id |
| PUT | `/api/envs/:env/subsystems` | sealed only: `{subsystems: [{key, label, icon?, about?}]}` in display order (`about` left out keeps the stored text, `''` / `null` clears it) -> `{subsystems}`; a design is `409 USE_DRAFT` (edit it through a draft); `422` for a bad key, label (1..80), icon or a duplicate. Unknown keys are allowed: they label future groupPaths |
| PUT | `/api/envs/:env/levels` | `{levels: [..]}` (1..4 names of at most 40 characters, outermost first) on any environment -> `{levels}`; `422` otherwise |
| POST | `/api/envs/:env/drafts/:slug/plan/links` | see Draft routes |

Every GET takes `?draft=<slug>`. In a design the subsystem rows of a draft come from its overlay, so a subsystem or link added in the draft shows at once.

**`SubsystemMap`.** `boxes[]`: `{key, label, icon, order, derived, components, internal, out, in, dangling}` in settings order, then derived ones, then the **Not set** box (`key: ''`), which exists only when a component without a subsystem takes part in a call.
`lines[]`: every call between two components of different subsystems, rolled up by (from, to, transport, mode): `{id: '<from>><to>|<transport>|<mode>', from, to, transport, mode, count, calls: [{from: {service, egress}, to: {service, ingress}, bindKey, via}], links: [link ids refined into it]}`.
Transport: `rpc` for an `amqp-rpc:` bind key, else the call's; mode: the call's `mode`, else `async` when it goes through a topic or queue, else `sync`. **Each call is counted once**, by the subsystem of each side; calls inside one subsystem only add to `internal`;
an egress that reaches nothing adds to `dangling`. On the 100-service mock this is 26 boxes and 799 lines in about 20 ms (the system graph takes 450 ms: it is not used).

**`AbstractView`**: `{id, name, from, to, mode?, transport?, description?, state, problems, refinedBy, line?}`. An end is `{anchor, level: subsystem | component | endpoint, subsystem, service?, item?, missing?}`.
`from` is `grp:` / `svc:` / `egr:` / `ing:`, `to` is `grp:` / `svc:` / `ing:`. States: **abstract** (both ends are subsystems), **partial** (an end is narrowed), **ready** (both ends are endpoints, no call realises it),
**refined** (`refinedBy` is non-empty and every refining call exists and reaches the `to` scope; `line` is the roll-up line the call counts in, and the link is listed in that line's `links`), **broken** (an end or a refining call is gone: `problems` says which; it shows as abstract work again).
A refined link is **kept, not deleted**: its name, description and provenance stay, it folds into its line, and it turns `broken` if the call goes away. `suggestions` (at most 5): `{use?: {service, egress}, from?, to?, reason}`:
existing calls from the `from` scope into the `to` scope (same mode first, then the same transport), then components of an open end that make no such call yet (narrow with `refine-link` `from` / `to`).

**MCP (0.28.0).** Reads: `get_subsystems {env, draft?}`, `get_subsystem_map {env, draft?}`, `list_abstract_links {env, draft?, subsystem?}`, `suggest_refinements {env, id, draft?}`. Writes: `edit_design` (the new kinds above), `apply_plan_links {env, draft, from?}`,
`set_subsystem_settings {env, subsystems, draft?}` (sealed: at once; a design needs `draft` and the changes become `subsystem` ops; nothing is deleted), `set_levels {env, levels}`.
Harvester ingest into a design stays `409 ENV_DESIGN`. Migration 012 (`abstract_links`, `flow_relations`, `envs.baseline_groups`; additive, the database is backed up to `<db>.pre-012.bak` first).

### Info pane reads (0.33.0)
| Method + path | |
|---|---|
| `GET /api/envs/:env/open-questions[?draft=]` | `{count, questions: [{kind: 'component' \| 'subsystem', id (component name or subsystem key), label, subsystem, text, index (position among that item's questions), line (0-based line in the about)}]}`: every list item under a `## Open questions` heading in the `about` of the components and subsystems, subsystems first (settings order), then components by name. Read as a draft would leave it with `?draft=`. MCP `list_open_questions {env, draft?}` |
| `GET /api/envs/:env/flows-through?service=a,b[&draft=]` | the entry points (rows of `entry-points`) whose flows run through any of those components, or start in one; `[]` with no `service` |

`owners` (0.33.0): `service.owners` of a manifest, `extensions[].owners` / `manifests[].service.owners` / `environment.groups[].owners` of a plan, `owners` on `{kind: 'component'}` and `{kind: 'subsystem'}` edits, on `subsystems[]` of the sealed `PUT` and on `create_env` / `POST /api/envs` `groups[]` take a list of people: a user id, a name, or `{name?, externalSource, externalId}`; the server matches them to users (external id, then exact name or alias, else a new user) and stores and returns **user ids** (`service.owners`, `subsystems[].owners`, `boxes[].owners`). Left out keeps, `[]` / `null` clears, more than 20 or a bad entry is `422` (`owners[i]: ...`). `@{Display Name}` in an `about` is written as `@[userId]` when that user exists.

## Flow relations (0.28.2, #50)

Typed relations between two flows of one design environment: `contradicts`, `variant-of`, `supersedes`, `same-topic`, with an optional `note` (up to 1000 characters). A relation is a design item (`rel:<id>`, row list `flowrel`), so it is written through a draft like everything else in a design, and applied to `flow_relations` with the draft. Sealed environments have none (reads answer `[]`, writes are refused as they are for any design item).
- **Ends.** Both are `flow:<component>/<endpoint>` anchors of endpoints that exist in the design (the draft's overlay counts) and are not marked `entryPoint: false`; the same flow twice is `SAME_FLOW`. `contradicts` and `same-topic` are symmetric: stored with the smaller anchor first, so the pair has one id whichever side wrote it. `variant-of` and `supersedes` read from `from`: "`from` is a variant of `to`", "`from` supersedes `to`". The id is `'r' + hash(from|to|type)`: the same pair and type is the same relation (writing it again changes its note).
- `GET /api/envs/:env/flow-relations?service=&ingress=&type=&draft=` -> `[{id, type, from: {service, ingress}, to, note?, other, direction, phrase}]`. With `service` and `ingress` (both or neither, else `422`): the relations that name that flow at either end, and `other`, `direction` ('out' when this flow is `from`) and `phrase` are written for that end: "supersedes" / "is superseded by", "is a variant of" / "has a variant", "contradicts", "same topic as". Without them: every relation of the environment, read from the `from` end. `type` filters (`422` for an unknown one). `?draft=` reads as the draft would leave them (`404` for an unknown draft). MCP: `list_flow_relations {env, service?, ingress?, type?, draft?}`.
- **Write.** `edit_design` / `POST .../edits` `{kind: 'flow-relation', from, to, type, note?, id?}` and `{kind: 'delete', anchor: 'rel:<id>'}` (see Edits above), or raw `rel:<id>` ops (`{from, to, type, note?}`; the id must be the one the pair and type give, `BAD_ID` otherwise). Plan `links[]` with a `type` and flow ends are applied by the plan import, and `POST .../drafts/:slug/plan/links` (MCP `apply_plan_links`) also adds them to a draft imported before 0.28.2.
- **Marks.** `rel:<id>` is New (not in the baseline), Changed (its type or note differs from the baseline) or Removed; `counts.relations` counts them. A Full copy of a design carries its relations; Components and Blank copies do not. Deleting an environment deletes them.

## Map reads

Collections per service: `functions`, `ingress`, `egress`, `resources`, `channels`, `bindings`. Entity key is `id` (or `bindKey` for channels; keys may contain `/` and `:`).

| Method | Path |
|---|---|
| GET | `/api/envs/:env/services` |
| GET | `/api/envs/:env/services/:service` |
| GET | `/api/envs/:env/services/:service/:collection` |
| GET | `/api/envs/:env/services/:service/:collection/:key` |

With `?draft=` they read the overlay. **Removed in 0.25.0: edit a design through a draft.** The routes that wrote here (`POST/PATCH/DELETE` on services, `POST/PUT/DELETE` on collections) are gone; sealed environments are filled by ingest only. `GET /api/envs` is listed under Environments above.

## Queries

| Path | Returns |
|---|---|
| `GET /api/envs/:env/views/system` | nodes (a service node carries `runtime` when its header has `details.runtime`, 0.26.0), edges (with channels), collapsedEdges (service to service). Each edge lists its `endpoints`; those carry `egress` / `ingress` ids (within the edge's from / to service) and, through a subscription, its event `filter` |
| `GET /api/envs/:env/views/service/:service` | ingress with callers, egress with targets, resources, functions. Each egress has `via` (wrapper hops, caller to SDK call, each with a code `link`) and `callSites[]` (`file`, `line`, `function`, `link`, `via`), read from the egress fields or `details.via` / `details.callSites`. A wrapper is display data: never a producer, node or edge. Each ingress has `via` (the hops that resolved its handler, kind `registration` / `bind`; from `via` or `details.handlerVia`), and each function its `unresolved` gaps |
| `GET /api/envs/:env/entry-points` | where flows start |
| `GET /api/envs/:env/flows/counts` | per entry point: distinct components its full flow reaches (`total`, `services`, `topics`, `queues`, `buses`, `stores`, `otherChannels`); reachability, no trace; cached per graph |
| `GET /api/envs/:env/trace?service=&ingress=\|fn=&scope=intra\|full&maxDepth=&maxMessages=&frontier=1` | participants and ordered messages; an egress message carries `via` (the wrapper hops of that call, for the call site when the egress lists one for the calling function); a message that reaches an ingress carries `handlerVia` (its handler-resolution hops). `code` also maps `step:<service>:<fn>#<seq>` to the link of a step's `source`. Messages of steps that are mutually exclusive alternatives carry `alt: {group, branch, of}` (see below) |
| `GET /api/envs/:env/paths?from=&to=&limit=` | service-level paths, including through queues |
| `GET /api/envs/:env/search?q=&limit=` | services, functions, endpoints, channels, resources |
| `GET /api/envs/:env/health` | link-health totals, per-service numbers, broken items (assumed values (#47, 0.25.2) are informational and apart: `items.assumed` [{service, kind, id, fn?, what, detail?, value, basis, reason}], `totals.assumed`, `assumed` and `assumedByBasis` per service, `assumedByBasis` for the environment; never in `coverage` or in the problem counts; including the event checks: `unhandledEvents`, `undeliveredEvents`, `neverArrives`, `declaredNotSeen`, `subscriptionConflicts`; the store checks `multipleWriters`, `unusedStores`; and what harvesters report: `unresolved` (on ingress, egress, functions (`what: caller`), steps and resources (`what: instance`: DB instance id unknown, the store key is kept; `what: detail`: a field named in `detail` could not be read, also on resource steps, #45; kept in the data, the instance page and the step panel, but left out of health, its lists and counts since 0.19.1); with reason, candidates and their possible matches), `mixedCommits`, `drift`) |
| `GET /api/envs/:env/health/history?service=` | health per service version |
| `GET /api/envs/:env/changelog?service=&limit=&before=` | changes, newest first |
| `GET /api/envs/:env/model` | the raw model (for clients running `core/` themselves) |
| `GET /api/version` | running app version |

## Endpoint info and DTOs

An ingress endpoint can carry DTO JSON, stored under role `request` or `response`. Which roles an
endpoint takes, and what they are called, depends on the endpoint (`core/endpoint-info.ts` `dtoSlots`).
DTO content may be example JSON or a JSON Schema (`$schema`, or `type: object` with `properties`); the UI
shows a schema as a field table (local `$ref` into `$defs`/`definitions` resolved) with a toggle to the raw JSON.

| Endpoint | Roles (label) |
|---|---|
| sqs, sns, amqp | `request` (Message) |
| event | `request` (Event) |
| http POST / PUT / PATCH | `request` (Request body), `response` (Response body) |
| http GET / DELETE / HEAD / OPTIONS | `request` (Query / path params: `{params, query}`), `response` (Response body) |
| grpc | `request` (Request message), `response` (Response message) |
| socket | `request` (Event payload) |
| cron | none |

A response can also be stored per status, for the error cases: `status` is an HTTP status (`404`), a
class (`4xx`) or `default`; leave it out for the success response. Only `response` DTOs take a status
(a `request` with one is a 400). `slots` lists the success response first, then one slot per stored
status (`{role: 'response', status: '404', label: 'Response 404', dto}`), codes before classes, `default` last.

Every DTO can also carry `meta`, where it came from, all fields optional:
`{source: {repo, ref, file, line}, provenance, incomplete}`. `provenance` is free text (for example
`openapi`, `derived`); `incomplete` is the reason the DTO is partial (or `true`). Reads return `meta`
and, on endpoint info, `link`: the web URL of `source` (the service's repo and commit fill in what
`source` leaves out). The UI shows it as a source line on the DTO card.

Writing a role the endpoint does not take is a 400. DTOs are loaded through
these routes, not the manifest, so re-harvesting a service keeps them; deleting the service removes
them. Writes check that the endpoint exists (404) and the role is valid (400). The ingress id is the
last path segment and may contain `/`.

| Method and path | What |
|---|---|
| `GET /api/envs/:env/endpoints/:service/:ingress` | `{ingress, method, handler, source: {repo, url, ref, file, line}, slots: [{role, label, dto, stale}], note}`; `source.url` opens the handler's file and line at the harvested commit; `stale` means the DTO was loaded before the service was last harvested |
| `GET /api/envs/:env/dtos?service=&ingress=` | stored DTOs `{service, ingress, role, status, content, meta, updatedAt}` |
| `POST /api/envs/:env/dtos` | bulk load `{dtos: [{service, ingress, role, status?, content, meta?}]}`, all or nothing (201) |
| `PUT /api/envs/:env/dtos/:service/:role/:ingress` | body is the DTO JSON; replaces an existing one. Query `status=404` for an error response, `meta=<url-encoded JSON>` for provenance (use the bulk load for large meta) |
| `DELETE /api/envs/:env/dtos/:service/:role/:ingress` | remove one; add `?status=404` for an error response |

An ingress that lists `events` takes no endpoint DTO: its messages are described per event type.

## Event types

| Method and path | What |
|---|---|
| `GET /api/envs/:env/events` | every event type with producers, consumers (after subscription filters) and `hasDto` |
| `GET /api/envs/:env/events/:type` | one event type with its Message DTO |
| `PUT /api/envs/:env/event-dtos/:type` | body is the message JSON (query `meta=` as above); replaces an existing one. Patterns (`*`) are a 400 |
| `DELETE /api/envs/:env/event-dtos/:type` | remove it |

`POST /api/envs/:env/dtos` also takes event DTOs as `{event, content, meta?}` items, mixed with endpoint
DTOs. `GET .../endpoints/:service/:ingress` returns `events`: one row per event type at that
consumer with `handler`, `pattern` (the glob that matched), `status` (`ok`, `unhandled`, `never`,
`declared-only`), `producers` (`derived`, `declared`, `harvested`), the handler's `source` link
and the `dto`. `GET .../trace` takes `event` to start from that event type's handler, and `expand` (comma-separated services) to draw those services function by function. Steps a harvester marked `origin: "frontier"` are folded into one message per function (`kind: "frontier"`, label "frontier: N steps", `frontierSteps: N`) that does not count toward `maxMessages`; `frontier=1` (MCP `frontier: true`) shows them instead, each tagged `origin: "frontier"`. A step with no target that the harvester classified (`kind: "leaf"`, or a `call` with an `operation` or `note`) is a `kind: "leaf"` self-message on its function, not a gap, and is not counted unresolved. A resource step with `unresolved` what=detail entries has `unknown: [{field, reason}]` on its message (keyTemplate, dbIndex, ttlSeconds). A resource message also has `storeKind` (the resource's `kind`, e.g. `mongodb`) and `access` (`read`, `write`, `read_write` or `unknown`: the step's `access`, else from its operation); its `label` is the harvester's `operation` as given, or `use` when it gave none (0.27.1). Each message carries `seq`, `target` {service, ingress, fn}, `store` or `calls`, and the trace has `code`: the source link of every function on it.

Example: `samples/dtos/prod.json` (loaded by `npm run seed`).

## Inventory and detail views

| Method and path | What |
|---|---|
| `GET /api/envs/:env/inventory` | every object `{type: service \| channel \| store \| event, id, label, kind, group, team, connections, size, problems, hasDto}` (`hasDto` is set on event types: whether a message DTO exists) |
| `GET /api/envs/:env/stores/:key` | a data store: `readers`, `writers`, `clients` (rows as in `/clients`), `uses` (service, functions with code `source` and operations with `access` (`read`, `write` or `read_write`) and, when the step has them, `fields`), `entryPoints` that reach it, `siblings` in its group, `schemas` |
| `GET /api/envs/:env/clients` | how services reach data stores (#27): `{rows, counts}`. Query (all optional): `store` (bind key, or a cluster such as `redis:cache-main`), `service`, `driver` (package, or `package@major` as in the Inventory facet; `pkg@` = version not reported; matches the service's own driver or the one inside its lib), `driverMajor`, `lib`, `accessMode`, `via` (substring of a wrapper function, file or lib). `rows[]`: `{store, kind, service, entity: resource \| egress, id, accessMode, accessId, driver, lib, drivers: [{package, version, major, from: own \| lib}], via (linked hops), mixed: [{package, majors}], unresolved: [field]}`. `counts[]`: `{driver, major, label: "ioredis 4.x", services, clients}`, a service with two drivers counts under both |
| `GET /api/envs/:env/channels/:key` | a topic/queue/exchange/bus: `publishers`, `feeds`, `subscriptions` (with `events` filter (entries starting with `!` exclude a type or glob), `conflict`), `consumers`, `events` passing through, `problems`, `definedBy` and `flow` (below) |
| `GET /api/envs/:env/events/:type` | an event type: producers, consumers, `deliveries` (route `via`, handler), `problems`, `dto` and `flow` (below) |

### Channel `flow`

`flow` is what the channel page draws, computed in `core/channel-flow.ts` so agents (MCP `get_channel`)
get the same answers. It is additive: the older fields are unchanged.

- `layout`: `fanout` for a topic, bus or exchange (rows are its subscriptions) or `inbound` for a queue
  (rows are what feeds it).
- `rows[]`: one per real subscription. The declarations of every manifest are merged by (from, to).
  `{id, from, to, filter, direct, consumers}`. `from` and `to` are `{key, name, kind, known, eventTypes}`
  (`from` is null when publishers send straight into the queue; then `direct` lists them).
  `filter` is `{events, declarations, agree, differs}`: `declarations` has one entry per source
  (`service`, `id`, `events`, `at` code link, `verified`); when they do not `agree`, `differs` names the
  field (`filter`) and `events` is the union of the claims. Filter entries starting with `!` exclude.
  `consumers[]` are the readers of `to`: `{service, ingress, handler, handles: {all, types}}`.
- `consumers[]`: the readers of this channel itself (a queue's consumers).
- `grid`: event type by destination. `destinations[]` is `{rowId, queue, consumer}` (a queue nobody
  reads has `consumer: null`); `rows[]` is `{type, producers, cells}` with one cell per destination:
  `{status: handled | no-handler | filtered | no-consumer, handler, uncertain, why, possible?}`. `possible` is set when
  the event type is only a candidate (the publisher could not say which of several it sends; such rows have
  `possible: true` too, and are never counted as problems). `uncertain` means
  the answer depends on which of the disagreeing declarations is right; `why` says so in words.
- `summary`: `{text, segments: [{t, b?}], callouts: [{text, rowId, level: bad | warn | info}]}`. One sentence,
  plus one callout per problem; `rowId` is the `rows[].id` the callout is about, or null. `bad` is a delivery that arrives with no handler (red in the UI).

### Event type `flow`

`flow` is what the event page draws (`core/event-flow.ts`; MCP `event_types` with `type` returns it too).
Additive: the older fields are unchanged. Outcomes agree with `deliveries` and `problems`.

- `groups[]`: one per producer service, confirmed first. `{producer, possible, callSites, targets}`.
  `possible` is true when every call site only lists this type as one of several candidates.
  `callSites[]` is `{egress, bindKey, at (code link), possible, to: [node], candidates}`.
- `targets[]`: `{topic, direct, possible, rows}`. `topic` is the first topic or bus the producer sends
  to (a node `{key, name, kind, known}`), or null with `direct: true` for a send straight to a queue.
- `rows[]`: one per queue and consumer service: `{id, queue, via, filter, consumer, ingresses, outcome, ifSent?}`.
  `via` lists topics between the target's topic and the queue; `filter` is the merged subscription
  filter (same shape as in the channel `flow`) or null. `ingresses[]` is `{id, bindKey, handler,
  ingressHandler, outcome, any, handles, code, at}`: `handler` is null when it lists event types and none
  matches, `any` means it accepts any type, `code` links the handler.
- `outcome`: `handled`, `no-handler` (arrives, no handler), `possible` (only a candidate producer sends it;
  `ifSent` says what would happen), `no-reader` (the queue has no harvested consumer) or `filtered`
  (a subscription on the way does not let the type through). Filtered rows are kept for agents; the
  UI does not draw them and the summary does not count them.
- `unresolved[]`: `{service, egress, reason, detail, at}` for call sites with no resolved target.
- `unfed[]`: targets (same shape) of consumers that list this exact type while no harvested producer reaches them.
- `summary`: as in the channel `flow`.

## Redis instances and keys (0.16.0, #29)

An instance is the cluster or server in a bind key's group (`redis:cache-main` groups `redis:cache-main/order:{id}`); an infra harvester may define it with a resource whose `bindKey` is just `redis:cache-main` (`details`: `engineVersion`, `nodes`, `topology` cluster | standalone, `databases`). Inventory lists one row per instance (`instance: 'cluster' | 'instance'`, id = the instance key) instead of one per key pattern. `:id` below is the instance key (URL-encoded), the id of the defining infra resource, or the bare name (`cache-main`).

| Method and path | What |
|---|---|
| `GET /api/envs/:env/instances` | `[{key, name, topology, team, services, databases, templates, problems}]` |
| `GET /api/envs/:env/instances/:id` | the page: `definition` {service, id, source, verified}, `engineVersion`, `nodes`, `lanes` (per service: `access` read \| write \| read_write \| unknown and `accessFrom` declared \| steps \| keys, `clients` as in `/clients`, `databases`), `stores` (key patterns), per lane `keyCount` (templates the service uses), `keys` {source pushed \| inline \| none, version, pushedAt, summary, lazy}, `unknown[]` ({field, reason}: instance fields the infra harvester could not read, from `unresolved` what=detail `details.<field>`; lanes carry `databasesUnknown`: the reason when `client.databases` is unknown), `callouts` (each with `service`: whose card it opens, the first writer of a shared key or the reader of a key nobody writes) |
| `PUT /api/envs/:env/resources/:id/keys` | full replace of the instance's key templates. Body `{keys: [...], version?, producer?}` or the bare list. 400 with per-entry `details` (`index`, `field`) and nothing stored on any bad entry; 404 unknown instance; 409 `STALE_VERSION` when a given `version` is not above the stored one (without `version` the server adds 1). Returns `{instance, version, pushedAt, entries, summary}` |
| `GET /api/envs/:env/resources/:id/keys` | the grouped list. Query: `db` (index), `q` (substring), `problems=1`, `service` (0.17.0: only the templates that service writes or reads; `summary` still counts everything; the instance page loads one service's keys this way). `{instance, source, version, pushedAt, producer, summary, shown, groups}`; `summary` {templates, services, writers, shared, unwritten, ttlDisagreements, dbs: [{db, templates, problems}], problems} always counts every db. `groups`: `unwritten` (No harvested writer) and `shared` first, then one `owner` group per writing service; each row: `keyTemplate`, `dbIndex`, `commands`, `writeCommands`, `opsPerHour`, `ttl` {seconds, values, disagree}, `writers` / `readers` (service, access, commands, opsPerHour, ttlSeconds), `problem` {kind no-writer \| ttl-disagree, why, follows}, `flows` |

Key entry: `{keyTemplate, dbIndex = 0, commands[], service, access?, opsPerHour?, ttlSeconds?}`, one per service that uses a template in a db. `access` is `read`, `write` or `read_write` (default: from the commands; any write command makes the service a writer). `ttlSeconds` is the TTL the service sets (leave it out when there is none or it is unknown). Duplicates (service, db, template) are rejected. Up to 50 000 entries per instance. The older names `key_template`, `db_index`, `command_kinds`, `op_count`, `ttl` and `services: []` are accepted.

An owner is the service that writes a template. A template with several writers is one row in the `shared` group; with two different `ttlSeconds` it is a `ttl-disagree` problem. A template no entry writes is `no-writer`. `flows` come from resource steps whose `details.keyTemplate` equals the template and whose resource is on the instance: the entry points that reach the step, the function chain, the operation (`SET + EX 3600` when the step has `details.ttlSeconds`) and `access` of the step. Without a pushed list the interim inline `details.keys` of the instance's resources is read (`source: inline`); `details.lazy = {kind: 'keys', ref}` is kept and returned as `keys.lazy`.

MCP `get_resource_keys(env, resourceId, dbIndex?, query?, problems?, service?)` returns the same list as the GET (`service` too).

**Assumed values (#47, 0.25.2).** `assumed: [{what, value, basis, reason, detail?}]` is the mirror of `unresolved`: a value the harvester filled by a rule (client default, convention), not read from code. It is optional and additive on resources, steps, ingress, egress and functions (`schema/manifest.schema.json`, `$defs/assumed`) and on key entries of the PUT keys body (`assumed` per entry, stored in `resource_keys.assumed`, migration 010; returned as `assumed` on the `writers[]` / `readers[]` use of the row). `what` follows the `unresolved` what/detail convention (`what: "detail"` + `detail: "details.dbIndex"` for fields that are not first-class). Every API and MCP read returns it verbatim on the same objects as `unresolved`: `GET .../views/service/:service` and `get_service` (resources, egress, ingress, functions), `get_endpoint_info`, trace messages of a resource step (`assumed: [{field, value, basis, reason}]`), the instance page (`lanes[].databasesAssumed`, `assumed` for instance fields). Readers must treat it as a default, not a fact. A field both `unresolved` and `assumed` is the contract finding `assumed-and-unresolved`. Link resolution and the graph do not change. Health: `GET /api/envs/:env/health` lists it as the informational category `assumed` (see above); MCP `link_health(assumed: true, service?, basis?)` returns `{total, byBasis, items: {assumed}}`. Key entries are not in health (they live in the keys table, not the graph).

## Data-store schemas

One schema per store key and source (`code`, `db`, `manual`). The store must exist (404).

| Method and path | What |
|---|---|
| `GET /api/envs/:env/schemas?key=` | stored schemas |
| `POST /api/envs/:env/schemas` | bulk `{schemas: [{key, source = 'code', content}]}`, all or nothing (201) |
| `PUT /api/envs/:env/schemas/:source/:key` | body is the schema JSON |
| `DELETE /api/envs/:env/schemas/:source/:key` | remove one |

Example: `samples/schemas/prod.json` (loaded by `npm run seed`).

## Bugs

Bugs are about Flow-Mapper itself. Each records the version it was seen in (`appVersion`,
defaults to the running version) and, once fixed, the version the fix ships in.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/bugs?open=true&status=&priority=&severity=&service=&version=&q=` | sorted by priority, then impact |
| GET | `/api/bugs/stats` | counts by status, priority, severity, version |
| POST | `/api/bugs` | `{title, description?, steps?, severity: S1..S4, appVersion?, env?, reporter?, channel: api\|web\|mcp, links?: [{type, service?, id}], priority?}` |
| GET | `/api/bugs/:id` | with links, attachments, comments, `allowedTransitions`, `needsVerification` |
| PATCH | `/api/bugs/:id` | `{status?, severity?, priority? (null = use suggested), assignee?, fixedInVersion?, resolution?: {type: code\|map-data\|config\|none, ref?, note?}, links?}` |
| POST | `/api/bugs/:id/comments` | `{author, body}` |
| POST | `/api/bugs/:id/attachments?filename=run.log` | raw body, up to 5 MB; returns suggested map links found in the text |
| GET | `/api/bugs/:id/attachments/:attachmentId` | the file |

Workflow: `open → triaged → in_progress → fixed → verified → closed` (plus `wont_fix`, `duplicate`,
and reopen paths). Moving to `fixed` requires `fixedInVersion` and `resolution`. A fixed bug shows
`needsVerification: true` once the running version is at or above `fixedInVersion`.

Priority: severity weight (S1 4 … S4 1) plus impact boost (0 if no flow passes through the linked
entities, 1 if any does, 2 if at least a quarter of all flows do). 5+ is P0, 4 P1, 3 P2, else P3.
Setting `priority` overrides the suggestion; `priority: null` returns to it.

## Push events (E1)

Instead of polling, a client can hold one connection open and be told when something happens.

`GET /api/events` is a Server-Sent Events stream (`text/event-stream`). Each event is
`id: <n>`, `event: <type>`, `data: <one-line JSON>`; a `: heartbeat` comment arrives every 25 s. Events are
stored (7 days / 5000 rows, in the `events` table), so a client can resume:

| Query / header | Meaning |
|---|---|
| `types=bug.*,version.deployed` | comma list of types; `*` is a wildcard. Default: all |
| `reporter=loader,p81` | drops events whose `reporter` is a different one. Events without a reporter (`version.deployed`, `manifest.ingested`, `env.*`) still pass |
| `env=prod` | same rule for `env` |
| `Last-Event-ID: 41` or `since=41` | first replay the stored events with a greater id, then go live. Without either: live only |

At most 32 streams at once (`503 TOO_MANY_CLIENTS`). A browser `EventSource` resumes by itself; for `curl` see
[BUG-LOOP.md](BUG-LOOP.md#push-mode).

`GET /api/events/recent?since=41&types=...&limit=100` is the same data as plain JSON `{events, lastId}`
for clients that prefer polling (without `since`: the newest `limit`, oldest first). The static preview build has
no server and no events; nothing in the UI depends on them.

Event: `{id, type, at, env?, bugId?, reporter?, summary, data}`. `summary` is one readable line.

| `type` | When | `data` |
|---|---|---|
| `bug.created` | a bug was reported (API, UI, MCP) | `title, severity, priority, links` |
| `bug.commented` | a comment was added; `reporter` is the bug's reporter | `commentId, author, body` (first 1000 chars) |
| `comment.created`, `comment.edited`, `comment.deleted` | a comment under a flow (0.27.0); `env` is set, no `reporter` | `anchor, id, author, text` (first 300 chars of the plain text) |
| `bug.status` | the status changed | `from, to, fixedInVersion, resolution, assignee` |
| `bug.updated` | other fields changed (title, description, severity, priority, assignee, links, ...) | `fields` |
| `version.deployed` | at startup, when the version differs from the last recorded one | `version, previous` |
| `manifest.ingested` | a manifest was ingested (not for `dryRun`); one per manifest of a batch | `service, version, fromVersion, kind, producer, source, changes` (counts) |
| `env.created` / `env.deleted` | a design environment was created or deleted | `source, createdBy` |

An event is recorded once, after the write committed; a rejected or rolled-back write, a no-op patch and a dry run
record nothing. A `PATCH` that changes the status and other fields gives one `bug.status` and one `bug.updated`;
`fixedInVersion` and `resolution` sent with the status change belong to the `bug.status` event.

## Flow descriptions (0.14.0)

Every flow has a description of what it is for, and each service in it can have one for its part. Two records per key,
`source` = `human` | `ai`; neither overwrites the other. Key: `env` + `service` + `ingress` (the whole flow: the entry
point that starts it) and optionally `callee` (a sub-flow: the service name, or `service:handler` for one delivery, or
(0.20.0) a **step key** for one arrow of the flow).
Stored in `descriptions` (migration `003_descriptions.sql`, kept when a service is re-harvested).

| Method + path | |
|---|---|
| `GET /api/envs/:env/descriptions?service=&ingress=` | `{service, ingress, hash, flow: {human, ai}, callees: {<callee>: {human, ai}}}`. `human` is `{text, title, editedBy, editedAt}` or null; `ai` is `{text, title, model, generatedAt, traceHash, outdated}` or null (`title`: 0.30.0, string or null). `hash` is the hash of the flow's current trace; `outdated` is true when an AI record was written from a different trace (the flow changed since). 404 for an unknown ingress |
| `PUT /api/envs/:env/descriptions` | writes the **human** record: `{service, ingress, callee?, text, title?, editedBy?}`. Empty `text` (and no title) removes it. Max 4000 characters. Returns the flow's descriptions. There is no REST write for the AI record |

**Step keys (0.20.0).** `#step:<from>><to>|<label>|<transport>`, built from one message of the flow's trace
(`message.from`, `message.to`, `message.label`, `message.transport`, empty when absent), for example
`#step:svc:api-gateway>svc:orders-svc|http:POST orders-svc/orders|http`. The key comes from the message content, never from
its position, so it survives redraws and inserted steps. A second identical arrow in the same flow ends in `~2`, a third in
`~3`. The same call (`PUT` or `set_description`) writes them; a key that matches no message of the flow is refused (400). The
flow page shows them as the step description under the walk bar. Their trace hash covers only the step's own messages.

**Step titles (0.30.0, migration `015_step_titles.sql`).** A step key may also carry a `title`: at most 80 characters, trimmed (400 over that), `null` = none; it is ignored for any other callee. `PUT` and MCP `set_description` take it as `title`; omitted keeps the stored one, `''` clears it. A record may hold a title with empty text and the other way round; the human record is removed only when both are empty. The human title wins over the AI title (`titleOf`). The step bar, the arrows (option) and the Mermaid export show it (export: the title is the message text and the API goes into a `Note`).

The trace hash (`core/description.ts` `traceHash`) is a 53-bit hash over each message's depth, kind, endpoints, label,
transport, event, target, store and call (trace options: scope full, 2000 messages). For a callee it covers only the
messages that touch that service, so changing one branch does not outdate the others. It is stable across reloads.
`trace_flow` over MCP (with `ingress`) and `get_service` carry the descriptions too (below); `GET /trace` does not,
read them with the endpoint above.

## Comments under a flow (0.27.0)

A discussion under each flow: a list of rich-text comments with one level of replies. Stored in `comments` (migration `011_comments.sql`),
anchored with `flow:<service>/<ingress>` (the `core/anchors.ts` grammar) so later slices can open threads on any anchor without a migration.
Comments are annotations: **every environment takes them**, sealed ones too, and no draft is needed. `?draft=<slug>` on a read or a post
lets a flow that only exists in an open draft be discussed (an unknown draft is `404`, a closed one `409`).

| Method + path | |
|---|---|
| `GET /api/envs/:env/comments?anchor=flow:<s>/<i>[&draft=]` | `{anchor, count, resolvedThreads, comments: [{id, step, author, body, createdAt, editedAt, deleted, externalId, externalSource, authorExternalId, resolved, resolvedBy, resolvedAt, replies: [...]}]}`, oldest first, replies oldest first. `count` is the live comments, replies included. A deleted top comment that still has replies comes back with `deleted: true`, `author: null`, `body: ''`; one without replies is not listed |
| `GET /api/envs/:env/comments/counts` | `{<anchor>: n}`, **open discussions** per anchor: live top comments that are not resolved, replies not counted (the Flows list badge; 0.29.2, before it counted every live comment) |
| `POST /api/envs/:env/comments[?draft=]` | `{anchor, step?, parentId?, author, body}` plus the importer fields below -> `201` and the row `{id, anchor, step, parentId, author, body, createdAt, editedAt, deletedAt, externalId, externalSource, authorExternalId, resolvedAt, resolvedBy, resolved}` (`200` and `updated: true` on a re-import) |
| `PATCH /api/envs/:env/comments/:id` | `{author, body}`: sets `editedAt`, keeps `createdAt`. Or `{actor, resolved: true\|false}` to resolve or reopen (see below); the two are not combined |
| `DELETE /api/envs/:env/comments/:id?author=` | soft delete (`deletedAt` set, the text is emptied) -> `{deleted: id}` |

- **Body** is HTML, always sanitized by the server (`core/rich-text.ts`, an allowlist written without a DOM): `p br b strong i em s del strike u ul ol li a table thead tbody tr th td span code pre blockquote`.
  `a` keeps only an `http(s)` `href` and gets `rel="noopener noreferrer" target="_blank"`; `span` keeps only a palette class (`cc-coral cc-ochre cc-sage cc-cyan cc-sky cc-violet`);
  `td` / `th` keep `colspan` / `rowspan` (2 to 20). Everything else is removed: other tags and their attributes, styles, comments, `script` / `style` contents; text is escaped, entities are decoded once.
  `div` and `h1`..`h6` become `p`, so pasted line breaks survive. Limits: 20 000 characters after sanitizing (`422`), nesting depth 20, a table at most 50 rows x 20 columns. A body with no text after sanitizing is `422` ("the comment is empty"). The server sanitizes again on every read, so a row that did not come through a write is never served raw. Clients should still sanitize before they set `innerHTML` (the UI does, with the same code).
- **Identity is naive.** There are no passwords. Since 0.32.0 the caller is a **user** (see "Users and identity"): the UI sends `X-Flow-User: <userId>` (the user it signed in as), and `author` (1 to 80 characters) is only needed by clients that do not send the header; it is matched to a user (created when new). Only the comment's own author edits or deletes it (by user id, so a rename does not lock anyone out; `403 FORBIDDEN` for someone else, `404` for a deleted or unknown id). Rows carry `authorId`; `author` shows the user's current name. The UI has no name field any more: the composer, resolve, action items and the bug dialog use the signed-in user.
- **Validation.** `anchor` must be `flow:<service>/<ingress>` of a flow that exists in the environment (or the open draft): `400` for another anchor, `404` for an unknown environment or flow. `step`, when given, is a step key (`#step:...`, see Flow descriptions) of that flow's trace (`400` otherwise). `parentId` must be a comment under the same anchor (`404`), not deleted (`422`); a reply to a reply is stored under the top comment (one level only).
- **Importer fields (0.29.2, migration `014_comments_import.sql`).** `POST` also takes: `createdAt` (ISO 8601; kept as that instant and stored as UTC; `400` when it is not a time or is more than 5 minutes in the future); `externalSource` + `externalId` (both or neither, at most 200 characters each: the id of the comment in the system it came from, e.g. `confluence`); `authorExternalId` (at most 200); `parentExternalId` instead of `parentId` (the parent is looked up by `externalSource` + that id in the same environment, so `externalSource` is required; unknown, under another flow, or given together with `parentId` is `400`); `resolved` (bool) with optional `resolvedBy` (default: the author) and `resolvedAt` (default: now). `count`, `author` and the other rules are unchanged.
- **Re-import.** A POST whose (`externalSource`, `externalId`) already exists in the environment **updates that comment** (body, author, step, `createdAt`, `authorExternalId`; `resolved` only when the field is given) and answers `200` with `{..., updated: true}` instead of `201`; it never duplicates. A changed body sets `editedAt`. A comment that was deleted comes back. The same pair under a different anchor is `409 EXTERNAL_ID_TAKEN`. Its parent is not changed by a re-import. The pair is unique per environment (`resolved` of a reply is `400`: see below).
- **Resolve and reopen.** `PATCH {actor, resolved: true|false}`: anyone may (not only the author; `actor` is 1 to 80 characters and is kept as `resolvedBy`), on a top comment; its replies follow the thread (`resolved` on a reply is `400`, `404` for a deleted or unknown comment). Resolving twice changes nothing and emits nothing. The UI hides resolved threads behind "Show resolved (n)", and the counts above leave them out.
- **Copy.** A Full copy of an environment copies its comments (authors, times, replies, importer ids and the resolved state); Blank and Components copies do not. Deleting a design environment deletes its comments.
- **Events** (`GET /api/events`): `comment.created`, `comment.edited`, `comment.deleted`, `comment.resolved`, `comment.reopened` (the last two only when the state changed; `author` is the actor, no `text`), each with `env` and `data {anchor, id, author, text}` (`text`: the first 300 characters of the plain text; absent on `deleted`).
- **MCP.** `list_comments {env, service, ingress, draft?, since?}` returns `{anchor, count, comments}` with, per comment, `text` (plain) and `html` (sanitized) and its replies; `since` (ISO time) keeps only comments created or edited after it, for polling. `resolve_comment {env, id, author, resolved}` resolves or reopens a thread (0.29.2). `add_comment {env, service, ingress, author, body, step?, parentId?, draft?, createdAt?, externalId?, externalSource?, authorExternalId?, parentExternalId?, resolved?, resolvedBy?, resolvedAt?}` (the importer fields as above; the answer has `updated: true` on a re-import): `body` is plain text with Markdown-lite (`**bold**`, `~~strike~~`, `- ` lists, blank line = paragraph) or HTML from the subset above, sanitized either way.
- **Preview.** The static preview bundles the seeded comments and keeps what the viewer posts in memory (like bug edits).

## Action items under a flow (0.29.0)

A small table under each flow: owner, description, status, due date. Stored in `action_items` and `action_item_events` (migration `013_action_items.sql`),
anchored like comments with `flow:<service>/<ingress>`. An item may be made from a comment (`commentId`) but is not a comment type. Like comments they are
annotations: **every environment takes them**, sealed ones too, and `?draft=<slug>` on a read, a post or a patch lets a flow that only exists in an open draft carry them.

| Method + path | |
|---|---|
| `GET /api/envs/:env/action-items?anchor=flow:<s>/<i>[&draft=]` | `{items: [{id, anchor, number, owner, description, status, due, step, commentId, source, createdBy, updatedBy, createdAt, updatedAt, closedAt}], events: [{id, itemId, number, kind, actor, at, commentId}], next}`: items by number, events oldest first, `next` is the number the next item gets |
| `GET /api/envs/:env/action-items/counts` | `{<anchor>: n}`, open items (`open` + `progress`) per anchor; anchors with none open are absent (the Flows list badge) |
| `POST /api/envs/:env/action-items[?draft=]` | `{anchor, owner, description, status?, due?, step?, commentId?, actor}` -> the item. `status` defaults to `open`; `actor` is the creator |
| `PATCH /api/envs/:env/action-items/:id[?draft=]` | `{actor, owner?, description?, status?, due?, step?}`: `due: null` and `step: null` clear them -> the item |
| `DELETE /api/envs/:env/action-items/:id?actor=` | soft delete -> `{deleted: id}`; only the creator |

- **Fields.** `owner`: 1 to 80 characters, cleaned like a comment author. `description`: plain text, trimmed, 1 to 2000 characters. `status`: `open`, `progress`, `done` or `dropped`; open = `open` + `progress`. `due`: a real date as `YYYY-MM-DD`; overdue (due before today and still open) is computed by the client from its local date. `step`: a step key (`#step:...`) of the flow's trace. `commentId`: a live comment under the same anchor.
- **Numbers** are per environment and anchor and never reused: the next number is max + 1 over all rows, deleted ones included (`next` says it). A Full copy keeps them.
- **Identity is naive**, as for comments. Anyone may change any field and the status; `actor` (1 to 80 characters) is stored in `updatedBy`. Only the creator deletes: `403 NOT_CREATOR` when `actor` is not `createdBy`.
- **Errors.** `400 VALIDATION` (a field, the anchor, `step`, `commentId`, a missing `actor`), `404` for an unknown environment, flow or item, `403 NOT_CREATOR`.
- **Events in the list.** `created` is written with every item; `closed` (to `done`), `dropped` and `reopened` are written when a status change crosses the open/closed line (open <-> in progress and done <-> dropped write none). The UI shows the events of items that have a `commentId` under that comment.
- **Deleting the source comment** keeps the item; `commentId` stays, the UI shows the link as plain text.
- **Copy.** A Full copy copies items, events and the comment links (remapped to the copy's comments); Blank and Components copies do not. Deleting a design environment deletes its items.
- **Push events** (`GET /api/events`): `action_item.created`, `action_item.updated`, `action_item.deleted`, with `env` and `data {anchor, id, number, status, actor}`.
- **MCP.** `list_action_items {env, service, ingress, draft?}` returns `{anchor, open, count, items, events, next}`. `add_action_item {env, service, ingress, owner, description, author, status?, due?, step?, commentId?, draft?}` and `update_action_item {env, id, author, owner?, description?, status?, due?, step?}` (`due` and `step` take `null` to clear). Items written over MCP have `source: "ai"`, which the UI marks with a "by AI" chip. There is no delete over MCP.
- **Preview.** The static preview bundles the seeded items and keeps what the viewer does in memory.

## Users and identity (0.32.0, #66 part 2)

A global registry of people (not per environment): `users` (migration `016_users.sql`). Comments carry `author_id`, action items `owner_id` /
`created_by_id`; the free-text `author` / `owner` stays as the display fallback. Existing authors and owners became users in the migration
(names that differ only in case or spacing are one user). Spec: `docs/plans/users-mentions.md`.

| Method + path | |
|---|---|
| `GET /api/users` | `{users: [{id, name, color, createdAt, lastSeenAt, aliases, externalIds: [{source, externalId}]}]}`, live users only, most recently active first |
| `GET /api/users/:id` | one user (an id that was merged answers the user it went into) |
| `POST /api/users` | `{name, externalIds?, match?}` -> `201`. A taken name (case and space-insensitive) is `409 NAME_TAKEN`; an external id another user holds is `409 EXTERNAL_ID_TAKEN`. With `match: true` an existing user is returned (`200`) instead of the conflict |
| `PATCH /api/users/:id` | `{name, keepAlias?}`: rename; ids and colours do not change; `keepAlias: true` keeps the old name as an alias |
| `POST /api/users/:id/merge` | `{into}`: folds the user into `into` (comments, action items, mentions, seen marks, external ids, aliases move; the old name stays as an alias; the merged id still resolves). Logged as a `user.merged` event. No delete exists |

- **Who is calling (`server/identity.ts`, the only module that knows).** The web client sends `X-Flow-User: <userId>` on every write (the user picked in the sign-in; unknown id: `400`). REST clients that do not send it keep sending `author` (comments) / `actor` (action items, resolve) / `owner` names: each is **matched** to a user (external id first, then exact name or alias, case and space-insensitive) and a user is created when none matches. The header wins over a name in the body. MCP writes are by "Assistant" unless `author` is given. Identity is naive (no passwords); Cognito later replaces only that module.
- **Author matching on import.** `authorExternalId` together with `externalSource` is looked up first: `{externalSource: "confluence", authorExternalId: "77"}` finds the user that holds that external id whatever name the importer sends (and attaches the id to a user matched by name). An unknown pair creates a user with it.
- **Edit and delete** compare the caller's user id with the row's `author_id` (action items: `created_by_id`), so a rename does not lock anyone out; rows without ids fall back to the stored name.
- **Display.** Reads show the author, owner and creator under the user's **current** name; `authorId`, `ownerId`, `createdById` are added to the rows.
- **Action items** take `owner` (a name, matched) or `ownerId`.
- **MCP.** `list_users {query?}`, `list_mentions` (see Mentions). `add_comment`, `resolve_comment`, `add_action_item` and `update_action_item` no longer require `author`: without it the write is by the user "Assistant".

## Mentions (0.32.0, #66 part 2)

A comment can address a user with the token **`@[userId]`** in its body (the id is `u_` plus 8 hex characters; any `[A-Za-z0-9_-]{1,40}` is read as an id).
The sanitizer keeps it as plain text; the UI draws it as a chip with the user's **current** name (a rename changes every old comment), a filled chip
for the signed-in user and a dashed "@unknown user" for an id that has no user. A plain "@Priya" stays text (no guessing).

- **Writing a mention.** Put `@[userId]` in the body, or the name form **`@{Display Name}`** (REST and MCP): the name is matched to a user (exact name or alias, case and space-insensitive) and a **new user is created when none matches**; the server rewrites it to the token before the body is sanitized and stored. `GET /api/users` (or MCP `list_users`) gives the ids. An unknown `@[id]` is stored as text and mentions nobody.
- **Who a comment points at** is kept in step with the body on every write (create, edit, re-import): editing a mention out removes it (and its seen mark); an edit that adds one to an old comment makes it unread. A mention of yourself and the mentions in a Full copy are never unread. A merge rewrites the tokens (`@[old]` becomes `@[kept]`).
- **Unread** is per user and per comment (a seen mark), so it survives a merge. The UI marks a thread's mentions seen after 2 seconds on screen, or when opened from the Mentions page.

| Method + path | |
|---|---|
| `GET /api/mentions?user=<id>[&unread=1][&env=][&anchor=][&limit=]` | `{user, unread, mentions: [{commentId, env, anchor, service, ingress, step, parentId, author, authorId, text, html, createdAt, unread}]}` across **every environment**, newest first. `user` may be the `X-Flow-User` header instead. A deleted comment is not listed. `400` without a user, `404` for an unknown one |
| `POST /api/mentions/seen` | `{user?, commentIds: [n, ...]}` -> `{marked}`. Only comments that mention that user get a mark |
| `GET /api/envs/:env/mentions/counts?user=<id>` | `{<anchor>: n}`: unread mentions per flow (the Flows list's "@ n new"); `{}` with no user |

- **About mentions (0.33.0).** `GET /api/mentions` and `list_mentions` also return `about: [{env, kind: 'component' | 'subsystem', id, label, text}]`: the About of a component or a subsystem (as the environment is, not a draft) that holds `@[userId]`; the Mentions page lists them as "about of <item>". They are never unread and do not count in the badge; empty with `unread=1` or `anchor`.
- **MCP.** `list_mentions {user, unread?, env?, limit?}` (`user`: an id or an exact name) returns `{user, unread, mentions, about}` as above. `add_comment` accepts `@[id]` and `@{Display Name}` in `body`.
- **Events.** Unchanged (`comment.created` ...): the text carries the token.

## MCP

- HTTP: `POST /mcp` with one JSON-RPC 2.0 message (MCP streamable HTTP, JSON responses).
- stdio: `npm run mcp` (same database, `FLOW_DB`).

Tools: `search`, `list_services`, `get_service`, `list_entry_points`, `trace_flow`, `find_paths`,
`link_health`, `changelog`, `set_description`, `ingest_manifest`, `get_endpoint_info`,
`load_dtos`, `event_types`, `inventory`, `get_store`, `get_channel`, `get_exchange` (0.19.0: the exchange page, same data as GET /instances/amqp:<name>), `load_schemas`, `list_bugs`,
`list_envs` (0.21.0: name, kind, source, copiedAt, groups, components), `create_env` (0.21.0: same body as `POST /api/envs`), `open_draft`, `list_drafts`, `draft_changes`, `edit_in_draft`, `apply_draft`, `discard_draft`, `get_marks`, `apply_import_plan`, `import_preview`, `import_into_draft`, `get_subsystems`, `get_subsystem_map`, `list_abstract_links`, `suggest_refinements`, `apply_plan_links`, `set_subsystem_settings`, `set_levels` (0.28.0), `export_mermaid` (0.27.4), `import_mermaid` (0.27.4), `edit_design`, `get_call`, `list_action_items`, `add_action_item`, `update_action_item` (0.29.0), `get_flow_names`, `set_flow_name` (0.23.0 / 0.25.0: see Drafts; every read tool takes `draft`; `ingest_manifest`, `load_dtos` and `load_schemas` take `dryRun` and, with it, `draft`), `get_resource_keys` (0.16.0), `list_clients` (same filters and result as `GET /clients`; `get_store` also returns `clients`), `get_bug`, `report_bug` (accepts `log` text), `update_bug` (accepts `comment`).
`set_description(env, service, ingress, callee?, text, model)` (0.14.0) saves the **AI** description of a flow (no `callee`) or of one service in it. It writes the AI record only, never the human one; it stores `model`, the time, and the hash of the flow's trace as it is now. `model` and `text` are required; the entry `ingress` must exist; `callee` must name a service of the env or be a step key of the flow (0.20.0). It returns the flow's descriptions (as `GET /descriptions`). `trace_flow` with an `ingress` returns `descriptions` next to the trace, and `get_service` returns `descriptions`: every record of that service's flows `{ingress, callee, source, text, by, at}`, so an agent sees what is already written before it writes. The UI's "Generate…" dialog hands out two prompts (the whole flow with all its services; one service) that tell an AI tool to call `trace_flow`, `get_service` and then `set_description`.
`trace_flow` and `GET /trace` messages of steps that are alternatives (steps of one function with the same `altGroup`, else consecutive steps with the same `source` file:line that each carry a `condition`) carry `alt: {group, branch, of}`: `group` is `<function>:<altGroup>` (or `<function>:<file>:<line>@<first seq>`), `branch` the 1-based branch (one per distinct condition, in order of first appearance), `of` the number of branches; the message keeps its `condition`. 0.32.2 (#72): a step with `groups` (nested frames inside one function, outermost first, `{id, kind?, condition?}`) carries the innermost frame as `alt` with `kind` (when not `alt`: `opt`, `loop`, `par`, `critical`, `break`), `condition` and `parent` (the enclosing frame, same shape, up to the outermost). The messages a branch's step leads to (the topic, queues and consumers of a publish, which carry the same `alt`) and everything below it in the call tree (messages deeper than the group) belong to that branch; every branch is followed. `maxMessages` counts the largest branch of a group, not the sum; `flows/counts` counts each component once, as it always did. The UI draws an alt frame around the group.
`trace_flow` and `GET /trace` messages of a step with `mark: "new" | "changed"` (0.32.2, #75) carry `mark` and, when the step's `details.changed` is a string, `changed`; a leaf step with `over` carries `over`. The `call` design edit (REST `edits`, MCP `edit_design`) takes `mark` (`'new'`, `'changed'`, or `null` to clear; anything else is `422 INVALID` with `field: 'mark'`); an edit that leaves it out keeps it.
`trace_flow` and `GET /trace` messages of an egress step with `eventFrom` (the step's event type comes from the nearest enclosing call step's `bind` of that name on the traced path) carry `event` as usual plus `eventFrom: {name, boundAt}`; `boundAt` is `<caller function name>:<seq>` and is absent when nothing on the path binds the name (the publish then behaves as one that names no event). `flows/counts` cannot follow binds per path: for such a step it uses every value that call steps bind to the name on a call path reaching the step's function, in the same service (a name bound in another service never counts; #44), plus the egress's events and candidates, so a count can include components a trace through one caller does not draw. Event reports and channel views list those bound values among the egress's events. Manifest: `bind: {name: value}` on `call` steps, `eventFrom: name` on egress steps; contract rule `eventfrom-unbound` (info).
`trace_flow` and `GET /trace` messages of an SNS fan-out (a publish that reaches several links) carry `group` (id of the publish, `m<index of its message>`), `deliveries` (on the publish: how many follow) and `delivery` (1-based ordinal, on the topic -> queue and queue -> consumer messages of one delivery). A single-queue send has none of them. Additive (0.17.0): the message of a hop through a subscription (topic -> queue, bus -> target, and an AMQP publish bound to a queue) carries `filter: { id, service, from, events? }`: the binding that carries it, the key it listens on (`sns:topic`, `eventbridge:bus`, `amqp:exchange/routing-key`) and the event types it lets through (`'*'` or a list; absent means all). The UI draws it as the marker on the arrow and in the message panel; the delivery messages after the queue do not carry it. The UI draws an activation bar on the topic and labels the rail `depth.delivery` (3.1, 3.2, ...); call `depth` is unchanged. Order (0.9.4): the publish is followed by all its deliveries (topic -> queue -> consumer, one after another); only then come the consumers' own messages (calls, stores, publishes, nested deliveries), delivery 1's subtree first, then delivery 2's. Nothing sits between two deliveries, so the bar covers exactly the delivery rows. Before 0.9.4 each consumer's subtree sat between its delivery and the next.
Order (0.32.4, #73): an async call (a publish, an async egress to a service, an async call step) draws its arrow where it stands, and the callee's work comes after the rest of the calling function's steps. Additive tags: `n` (1-based message number) on a message that starts that work, `of` on each message of it (the `n` of the innermost delivery or async call it runs under); the caller's own steps have none. Use `of`, not `depth`, to tell a consumer's steps from the caller's later steps.
`trace_flow` and `GET /trace` (0.12.0, #31): an ingress with `middleware: [fnId, ...]` (functions of the same service, optional, ordered; `details.middleware` stays untraced) is traced as the middleware functions in order, then the handler, each an ordinary function visit at the handler's depth. Every message made by a middleware, or by a function it calls, carries `middleware: {fn, index}` (`index` is the 0-based position in the chain); the handler's own messages and every other service's carry none. The message that reaches the ingress (`entry`, `egress`, `deliver`) carries `middlewareChain: [{fn, name}]` (also for a middleware with no steps; not on a repeat, nor on a service that `scope=intra` does not expand). The middleware's calls are the service's own outgoing calls, so they are system-map edges, link-health entries and `flows/counts` components; with `scope=intra` they are the service's outgoing calls. An ingress without `middleware` traces unchanged. `GET /views/service` ingress and `GET /entry-points` rows carry `middleware` when set.

Ingress `transport: "socket"` (0.17.4, #46): an event on a long-lived client TCP / TLS / WebSocket connection. `details.protocol` is `tls`, `tcp` or `ws` (default `tcp`), `details.event` and `details.port` are display data. It is an entry point unless `entryPoint: false` is sent (so `GET /entry-points` lists it with `entryPoint: true` and it is never under "never called"), no link resolution looks for a producer, and `middleware` is traced as for http. The trace's `entry` message carries `transport: "socket"` and `protocol`; the caller lifeline is `client` (UI: "client · tls socket"). Listed in `schema/manifest.schema.json` (`transport` enum).

`entryPoint` on an ingress (0.25.1, #55; manifests, plan ops, draft ops, the endpoint and flow forms): `true` always an entry point, `false` never (a hop keeps its real transport; it stays in the unreached list of link health), absent the default rule above. In the forms `null` clears the flag; `false` is stored, no longer dropped.

**Links and runtime** (0.25.1, #54, #49). `links: {main?: {label, url}, sub?: [{label, url}]}` is accepted on the service header, a function and an ingress (manifests, plan manifests, draft ops: field `links`), on a flow (a `flow:` op field or a plan flow's `links`; stored with its name, migration 009 `flow_links`) and in the edit forms `component`, `endpoint`, `function` and `flow`. Rules: `http` / `https` URLs only, `label` 1 to 120 characters, at most 20 `sub` links, nothing else in the object (`422` otherwise). In a form, `links` absent keeps the stored value, `null` (or `{}`) removes it, an object replaces it whole. Reads: `GET /views/service` returns `links` on `service`, on each `ingress` and on each `function`; `GET /entry-points` rows carry the ingress's `links` and the flow's links as `flowLinks`; `GET /trace` carries the flow's links as `start.links`; `GET /flow-names` rows carry `links` (and `PUT /flow-names` takes an optional `links`, `null` removes). Links never take part in linking, flows or marks' hashing of traces. `runtime` on a component (form field, stored as the header's `details.runtime`; manifests and plans put `details.runtime` in the service header): `k8s-pod`, `k8s-deployment`, `k8s-daemonset`, `k8s-operator` or `k8s-job` (anything else is `422`); `null` removes it.

RabbitMQ pages (0.19.0, all additive). `GET /api/envs/:env/exchanges` lists the exchanges `[{key, name, kind: 'amqp-exchange', type, team, services, publisherServices, bindingCount, problems}]` (exchanges declared by a channel, or only seen in a binding or a publish key); the Redis list `/instances` is unchanged. `GET /api/envs/:env/instances/:id` also answers an exchange when `:id` is `amqp:<name>` (URL-encoded) or the bare name and no Redis instance has that id: `{key, name, type, vhost, durable, alternateExchange, details, definition {service, source, verified}, declaredBy, publishers, bindings, queues, consumerServices, routingKeys, callouts, problems}`. A `publishers` row is one publish per service and routing key: `{id, service, routingKey, reaches [{id, key, queue, possible?}], dropped, alternateExchange?, publishedIn [{fn, name}], at}`; `dropped` means no binding routes it (RabbitMQ drops it, or sends it to the alternate exchange). A `bindings` row: `{id, service, key, from, match, queue, queueKey, consumers [{service, ingress, handler}], matchedBy [{service, routingKey}], noPublisher, at}`; `noPublisher` means no harvested publisher routes to it. `callouts` are `{kind: dropped | no-publisher, text, row {type, id}}`. Routing uses the exchange type (core/amqp-route.ts), the same rules as the flow diagram. The page's routing-key tester runs `routesTo` (core/amqp-exchange.ts) in the browser. `GET /api/envs/:env/inventory` lists exchanges (`kind: amqp-exchange`, `exchangeType`), queues (`kind: amqp-queue`, "bound by audit.#, 1 consumer"), RPC plumbing (`plumbing: true`, kinds `rpc-command-queue`, `rpc-reply-queue`, `rpc-reply-queues` (one row per calling service)) and RPC commands (`type: rpc`, `kind: amqp-rpc`, `open {service, ingress}`; `problems: 1` when a command is called and nothing harvested serves it). `GET .../views/service/:name` adds `rpc` {command, commandQueue, prefetch, library} and `noCaller` to an RPC ingress (an RPC command nobody calls is not `orphan`), `rpc` {…, timeoutMs, replyTo} to an RPC call and `amqp` {exchange, routingKey, bindings} (the binding keys that route it) to a publish. `GET .../endpoints/:service/:ingress` adds `rpc` {command, commandQueue, prefetch, library, sharedBy, callers [{service, egress, fn, timeoutMs, replyTo, source}]} for an RPC command (null otherwise), and its DTO slots are Request and Response.

RabbitMQ in traces (0.18.0, all additive; see HARVESTER-GUIDE "RabbitMQ"). A publish through an exchange carries `amqp` {`exchange`, `routingKey`, `type` (topic | direct | fanout | headers), `alternateExchange`, `matched` (bindings that route it), `nonMatching` [{`id`, `service`, `key`, `queue`}], `possible` (binding ids, headers exchange with unknown publisher headers)} on the publish and on every hop after it. A hop through a binding has `filter.bindingKey` (the key as written in code), `filter.match` and, on a headers exchange, `filter.headers` / `filter.xMatch`. An exchange that routes to two or more queues is drawn like an SNS topic: publish to `ch:amqp:<exchange>` (`group`, `deliveries`), then one `exchange -> queue` hop per binding; one matching queue goes straight to the queue; no match ends at the exchange (`amqp.matched: 0`, not `broken`). `match: "amqp-topic"` on a binding uses RabbitMQ topic rules (`*` one word, `#` zero or more; a `{placeholder}` word in a published key is one word). An RPC (`amqp-rpc:{command}`, transport `amqp`, mode `sync`, unicast by default) carries `rpc` {`command`, `commandQueue`, `replyTo`, `exchange`, `correlation`, `timeoutMs`, `library`, `prefetch`, `declaredBy` (caller | both)}: the caller's `details.rpc` completed by the server ingress's; with no server it is a `broken` message with `declaredBy: "caller"`.
`get_service` takes an optional `via` (substring of a wrapper function or file) to keep only egress that goes through it; its egress, `trace_flow` messages and `get_endpoint_info` producers carry `via`; ingress carries `via` (handler resolution) and `trace_flow` messages `handlerVia`, plus step code links in `code`; `get_service` functions carry `unresolved`.
`trace_flow` and `GET /trace` expand each delivery once per trace (#43). A delivery is keyed by consumer service, ingress, handler and event type (the matched types for an untyped publish). The first one in trace order is expanded; later ones, under a sibling or in another alt branch, are still drawn (the publish, topic and queue legs, and the delivery arrow) but nothing below them is. That delivery message carries `repeatOf: N`, the 1-based step (position in `messages`) of the first, and ends its label with `↩ seen at step N`. Repeats do not count toward `maxMessages`. A delivery whose handler is already on the path stays a `cycle: true` message, not a repeat. `flows/counts` is unaffected (it counts each component once).
