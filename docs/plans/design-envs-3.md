# Phase 3: the subsystem level (build spec)

Base: main at c7a8394 (0.26.0). Comments (0.27.0, migration 011) are being built in parallel and **merge before 3a**, so 012 lands after 011.

Read first:
- design-envs.md (decisions 1 to 7, and the lead's list)
- design-envs-1b.md §0 (anchor grammar, ItemRow)
- design-envs-2a.md §0 and §5 (the DesignEdit pattern, `prepareOps`)
- DESIGN-IMPORT.md §6 and §7(f) (the plan's `links`)
- Mockup `design/mockups/design-env.html`, approved frames: **2** (map, component level), **3** (subsystem level) and **12c** (subsystem bands)
- Bugs #50 and #51 with their lead decisions

Three sequential parts. Each has its own worktree, QA pass and merge:
- **3a backend (0.28.0)**
- **3b UI (0.28.1)**
- **3c flow-to-flow links, #50 (0.28.2)**: backend and UI. Its table is created by 012 now, so 3c needs no migration.

Rules for every part:
- Files ≤ 250 lines (tests ≤ 350, `npm run check:size`).
- core/ stays pure.
- No dependencies.
- `npm run preview` keeps working.
- Golden traceHash stays byte-identical: core/trace.ts and the prod samples are untouched, and no trace gains a field.

> **Maintainer override (2026-10-21, night): a component belongs to exactly ONE subsystem.** `alsoIn` (#51) is
> dropped everywhere in this spec. Ignore every `alsoIn` item below: no field, no read fallback, no roll-up "via
> also", no form control. Q1 in §13 is void. The rules instead:
> - **Prevent the second:** a single request (plan import, ops batch, Mermaid import) that gives one component two
>   different subsystems is refused with 422 `TWO_GROUPS` (it names the component and both paths). A plan entry
>   carrying `details.alsoIn` is refused the same way, and the message says to pick one.
> - **Changing it moves it:** a component edit with a new `groupPath` replaces the old one. The edit form shows the
>   current subsystem and, when changed, the text "Moves <name> from <old> to <new>". The draft lists it as a change
>   on the component ("subsystem: Network → Platform") and on both `grp:` boxes.
> - A subsystem key referenced by no component and no settings row is simply absent.

## 0. Ground rules
- **Hierarchy.** Env › Subsystem › Domain (later) › Component.
  - A group key is a path (`platform`, later `platform/identity`).
  - **The subsystem of a component is the first segment of its `groupPath`** (`topOf`, already in web/js/views/flow-list-filter.js; it moves to core).
  - Path keys (domains) roll up into their top segment. A top segment with no settings row is a *derived* subsystem, labelled with its key.
- **Membership (#51).** `groupPath` stays primary: it decides where the component is drawn and which roll-up line its calls count in. `alsoIn: string[]` holds secondary group paths. They are used:
  - for filters (Flows list, Inventory, map),
  - for the box lists and box totals of the subsystem level,
  - never for drawing lines, so each call is counted once.
- **Abstract links are design content.** They are written only through drafts in design envs. Sealed envs have none.
  - The subsystem level and the bands are read-only views and work in every env that has a `groupPath`.
- **Subsystem settings:**
  - Design env: through a draft (structural, because `NO_GROUP` and the roll-up depend on them).
  - Sealed env: label, icon and order are an annotation written at once.
  - Level names: an annotation on every env.
- **Marks work at every level.**
  - `grp:` (subsystem) and `link:` (abstract link) are ordinary anchors in the diff.
  - Roll-up lines take their marks from the calls under them; nothing is stored for a roll-up.
- **Every write is ops** through `appendOps` (all or nothing, newer edit wins). The builders are pure core, so REST, MCP and the preview build the same ops.

---------------------------------------------------------------------------------------------------------------------
# Part 3a: backend (0.28.0)

## 1. Data model

### 1.1 Anchor grammar (core/anchors.ts, additions only; existing anchors unchanged)
| Anchor | Row (`service`, `list`, `key`) | Item |
|---|---|---|
| `grp:<path>` | `''`, `subsystem`, `<path>` | a subsystem's settings `{label, icon?, order}` |
| `link:<id>` | `''`, `link`, `<id>` | an abstract link |
| `rel:<id>` | `''`, `flowrel`, `<id>` | a typed flow-to-flow link (3c) |

- `parentOf` returns null for all three.
- `anchorOfRow` and `rowOfAnchor` learn the three lists.
- `item-rows.ts` documents them and exports `DESIGN_LISTS = ['subsystem', 'link', 'flowrel']`.
- `rowsToModel` and `rowsToExtras` ignore them, as they do any unknown list.

**Why `grp:` / `link:` and not `sub:` / `slink:`:** DESIGN-IMPORT.md §6–7, the sample plan and the live draft `sase-hld/hld-import` already use `grp:<key>` and `link:<id>`. Changing them would break importers that follow the guide.

### 1.2 Shapes
```ts
// core/subsystems.ts
export const SUBSYSTEM_ICONS = ['platform', 'agent', 'network', 'cloud', 'shield', 'database'] as const;   // frame 12c
export type SubsystemIcon = typeof SUBSYSTEM_ICONS[number];
export interface SubsystemRowData { label: string; icon?: SubsystemIcon; order: number }   // envs.groups entry {key, label, icon?}, order = index
export interface SubsystemInfo {
  key: string; label: string; icon: SubsystemIcon | null; order: number;
  derived: boolean;                                  // no settings row: a groupPath names it
  components: { name: string; kind: string; primary: boolean }[];   // primary: groupPath; else alsoIn
}
// core/abstract-links.ts
export interface LinkData {
  name: string;                                      // 1..200
  from: string;                                      // grp:<path> | svc:<s> | egr:<s>/<id> | ing:<s>/<id> (the flow that makes the call)
  to: string;                                        // grp:<path> | svc:<s> | ing:<s>/<id>
  mode?: 'sync' | 'async'; transport?: Transport | null; description?: string; doc?: unknown;
  refinedBy?: { service: string; egress: string }[];  // the concrete calls that realise it (≤ 20)
}
export interface LinkEnd { anchor: string; level: 'subsystem' | 'component' | 'endpoint'; subsystem: string; service?: string; item?: string; missing?: true }
export interface AbstractView {
  id: string; name: string; from: LinkEnd; to: LinkEnd; mode?: Mode; transport?: Transport | null; description?: string;
  state: 'abstract' | 'partial' | 'ready' | 'refined' | 'broken';
  problems: string[];                                // "pop-edge no longer exists", "out.x no longer reaches Platform"
  refinedBy: { service: string; egress: string; to?: { service: string; ingress: string } }[];
  line?: string;                                     // the RollLine id the refinement counts in (state refined)
}
```

The five states:
- **abstract**: both ends are subsystems.
- **partial**: at least one end is a component or endpoint.
- **ready**: both ends are endpoints, but no call realises the link.
- **refined**: `refinedBy` is non-empty and every refining call exists and reaches the `to` end's scope.
- **broken**: an end is missing, or a refining call is gone or reaches nowhere. The link shows again as abstract, with `problems`.

Item `data` of the other two lists:
- `subsystem` rows: `SubsystemRowData`.
- `flowrel` rows: `{from: 'flow:<s>/<i>', to: 'flow:<s>/<i>', type, note?}`.
- Component headers gain a top-level `alsoIn?: string[]`. `schema/manifest.schema.json` gets `service.alsoIn`: an array of path-pattern strings, unique, ≤ 20 items. The samples change with it.

### 1.3 Migration `server/db/migrations/012_subsystems.sql` (additive, Postgres-portable)
```sql
-- 0.28.0 phase 3. Additive: two tables, one column; nothing is rebuilt. JSON is TEXT, times ISO TEXT (as 005).
--   envs.groups (unchanged column) keeps the subsystem settings: [{key, label, icon?}] in display order.
--   envs.baseline_groups: the subsystems a design started with (its baseline for grp: marks), frozen at copy time.
--     Existing designs take their current groups (they were chosen at creation and never edited before 0.28).
ALTER TABLE envs ADD COLUMN baseline_groups TEXT;
UPDATE envs SET baseline_groups = groups WHERE kind = 'design';

-- Links drawn at subsystem level (anchor link:<id>), written by an applied draft. Ends are anchors (grp:, svc:, egr:, ing:).
CREATE TABLE abstract_links (
  env         TEXT NOT NULL,
  id          TEXT NOT NULL,
  name        TEXT NOT NULL,
  from_ref    TEXT NOT NULL,
  to_ref      TEXT NOT NULL,
  mode        TEXT CHECK (mode IS NULL OR mode IN ('sync', 'async')),
  transport   TEXT,                                   -- NULL = not decided
  description TEXT,
  doc         TEXT,                                   -- JSON provenance from a plan
  refined_by  TEXT NOT NULL DEFAULT '[]',             -- JSON [{service, egress}]
  author      TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (env, id)
);

-- Typed links between two flows of one environment (anchor rel:<id>; used from 0.28.2, #50).
CREATE TABLE flow_relations (
  env          TEXT NOT NULL,
  id           TEXT NOT NULL,                         -- 'r' + hash of from|to|type (core/flow-relations.ts)
  from_service TEXT NOT NULL, from_ingress TEXT NOT NULL,
  to_service   TEXT NOT NULL, to_ingress   TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('contradicts', 'variant-of', 'supersedes', 'same-topic')),
  note         TEXT,
  author       TEXT,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (env, id)
);
CREATE INDEX flow_relations_from ON flow_relations (env, from_service, from_ingress);
CREATE INDEX flow_relations_to   ON flow_relations (env, to_service, to_ingress);
```

Why each choice:
- **Settings stay in `envs.groups`.** It already holds key, label and order and is served by `/api/envs/meta`. A new table would duplicate it, and migrating JSON into rows needs SQL JSON functions, which are not portable.
- **The baseline is a column copy** (`baseline_groups = groups`), which is portable.
- **`alsoIn` needs no SQL rewrite.** The live DB has 0 headers or ops with `alsoIn`. Reads fall back to `details.alsoIn` (§2.1), and the plan import converts it (§4.3).

## 2. Core (pure)
| File | Lines | Exports |
|---|---|---|
| core/subsystems.ts | N ~90 | `SUBSYSTEM_ICONS`; `topOf(path)`; `alsoInOf(svc)` = unique tops of `svc.alsoIn ?? svc.details?.alsoIn` (strings only), minus the primary top; `membershipOf(services): {primary: Map<svc, top \| ''>; also: Map<svc, string[]>}`; `subsystemsOf(rows: ItemRow[] /* subsystem rows */, services: Service[]): SubsystemInfo[]` (settings in `order`, then derived tops alphabetically) |
| core/subsystem-rollup.ts | N ~150 | `rollUp(g, subs: SubsystemInfo[], links: ItemRow[]): SubsystemMap` (§2.2); WeakMap memo per (graph, rows) |
| core/abstract-links.ts | N ~130 | `checkLink(id, data, rows): {code, message, field?}[]`; `endOf(anchor, rows, m): LinkEnd`; `linkViews(g, rows, m): AbstractView[]`; `inside(outer, inner, m): boolean` (scope: `grp:X` ⊇ `svc:Y` when Y's primary or alsoIn top is X; `svc:Y` ⊇ `ing:Y/*`, `egr:Y/*`) |
| core/link-suggest.ts | N ~60 | `suggestRefinements(view: AbstractView, map: SubsystemMap, g): Suggestion[]`, at most 5. `Suggestion = {use?: {service, egress}, from?: string, to?: string, reason: string}`. Order: existing calls from the `from` scope to the `to` scope with the same mode, then the same transport, then the rest; then components of an open end that have no calls. `reason` is a sentence like "pop-edge already calls auth-svc over http (POST /token)" |
| core/edit-subsystems.ts | N ~150 | `subsystemOps`, `abstractLinkOps`, `refineOps` (§4.1); uses `callOps` from edit-calls.ts |
| core/edit-kit.ts | C +14 | the `DesignEdit` union gains the kinds of §4.1; `component` gains `alsoIn?: string[] \| null` |
| core/edit-forms.ts | C +8 | `componentOps` writes `alsoIn` at the top level and drops `details.alsoIn`; `deleteOps` accepts `grp:`, `link:`, `rel:` |
| core/design-edit.ts | C +4 | dispatch for the new kinds |
| core/design-rules.ts | C +40 | groups come from the `subsystem` rows of `after` (an argument when the env has none: sealed callers); `NO_GROUP` also for each `alsoIn`; `BAD_ALSO_IN` (an `alsoIn` that is the primary); `GROUP_IN_USE` (a deleted `grp:` still named by a header's groupPath top / `alsoIn` or a link end; checked over `after`, so a request that moves the components and deletes the subsystem passes); `checkLink` for every link upsert of the request; `BAD_ICON`, `BAD_KEY` (pattern of the manifest's groupPath) for subsystem upserts. Needs the request's deletes too: new arg `deleted: {service, list, key}[]` |
| core/diff/subsystems.ts | N ~80 | `subsystemMarks(base: Side, cur: Side, marks: Map<anchor, MarkInfo>): Map<anchor, MarkInfo>` (§2.3) |
| core/diff/index.ts | C +3 | runs `subsystemMarks` after `rollUp` |
| core/diff/normalise.ts | C +3 | `HEADER_DROP` gains `alsoIn` (membership is shown on `grp:`, like groupPath); `normItem('subsystem')` drops `order` (reordering is not a design change) |
| core/diff/propagate.ts | C +3 | `CATEGORY` gains `grp → subsystems`, `link → links`, `rel → relations`; `counts` gains those keys (additive) |
| core/diff/source-now.ts | C +4 | baseline rows of `DESIGN_LISTS` pass through as they are (the source never has them), so a design-made link is New against both baseline and source |
| core/draft-manifests.ts | C +1 | `SIDE` gains `DESIGN_LISTS` (no manifest is ever built for service `''`) |
| core/import-plan.ts → + core/import-plan-links.ts | C −10 / N ~90 | `planLinks(p.links, rows, cx): {ops, warnings, counts: {abstract, flow, skipped}}`; `planGroups(p.environment?.groups, rows)` (subsystem ops for keys the env lacks); `fixAlsoIn(header, counter)` (`details.alsoIn` → `alsoIn`) |
| core/inventory.ts | C +1 | service rows carry `alsoIn` when set |

### 2.1 `alsoIn` (#51)
- **Read** everywhere through `alsoInOf(svc)`. It returns `svc.alsoIn`, else `details.alsoIn`; strings only, deduped, mapped to tops, without the primary top.
- **Write** (component form, plan import): the builders write `alsoIn` at the top level and remove `details.alsoIn`.
- **Validation:** each entry is a subsystem key (`NO_GROUP`) and is not the primary (`BAD_ALSO_IN`). A sealed header from a harvester is stored as sent; the schema now allows the field.

### 2.2 Roll-up algorithm (`rollUp`)
```ts
interface RolledCall { from: { service: string; egress: string }; to: { service: string; ingress: string }; bindKey: string; via: string[] }
interface RollLine { id: string /* `${from}>${to}|${transport}|${mode}` */; from: string; to: string; transport: Transport; mode: Mode; count: number; calls: RolledCall[]; links: string[] }
interface SubsystemBox extends SubsystemInfo { internal: number; out: number; in: number; dangling: number; viaAlso: { in: number; out: number } }
interface SubsystemMap { boxes: SubsystemBox[]; lines: RollLine[]; abstract: AbstractView[]; notSet: boolean }
```
Steps:
1. **Membership.** `m = membershipOf(g.model.services)`, O(S). Components with no group form the box `''` ("Not set"). It exists only when it has a component that calls or is called (`notSet`).
2. **Calls.** For each egress `e`, for each `d` of `downstreamIngress(g, egress e)`:
   - `A = m.primary(e.service)`, `B = m.primary(d.ingress.service)`.
   - `transport = bindKey starts with 'amqp-rpc:' ? 'rpc' : e.transport`. This is the same rule as system-graph.ts.
   - `mode = e.mode ?? (d.via.length ? 'async' : 'sync')`.
   - If `A === B`: `box(A).internal++`. Otherwise add to line `(A, B, transport, mode)`, then `box(A).out++` and `box(B).in++`.
   - Each secondary pair (a top in `alsoIn` of either side, different from the primaries) increments `viaAlso` only.
   - An egress with no downstream adds to `box(A).dangling`.
3. **Abstract links.** `linkViews(g, rows, m)`. For each refined view, its id is pushed onto the `links` of the line that holds its refining calls, and `view.line` is set.
4. **Order.** Boxes in settings order, then derived ones, then `''`. Lines sorted by (from order, to order, transport, mode). Calls sorted by (from.service, egress).

Cost:
- O(S + E + P + L·R): S services, E egress, P resolved (egress, ingress) pairs, L links, R refinements per link (≤ 20).
- **On the 100-service mock** (`generateMock({services: 100, seed: 7})` with groupPath = team): 103 services, 2,077 egress, P = 2,530, 26 subsystems, 799 lines. A prototype of steps 1 and 2 measured **~15 ms** warm on this box.
- Do **not** call `systemGraph`: it takes ~450 ms on the same graph (`eventReport` per channel).
- The result is memoised per graph in a WeakMap, keyed by the subsystem and link rows array. The server memo is `sub:<env>|<draft>`, deps `[env]`.

### 2.3 Marks at the subsystem level (`subsystemMarks`)
`rawMarks` already marks `grp:` and `link:` rows (new, changed or removed, with ghosts), because they are ItemRows. `subsystemMarks` adds the derived marks. For each top key in `cur` (settings rows ∪ groupPath tops):
- **New**: the row is new; or every component whose primary is the key is marked New (at least one). The phrase is `whole subsystem new`.
- **Changed**, if not new: any of these holds:
  - a member component is New, Changed or Removed;
  - membership moved (a header's primary top or `alsoIn` differs from base);
  - a link with an end in the subsystem is marked;
  - the row's label or icon changed.

  `what` lists the parts, for example `3 new, 2 changed components · moved in: sxdns · +1 link · label`.
- **Removed**: from `rawMarks` (a ghost with the old label).

Reordering never marks, because `order` is dropped. `counts.subsystems` and `counts.links` are filled.

Roll-up lines carry no stored mark. `lineMark(line, marks)` lives in core/subsystem-rollup.ts and is used by the UI:
- **new** when every call's `egr:` is New;
- **changed** when some call's `egr:` is New or Changed, or a Removed ghost egress of the pair exists.

**Baseline of subsystems.** `baselineRows(db, env)` appends `subsystem` rows parsed from `envs.baseline_groups`, with `sourceEnv` = the env's source (or itself for a Blank copy), `sourceVersion: null` and `takenAt` = copied_at. When the column is NULL there are none.

## 3. Server
| File | Lines | Change |
|---|---|---|
| server/store/item-rows.ts | C +25 | `envItemRows` also emits `subsystem` rows (from `envs.groups`, `order` = index), `link` rows (from `abstract_links`) and `flowrel` rows (from `flow_relations`); `baselineRows` appends the `baseline_groups` rows (§2.3) |
| server/store/design-side.ts | N ~80 | `writeDesignSide(db, env, side: NetOp[], by)`: `subsystem` ops rebuild `envs.groups` (upsert replaces by key or appends; delete drops; then stable sort by `data.order`); `link` ops into `abstract_links` (upsert / delete); `flowrel` ops into `flow_relations` (3c uses it; the code is in 3a) |
| server/store/draft-side.ts | C +2 | skips `DESIGN_LISTS` (design-side.ts writes them) |
| server/store/draft-apply.ts | C +2 | calls `writeDesignSide` after `writeSide` |
| server/store/drafts.ts, draft-import.ts | C | `prepareOps` no longer gets `groups` from `envs.groups`: `designIssues` reads them from the overlay's `subsystem` rows (equal today; a subsystem added in the same draft now counts); `import-level` gets the overlay's keys too |
| server/store/draft-validate.ts | C +12 | `check()`: `subsystem` (data `{label 1..80, icon?, order?}`, key = path pattern), `link` (`checkLink`), `flowrel` (shape only in 3a) |
| server/store/envs.ts | C +4 | `EnvGroup.icon?`; `TABLES` gains `abstract_links`, `flow_relations`; `getEnv` meta `groups` carries `icon` (additive) |
| server/store/env-copy.ts, env-copy-rows.ts | C +15 | create writes `baseline_groups = groups`. Full copy of a design: `baseline_groups` = the source's `baseline_groups`, and the source's `abstract_links` (+ `flow_relations`) are copied as they are, with their baseline rows kept through `copyAllBaseline`. Full copy of a sealed env, Blank and Components: no links |
| server/store/subsystem-settings.ts | N ~60 | `putSealedSubsystems(db, env, list: {key, label, icon?}[])` (sealed only: design → 409 `USE_DRAFT`; keys pattern, labels 1..80, icons from the set; unknown keys allowed, they label future groupPaths); `putLevels(db, env, levels)` (any kind; 1..4 names, ≤ 40 characters each) |
| server/store/draft-plan-links.ts | N ~45 | `replanLinks(db, env, slug, {from?: slug, author, byAi})`: the stored `drafts.plan.links` of `from` (default: this draft) through `planLinks` → `appendOps`; ops whose item already equals the overlay are skipped (`NO_CHANGE` when none is left) |
| server/draft-reader.ts | C +12 | `DataReader.subsystemRows(): ItemRow[]`, `linkRows(): ItemRow[]` (db: from the tables; draft: from the overlay rows) |
| server/subsystems-read.ts | N ~70 | `subsystemsFor(ctx, env, draft)`, `subsystemMapFor(ctx, env, draft)` (memo `sub:<env>\|<draft>`, deps `[env]`), `linkViewFor(ctx, env, draft, id)` (+ suggestions) |
| server/routes/subsystems.ts | N ~70 | the routes below |
| server/mcp/tools/subsystems.ts | N ~70 | the tools below; `tools/index.ts` C |
| server/routes/draft-edits.ts | C +6 | `POST …/drafts/:slug/plan/links` |
| schema/manifest.schema.json | C | `service.alsoIn` |

### 3.1 REST (every GET takes `?draft=` through `ctx.view`)
| Method | Path | Body / query → result |
|---|---|---|
| GET | `/api/envs/:env/subsystems` | `{levels: string[], subsystems: SubsystemInfo[], notSet: string[]}` (any env; sealed: derived from groupPaths plus any settings) |
| GET | `/api/envs/:env/views/subsystems` | `SubsystemMap` |
| GET | `/api/envs/:env/abstract-links?subsystem=` | `AbstractView[]` (only those with an end in `subsystem`, when given) |
| GET | `/api/envs/:env/abstract-links/:id` | `AbstractView & {suggestions: Suggestion[]}`; 404 unknown id |
| PUT | `/api/envs/:env/subsystems` | sealed only: `{subsystems: [{key, label, icon?}], author?}` in display order → `{subsystems}`; design → 409 `USE_DRAFT` ("edit subsystems through a draft") |
| PUT | `/api/envs/:env/levels` | `{levels: string[]}` (any env) → `{levels}`; 422 `INVALID` |
| POST | `/api/envs/:env/drafts/:slug/plan/links` | `{from?: slug, author?}` → 201 `{from, to, counts, links: {abstract, flow, skipped}, warnings}`; 409 `NO_CHANGE`, `DRAFT_CLOSED`, `ENV_SEALED`; 404 `from` |
| POST | `/api/envs/:env/drafts/:slug/edits` | unchanged route; new kinds §4.1 |

The `GET /marks` result gains `grp:` and `link:` anchors and the `counts.subsystems` and `counts.links` keys (additive). `GET /api/envs/meta` groups gain `icon`.

### 3.2 MCP
- **Reads:**
  - `get_subsystems {env, draft?}`
  - `get_subsystem_map {env, draft?}`
  - `list_abstract_links {env, draft?, subsystem?}`
  - `suggest_refinements {env, id, draft?}`. The description says: these are existing calls between the two ends; pick one with `refine-link` `use`, or make a call with `refine-link` `call`.
- **Writes:**
  - `edit_design` (its description lists the new kinds).
  - `apply_plan_links {env, draft, from?}`.
  - `set_subsystem_settings {env, subsystems, draft?}`: sealed → the PUT; design → requires `draft` and becomes `subsystem` edits (like `set_flow_name`).
  - `set_levels {env, levels}`.
- `tests/mcp-tools.test.ts` pins the names, descriptions and schemas.

### 3.3 Guards (tests/env-guard.test.ts lists)
- **DRAFT** gains `POST …/drafts/:slug/plan/links`.
- **EXEMPT** gains `PUT …/subsystems` (sealed only; it refuses design with `USE_DRAFT`, never writes one) and `PUT …/levels`.
- **MCP_READ** gains `get_subsystems`, `get_subsystem_map`, `list_abstract_links`, `suggest_refinements`.
- **MCP DRAFT** gains `apply_plan_links`.
- `set_subsystem_settings` and `set_levels` are exempt annotations.
- Harvester ingest into a design env stays 409 `ENV_DESIGN`.

## 4. Edits and plan import

### 4.1 New `DesignEdit` kinds (core/edit-kit.ts; one union for the UI, REST, MCP and the preview)
```ts
| { kind: 'subsystem'; key: string; label?: string; icon?: SubsystemIcon | null; order?: number }
| { kind: 'abstract-link'; id?: string; name: string; from: string; to: string; mode?: Mode | null; transport?: Transport | null; description?: string; refinedBy?: null }
| { kind: 'refine-link'; id: string;
    from?: string; to?: string;                          // narrow an end to an anchor inside it
    use?: { service: string; egress: string };           // an existing call realises it
    call?: Omit<CallEdit, 'kind'> }                       // a new call realises it (the call builder makes it)
// component gains alsoIn?: string[] | null; delete accepts grp:, link:, rel:
```

- **subsystem**
  - Upserts `grp:<key>` `{label, icon?, order}`.
  - The key is immutable: changing the label is the rename.
  - A new key needs a label (`INVALID`, field `label`). `icon: null` clears it.
  - `order: n` moves the subsystem to position n, and the builder upserts every row whose index changes.
- **abstract-link**
  - Upserts `link:<id>`. `id` defaults to `unique(slug(name))` among the link rows; the pattern is `^[a-z0-9][a-z0-9-]{0,62}$` (`BAD_NAME`).
  - Existing fields are kept: `doc` and `refinedBy`. `refinedBy: null` clears the refinement.
- **refine-link**
  - Needs an existing link (`NO_ITEM`).
  - **`from` / `to`**: the new end must be inside the current one (`NOT_INSIDE`), with one exception: when the current end is missing, any end is accepted.
  - **`use`**: the call must exist and reach the `to` scope (`NOT_INSIDE`, field `use`). It sets `refinedBy = [use]`, `from = egr:<s>/<egress>`, and `to = ing:<…>` of the call's first downstream ingress.
  - **`call`**: the ops of `callOps(call)` come first, then the link upsert with `refinedBy = [{service: call.from.service, egress: <the egr: upsert of those ops>}]` and the ends set to that egress and ingress. A `call.to` of `{bindKey, transport}` (not designed yet) is refused with `REFINE_DANGLING`.
  - `use` and `call` are mutually exclusive (`INVALID`).
- **delete `grp:`**: `GROUP_IN_USE` while anything names the subsystem. The error details list the components and links.

Errors (422, `field` set): `BAD_NAME`, `BAD_KEY`, `BAD_ICON`, `NO_GROUP`, `BAD_ALSO_IN`, `GROUP_IN_USE`, `NO_END`, `BAD_END` (a `to` of kind `egr:`, a `from` of kind `rel:`…), `SAME_END`, `NOT_INSIDE`, `REFINE_DANGLING`, `NO_ITEM`, `INVALID`, plus the existing codes.

### 4.2 `checkLink` rules
- `name` 1..200.
- `from` ∈ grp/svc/egr/ing; `to` ∈ grp/svc/ing (`BAD_END`).
- Each end exists in the rows: a `grp:` key must be a subsystem row or a groupPath top (`NO_END`).
- `from ≠ to` (`SAME_END`). Both ends in the same subsystem are allowed only when at least one end is a component or endpoint.
- `mode` ∈ sync | async | absent.
- `transport` is a Transport value or null.
- `description` ≤ 4000.
- `refinedBy` ≤ 20 entries, each an existing egress (`NO_END`).

### 4.3 Plan import mapping (core/import-plan-links.ts, called by `planToOps`)
- **`environment.groups`**: keys the env (with the draft) lacks become `subsystem` upserts, appended after the env's, with `icon` when given and valid. A different label for a known key gives a warning; the env's label is kept. This replaces today's "differ" warning.
- **`links[i]`**, taken in order:
  - **Abstract link**: both ends are `grp:` / `svc:` / `ing:` (or `egr:` as from) and there is no `type`. It becomes `link:<id ?? slug(name)>` with `{name, from, to, mode?, transport?, description?, doc?}`, checked by `checkLink`. An error becomes a warning (`links[i]: …`) and the entry is skipped, so a plan with one bad link still imports.
  - **Flow relation**: both ends are `flow:` anchors (or `{service, ingress}`) and there is a `type`. In 3a it is counted as `skipped` with the warning "flow relations land in 0.28.2"; 3c maps it.
  - **Anything else**: a warning and `skipped`.
- **`details.alsoIn`** on a manifest header or an extension → top-level `alsoIn`, with one warning that gives the count (like `fixUndecided`). `extensions[i].alsoIn` is accepted like `groupPath`.
- **Result:** `PlannedOps` gains `links: {abstract, flow, skipped}`, and `skipped.links` now counts only the links not applied. API.md notes the change of meaning.
- **Drafts imported before 0.28:** `POST …/plan/links` (or MCP `apply_plan_links`) re-reads their kept `plan.links`. This is how the live `sase-hld/hld-import` gets `usage-metering`.

## 5. Preview (3a)
- `web/js/api-local-subsystems.js` (N ~110) is composed by `api-local-design.js` (+5): subsystems, views/subsystems, abstract links (+ suggestions), the sealed PUT and PUT levels in memory, all with the same core.
- The new edit kinds go through `designEditOps` in `api-local-edits.js` unchanged. Its `designIssues` call gets the overlay rows.
- `build-preview.ts` needs nothing new: `envItemRows` and `baselineRows` now carry the design lists. Apply stays refused.

## 6. Tests (3a)
Existing assertions change only where listed, with the reason in the commit.

1. **subsystem-rollup.test.ts** (pure):
   - The sase-hld + hld-import overlay gives the hand fixture: lines agent→network socket, network→platform http (+count), and so on.
   - On 100 mock services (groupPath = team), lines equal a brute force built from `systemGraph(g).collapsedEdges`, grouped by (top(from), top(to), transport, mode). Counts and the set of (egress, ingress) pairs match, and internal counts match.
   - `amqp-rpc:` → rpc; dangling egress counted on its box; the Not set box appears only with calls.
   - `alsoIn` adds `viaAlso` and no line.
   - Order is deterministic.
   - Warm call < 100 ms on the mock (2-vCPU slack).
2. **abstract-links.test.ts** (pure):
   - Every `checkLink` code.
   - `endOf` levels, `inside`.
   - States: abstract, partial, ready, refined (id on its line), broken (refining egress deleted → shown again with a problem; end component deleted → `missing`).
   - `suggestRefinements` on sase-hld: `usage-metering` (network→platform) lists pop-edge→auth-svc, async first when the link is async.
3. **edit-subsystems.test.ts** (pure + `prepareOps`):
   - subsystem upsert / label / icon / `icon: null`; order emits only the moved rows.
   - `BAD_ICON`, `BAD_KEY`.
   - Delete: `GROUP_IN_USE` (groupPath, alsoIn, link end), and it passes when the same request moves the component.
   - `NO_GROUP` accepts a subsystem added earlier in the same request.
   - component `alsoIn` (`BAD_ALSO_IN`, `NO_GROUP`, `details.alsoIn` dropped).
   - abstract-link id uniqueness; `BAD_NAME`, `SAME_END`.
4. **refine-edit.test.ts** (pure):
   - Narrowing (`NOT_INSIDE`; grp→svc via alsoIn allowed).
   - `use` → `refinedBy` + ends.
   - `call` → ops = egress + function step (+ endpoint when new) + link upsert, all in one request; then `linkViews` says refined.
   - `REFINE_DANGLING`; `use` + `call` → `INVALID`.
5. **diff-subsystems.test.ts** (pure):
   - New row → grp new; all components new → grp new `whole subsystem new`.
   - Moved component → changed `moved in: x`; label change → changed; reorder → no mark; delete → removed ghost.
   - `link:` new / changed (refined) / removed.
   - against=source: design lists pass through, so a new link is New against both.
   - `counts.subsystems` / `counts.links`.
   - `alsoIn` on a header alone gives no `svc:` mark, but marks the grp.
6. **import-plan.test.ts** (extend):
   - The sase plan's `usage-metering` becomes one `link:` op.
   - A bad link becomes a warning and is skipped, and the rest imports.
   - A flow-shaped entry is skipped with the 0.28.2 warning.
   - `details.alsoIn` becomes `alsoIn` with a warning; extension `alsoIn`.
   - Missing `environment.groups` keys become subsystem ops; a label clash becomes a warning.
7. **subsystems-api.test.ts** (`startApp()`):
   - GET subsystems on prod (derived, none) and sase-hld (settings + draft overlay); views/subsystems with and without `?draft=`; abstract-links list and `:id` with suggestions.
   - Edits → apply: `envs.groups` gets the icon and order, `abstract_links` rows are written, `/api/envs/meta` shows the icon; after apply, marks against baseline keep the link New and show no grp mark after a reorder.
   - PUT subsystems sealed ok / design 409 `USE_DRAFT`; PUT levels.
   - `plan/links` on hld-import (201, then `NO_CHANGE`); with `from` = an applied draft.
   - deleteEnv drops links; Full copy of a design copies links and `baseline_groups`; Components copy doesn't.
   - MCP tools give the same results (`by_ai = 1` on writes).
8. **draft-manifests.test.ts** (extend): a draft with only design-list ops builds no manifest and no `service ''` delta; **item-rows.test.ts**: `rowsToModel(envItemRows)` still deep-equals `loadModel` with subsystem and link rows present.
9. **env-guard.test.ts** and **mcp-tools.test.ts**: the lists in §3.3.
10. **migrations-012.test.ts**:
    - An 011 DB (design env with groups, sealed env) → 012: `baseline_groups` = `groups` for the design, NULL for the sealed; both tables exist; `.pre-012.bak` has no column; a link row can be stored.
    - **Live copy** (`tests/migrations-012-live.test.ts`, skipped unless `FLOW_LIVE_COPY=<path>`). QA makes the copy from a read-only connection with `VACUUM INTO` into the scratchpad, never into `data/`. Checks:
      - per-table row counts are unchanged;
      - `baseline_groups` of sase-hld and behaviour-demo equals their groups;
      - `/marks?draft=hld-import` on the copy has `grp:agent` new (only sase-agent, new) and `grp:network` / `grp:platform` changed;
      - every pre-existing anchor mark is unchanged.
11. **trace-golden.test.ts**: unchanged (no fixture edit).
12. **preview-design.test.ts** (extend): api-local subsystems, map, links and suggestions equal the server's for sase-hld + hld-import; the new edit kinds work in memory; apply is refused.

## 7. Demo, docs, version (3a)
**`samples/envs/sase-hld.json`:** groups gain `icon` (agent → `agent`, network → `network`, platform → `platform`).

**`samples/envs/sase-hld.plan.json`:**
- `links` gains `push-config-update` (`grp:platform` → `grp:agent`, async, "Platform pushes tenant config updates to agents").
- The `sxdns` extension gains `alsoIn: ["platform"]`, for #51.
- Counts that other suites assert for hld-import move by the new ops (reason in the commit).

**DEMOS.md rows** (API until 3b):
- `/api/envs/sase-hld/views/subsystems?draft=hld-import`
- `/api/envs/sase-hld/abstract-links/usage-metering?draft=hld-import` (state abstract, suggestions)
- `/api/envs/sase-hld/subsystems?draft=hld-import` (sxdns also in Platform)
- On the live server after deploy: `POST /api/envs/sase-hld/drafts/hld-import/plan/links` (or re-seed).

**Docs:**
- API.md: anchors, the Subsystems section, edits, plan `links` / `skipped`, marks keys, errors, `alsoIn`.
- ARCHITECTURE.md: the new files.
- DESIGN.md: why settings live in `envs.groups`, `baseline_groups`, primary vs alsoIn, why a refined link is kept.
- DESIGN-IMPORT.md §6–7: link ends, `alsoIn` at the top level (details.alsoIn still accepted), `apply_plan_links`.
- HARVESTER-GUIDE: `service.alsoIn`.

`package.json` → **0.28.0**.

---------------------------------------------------------------------------------------------------------------------
# Part 3b: UI (0.28.1). Starts after 3a is merged. Frames 2, 3 and 12c are the approved design.

## 8. Data
- `web/js/api.js` C (+10): `subsystems`, `subsystemMap`, `abstractLinks`, `abstractLink(id)`, `putSubsystems`, `putLevels`, `planLinks`.
- `web/js/design/subsystems-store.js` N ~50: loads `GET /subsystems` once per (env, draft) and answers `subOf(service)` (primary top), `alsoOf(service)`, `info(key)`, `list()`. It is refetched after a designEdit, like marks.

## 9. Components (all ≤ 250; prefixed classes; the app's `.seg`, `.select`, `.check`, `.fgrid`)

### System map
| File | Lines | What |
|---|---|---|
| web/js/views/system.js | C −40 | dispatches on `level=` (URL; default `components`): components → today's canvas, subsystems → `system-subsystems.js`. Toolbar and legend move out |
| web/js/views/system-toolbar.js | N ~80 | level `.seg` "Subsystems · Components · Domains" (Domains disabled, title "Later"); shown when the env has ≥ 1 subsystem (design, or sealed with a groupPath). Subsystem level: "Rolled-up calls", "Abstract links" checks; Edit with a draft: "+ link" button; "Subsystem settings" link |
| web/js/views/system-legend.js | N ~40 | today's legend + abstract link + open end |
| web/js/graph/layout.js | C +15 | option `columnOf: Map<id, index>`: a strong x spring to the column centre (columns in env order, width by member count); y free |
| web/js/graph/graph-regions.js | N ~90 | pure `regionsOf(nodes, pos, subs, marks)` → rects (member bounding box + 28 padding, head room 40) with head "Platform" and the sub line "9 components: 3 new, 6 from prod (2 changed)" (frame 2); `drawRegions(ctx, S)` under the edges; region hit → `onSelect({type:'region', key})` → Inventory `subsystem=<key>` ("Click a region to open its components in Inventory") |
| web/js/graph/graph-abstract.js | N ~70 | abstract links on the canvas: dashed `--ink-2`, open circle at a region edge for a `grp:` end, at the node for svc / egr / ing; label + spark; hit test (graph-hit.js +6) |
| web/js/views/system-subsystems.js | N ~150 | the subsystem level (frame 3): SVG, loads `views/subsystems` + marks, draws through `subsystem-draw.js`, panels on click, the "Open in this design" list under the diagram (`subsystem-open.js`), keyboard: boxes, lines and links are focusable (Tab, Enter opens) |
| web/js/graph/subsystem-layout.js | N ~100 | pure: boxes on a grid (≤ 4 columns, env order, height from the component list, capped at 10 names + "+N more"); line routes between box edges, parallel offset 14px per (pair, transport, mode); more than 6 lines on one pair collapse into "N calls · M transports"; thickness `1.5 + log2(count)`; label positions without overlap |
| web/js/views/subsystem-draw.js | N ~150 | box (`.rg`, title, icon `ss-<icon>`, count line, mark: spark for New; components New, Changed with ring, prod muted (`.old`); inside a New box no per-component sparks, the highest-level rule); roll-up lines (`.ru` in the transport colour, arrowhead, "2 calls · http", "1 async · amqp"; `lineMark`); abstract links (`.abs` dashed with open circle ends `.abs-end`, chip "abstract", spark; partial: the refined end draws into that component's row) |
| web/js/views/subsystem-panel.js | N ~90 | a line: its calls (from › to, bind key, link to the service and the flow) and "includes: <link name> (refined)"; a box: components with "go down" links (`level=components&sel=svc:<s>`), "also here" members in italics with their primary |
| web/js/views/subsystem-open.js | N ~45 | "Open in this design: N abstract links" rows (name, from → to, state chip `abstract` / `partial` / `ready` / `broken`, problem text) |
| web/js/design/link-panel.js | N ~150 | frame 3 aside: chips (mode, "abstract", mark), h3 name, sub "Network (POP) → Platform · drawn at subsystem level", description; **Refine** fgrid (From: subsystem › component select › Via: egress select / "new call"; To: subsystem › component › endpoint / "+ New endpoint"); the suggestion `.info` with "Use <service>" (one per suggestion, at most 3); the note "When both ends have an endpoint, this becomes a call at component level and shows here as part of '…'. Until then it stays abstract and is listed under 'Open in this design'."; Edit / Delete in Edit mode; View mode: read-only + "Open a draft to refine". No discussion block (phase 4) |
| web/js/design/refine-state.js | N ~70 | pure: which selects are enabled, the `refine-link` edit for the choice (narrow, use, or call with `from.fn` = the chosen function, default the component's first entry handler) |
| web/js/design/forms/link-form.js | N ~100 | new / edit abstract link: name, From (subsystem, then optional component), To, mode (sync / async / not set), transport (incl. "Not decided yet"), description; Delete (danger, confirm) |

### Flows (frame 12c)
| File | Lines | What |
|---|---|---|
| web/js/views/flow-bands.js | N ~80 | pure: `groupColumns(columns, subOf)` keeps the first column (caller or client app) first, then the service columns grouped by subsystem in the order each subsystem first appears, stable inside a group; ungrouped components keep their place; topic, queue, unresolved and store columns are untouched. `bandsOf(display columns, subOf, info)` → `[{key, label, icon, from, to, mark}]`; a Squeeze fold whose columns are all one subsystem takes its band, a mixed fold gets no band |
| web/js/views/flow-draw-bands.js | N ~60 | the band row (22px + 6) over the heads: `.band` rect, icon `ss-<icon>` (none: name only), label, spark when `grp:` is New; Edit with a draft: a "+" at the band's end (`data-qa=band-add`) opens the component form with that groupPath (replaces the 2a D5 head-row "+"). The store bands of #62 will reuse this file |
| web/js/views/flow-render.js | C +8 | with "Group by subsystem" on: `groupColumns` before `renderLane` (so Squeeze plans, step geometry and the walk see the final order) and bands passed into the lane |
| web/js/views/flow-draw-layout.js, flow-draw-heads.js | C +6 | `HEAD` grows by the band row when bands are on; heads translate down |
| web/js/views/flows.js | C +6 | toolbar check "Group by subsystem" next to Data stores and Squeeze (localStorage `flow-mapper.bands`, default on); hidden when the env has no subsystem |
| core/colors.ts | C +18 | `declash(order: {name, slot: number \| null}[]): Map<name, number>`: walk in column order; a slot already used earlier in this flow takes the next free slot (cyclic from slot + 1) not used in this flow; past 8 distinct, repeat; never touches the stored assignment |
| web/js/design/component-colors.js | C +12 | `laneSlots(columns)` (calls `declash` with the env slots) and `colVar(c)` (uses `c.slot` when set); flow-render sets `c.slot` on service columns; heads, bars, folds and step-bar dots use `colVar` |

### Settings, forms, filters
| File | Lines | What |
|---|---|---|
| web/js/main.js | C +1 | route `/envs/:name/settings` |
| web/js/views/env-settings.js | N ~140 | "Environment settings" page with two sections. **Subsystems**: a table with key (mono), Name (input), Icon (radio group of the six icons + "None", 16px, each with its name as label), Order (↑ ↓ buttons), Delete (danger; disabled with "used by N components" when in use), "+ Add subsystem" (key + name). **Level names**: an input per level. Design env: Edit mode with a draft, each change is one `designEdit` (toast "Saved to draft <name>"); without a draft, read-only with "Open a draft to change subsystems". Sealed env: one Save → `PUT /subsystems`. Levels save at once (PUT) on every env |
| web/js/icons.js | C +12 | symbols `ss-platform`, `ss-agent`, `ss-network`, `ss-cloud`, `ss-shield`, `ss-database` (from the mockup; stroke `--ink-2`) |
| web/js/components/env-picker.js | C +3 | menu row "Environment settings" |
| web/js/design/forms/component-form.js | C +15 | "Also in" checkbox list (subsystems except the primary) |
| web/js/views/flow-list-filter.js, inventory-subsystem.js | C +6 | a component matches a subsystem when it is its primary or in `alsoIn`; the Component group shows "also in" members in italics |
| web/js/api-local-subsystems.js | — | already in 3a |

**CSS:** `web/css/subsystems.css` (regions, boxes, `.ru`, `.abs`, `.abs-end`, `.band`, the settings table), light and dark.

**UI-GUIDE.md:**
- §2: "Subsystem bands group heads; a band is grey, never a component colour."
- §8: the de-clash sentence from frame 12c.
- §10: "An abstract link is dashed ink with open ends; a refined one disappears into its roll-up line."

## 10. Tests and QA (3b)
- **Pure tests:**
  - `tests/flow-bands.test.ts`: caller first; grouping by first appearance; ungrouped components keep their place; topics untouched; a mixed fold has no band; step keys are unchanged by the reorder.
  - `tests/colors-declash.test.ts`: the prod sample has 59 components; a flow with two on one slot gets distinct slots; stored slots unchanged; 9 distinct → repeat.
  - `tests/subsystem-layout.test.ts`: grid; parallel offsets; collapse past 6 lines; 26 boxes on the mock fit without overlap.
  - `tests/graph-regions.test.ts`; `tests/refine-state.test.ts`.
  - `tests/system-level.test.ts`: when the control shows; default level; the URL.
- **Preview:** `npm run preview`. The subsystem level, the link panel (refine in memory), bands and settings work on bundled rows; apply is refused.
- **Visual** (designer agent, scratch server, seed), at 1440 and 760, light and dark:
  - frame 2: `#/system?env=sase-hld&draft=hld-import`
  - frame 3: `#/system?env=sase-hld&draft=hld-import&level=subsystems`, then click `usage-metering`
  - frame 12c: `#/flows?env=sase-hld&draft=hld-import&tabs=sase-agent/in.tunnel.open`
  - the settings page
  - the 26-box mock: a Full copy of scale-test with groupPath = team (layout must stay readable).
  - Then refine `usage-metering` with "Use pop-edge" in Edit mode and screenshot again: the link leaves the abstract layer, the line says "includes: usage metering", and "Open in this design" drops it.
- **Checklist:** UI-GUIDE §10, plus keyboard on SVG boxes and lines, plus no colour-only meaning (dashed vs solid, chip text).
- Golden traceHash and every 3a suite are unchanged.

## 11. Demo, docs, version (3b)
DEMOS.md rows:
- the frame 2, 3 and 12c URLs above;
- "refine an abstract link": `#/system?env=sase-hld&draft=hld-import&mode=edit&level=subsystems`, click "usage metering", then "Use pop-edge";
- settings: `#/envs/sase-hld/settings?draft=hld-import&mode=edit`, change Platform's icon to Cloud;
- de-clash: a prod flow where it triggers (the implementer finds one; it is also in the unit test).

design/AUDIT.md gets rows for the new page and panels. `package.json` → **0.28.1**. After deploy: re-seed the samples (no `--bugs`) and give the maintainer the links.

---------------------------------------------------------------------------------------------------------------------
# Part 3c: flow-to-flow links, #50 (0.28.2). After 3b; table from 012.
- **core/flow-relations.ts** (N ~80):
  - `REL_TYPES`; `SYMMETRIC = {contradicts, same-topic}` (stored with from < to); `relId(from, to, type) = 'r' + hash53(...)` (from core/description.ts);
  - `checkRelation` (both flows are entry points of the env: `NO_FLOW`; from ≠ to; type in the enum: `BAD_TYPE`; note ≤ 1000);
  - `relationsOf(rows, flow?)` → `{id, type, other: {service, ingress}, direction: 'out' | 'in', phrase}`. Phrases: "contradicts", "is a variant of" / "has a variant", "supersedes" / "is superseded by", "same topic as";
  - aliases for plans: `variant` and `variant_of` → `variant-of`, `same_topic` → `same-topic`.
- **Edits:** `{kind: 'flow-relation', from: {service, ingress}, to: {service, ingress}, type, note?}` and `delete rel:<id>`. A component or endpoint delete also deletes the relations that name it, in the same request (`deleteOps` +6).
- **Plan:** `planLinks` maps flow-shaped `links[]` (from §4.3) instead of skipping them. `apply_plan_links` re-runs them for drafts imported before 0.28.2.
- **REST:** `GET /api/envs/:env/flow-relations?service=&ingress=&type=&draft=` → rows. Design envs only; sealed → `[]`.
- **MCP:** `list_flow_relations {env, service?, ingress?, type?, draft?}` (read); writes go through `edit_design`.
- **Marks:** `rel:` is counted under `counts.relations`.
- **UI:**
  - `web/js/views/flow-relations.js` (N ~110): a "Related flows (n)" section under the description box, above Comments. Chips filter by type (All · Contradicts · Variant · Supersedes · Same topic) and are kept in the URL as `rel=`. Each row: type chip (neutral, text), phrase, other flow's name (opens its tab), note, mark. Edit with a draft: "+ relation" and ×.
  - `web/js/design/forms/relation-form.js` (N ~70): other flow (search the entry points), type, note.
  - The Flows list gets a relation filter (`rel=any|<type>`) and a ⇄ badge per flow (added in 0.28.2 at the lead's decision: it fits #50's "filterable"). The section shows 6 rows then "Show N more" (30vh scroll when open); its type chips are kept as `relType=`.
- **Tests:**
  - flow-relations core: id determinism, symmetric normalisation, aliases, `NO_FLOW` / `BAD_TYPE`;
  - import-plan: flow links mapped, the corev5-style example "22 contradicts" shape;
  - API and MCP: list/filter, apply → `flow_relations` rows, deleteEnv, Full copy;
  - UI pure: filter and phrases;
  - migration: none.
- **Demo:** the sase plan `links` gains `{from: "flow:sase-agent/in.tunnel.open", to: "flow:auth-svc/in.token.device", type: "same-topic"}`. DEMOS row: `#/flows?env=sase-hld&draft=hld-import&tabs=sase-agent/in.tunnel.open` ("Related flows (1)"). `package.json` → **0.28.2**.

---------------------------------------------------------------------------------------------------------------------
## 12. Risks
1. **New lists in `envItemRows`.** Every consumer must tolerate `subsystem` / `link` / `flowrel` rows: draft-manifests (`SIDE`), draft-side, import-level `here`, references, the env copy, source-now, the preview. Grep `envItemRows`, `overlayRows` and `draftView` callers first. Tests 6.8 guard it.
2. **The marks shape grows** (`counts.subsystems/links/relations`, `grp:` / `link:` anchors). Suites that deepEqual counts or mark lists move, with the reason in the commit. The draft bar ignores unknown keys.
3. **The `NO_GROUP` source changes** from `envs.groups` to the overlay. The two are equal until a draft holds subsystem ops; every 2a test must pass unchanged.
4. **hld-import grows** (2 link ops, the sxdns `alsoIn` extension, later a relation). Suites that count its ops or changes move.
5. **The subsystem level at 26 boxes** (mock) can turn into a hairball. Mitigation: grid, collapse past 6 lines per pair, "Rolled-up calls" off shows only links, and a screenshot in QA.
6. **Column reorder in flows** changes crossings and squeeze plans. It runs before `renderLane`, so the walk, step keys and Squeeze see one order (tested). traceHash is unaffected (UI only).
7. **Size:** system.js (177), flows.js (187), flow-render.js (79) and draft-validate.ts (106) grow. The splits are listed; nothing new goes into core/trace.ts.
8. **Live migration:** 012 only adds a column and tables. Dry-run it on a copy (test 10). Restart per CLAUDE.md. Merge after 0.27.0 so 011 comes first.
9. **Abstract links on deleted components** are not blocked; they show as `broken` with the problem. Refusing the delete would make cleanup hard.

## 13. Open questions for the maintainer (recommendation first)
- **Q1. `alsoIn` in roll-ups.** Recommend: roll-up lines count each call once, by primary `groupPath`. `alsoIn` puts the component in the secondary box's list (in italics), adds to that box's in/out totals as "via also", and counts in every filter. The alternative, drawing lines for secondary memberships too, counts each call twice and makes the subsystem level unreadable.
- **Q2. A refined abstract link is kept, not deleted.** Recommend keep. It leaves the abstract layer and folds into its roll-up line ("includes: usage metering"), its name, description and (phase 4) discussion stay, and it comes back as `broken` if the call goes away. DESIGN-IMPORT's "move it into the manifests and delete the link" changes to "refine it".
- **Q3. Subsystem settings in a design env go through a draft**, icons included; in a sealed env they are an annotation written at once; level names are an annotation everywhere. Recommend yes. It keeps "all design writes are drafts", and subsystems drive `NO_GROUP` and roll-ups.
- **Q4. #50 as 3c (0.28.2) after the UI**, with its table already in 012 and its plan entries counted as skipped until then. Recommend yes. 3a and 3b are each L on a small box.

## 14. Lead / architect decisions (no need to ask; override via bug)
1. Anchors `grp:<path>`, `link:<id>`, `rel:<id>` (additions only; `grp:` and `link:` are already in DESIGN-IMPORT and live plans).
2. Settings in `envs.groups` (+`icon`), order = array order; the baseline in `envs.baseline_groups` (a portable column copy); no `subsystems` table.
3. The subsystem key is immutable and the label is the rename. Subsystem level = the first path segment; domains (path keys) roll into it; a top with no settings row is "derived".
4. Reordering subsystems never marks (`order` is dropped in the diff).
5. `alsoIn` is a top-level header field, dropped from the component diff like `groupPath`; membership changes show on `grp:` marks.
6. `alsoIn` migration = a read fallback to `details.alsoIn` plus conversion in the plan import and the forms; no SQL JSON rewrite (live has 0 rows).
7. A subsystem is New when its row is new or every member is New. Inside a New box, components show no spark (highest new level).
8. Link ends: `from` grp/svc/egr/ing, `to` grp/svc/ing. Refining narrows (`NOT_INSIDE`); "Use" picks an existing call; "Make it a call" uses the call builder. A dangling call never refines.
9. No abstract links in sealed envs. The subsystem level, regions and bands work read-only wherever groupPaths exist.
10. Components and Blank copies do not carry links; a Full copy carries links, relations and `baseline_groups`.
11. Drawing a link by drag waits for 2c. 3b has "+ link" on the subsystem toolbar.
12. Bands: subsystems in order of first appearance in the flow, caller first, ungrouped components without a band, a mixed Squeeze fold without one. On by default (per viewer) and hidden when the env has no subsystems. A band shows a spark only for a New subsystem.
13. De-clash per flow in column order, next free slot cyclic, stored colours untouched.
14. Map default stays at component level; `level=subsystems` lives in the URL; Domains is shown disabled.
15. Components with no subsystem get a "Not set" box only when they take part in calls.
16. Drafts imported before 0.28 get their kept plan links through `POST …/plan/links` / `apply_plan_links`. The seed re-imports the plan.
17. Discussions on `link:` and `grp:` wait for phase 4 (0.27.0 comments are flow-anchored). The link panel has no discussion block.
18. 012 creates `flow_relations` now, so 3c needs no migration.

### Critical Files for Implementation
- /home/ubuntu/Flow-Mapper/core/anchors.ts
- /home/ubuntu/Flow-Mapper/server/store/item-rows.ts
- /home/ubuntu/Flow-Mapper/core/design-rules.ts
- /home/ubuntu/Flow-Mapper/core/diff/propagate.ts
- /home/ubuntu/Flow-Mapper/core/import-plan.ts
- /home/ubuntu/Flow-Mapper/web/js/views/system.js
- /home/ubuntu/Flow-Mapper/web/js/views/flow-render.js

## Lead decision on §13 (2026-10-21, night)
Q1 is void (one subsystem per component, see the note at the top). The maintainer approved Q2 to Q4 as recommended
(2026-10-21).
