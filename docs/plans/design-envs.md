# Design environments (HLD): merged implementation plan

Sources (detail lives there): architect.md, techlead.md, developer.md, qa.md, designer.md in this folder.
Spec: design/mockups/design-env.html rev 3 (approved).

## Corrections to the spec, agreed by all five
- **No history today.** `snapshots` keeps one row per service, `entities` is rewritten on every write, the
  changelog keeps keys only. The baseline must be *frozen at copy/import time*: new table `baseline_items`
  (env, service, list, key, data, source_env, source_version, taken_at), loaded through the same row→model code as
  `entities`, so `buildIndex` and the diff work on it unchanged. (A hidden `<env>@baseline` env was considered and
  rejected: it pollutes every env listing and query.)
- **No envs table.** `listEnvs` is `SELECT DISTINCT env FROM snapshots`, so a Blank env would vanish. Migration
  005 adds `envs` and backfills existing envs as `harvested`. `GET /api/envs` keeps returning `string[]` (the
  preview depends on it); metadata comes from `GET /api/envs/meta`.
- **A fresh copy shows no marks** (it equals its baseline) and nothing else can write to a design env, so the
  draft backend has to ship together with the marks.
- **Apply needs full manifests for new components** (delta ingest refuses unknown services), and `tx()` can't nest
  → make it re-entrant with SAVEPOINT. DTOs and schemas live outside manifests: copy, baseline, diff and drafts
  each handle them as a second path.

## Architecture in one screen
- **Marks are a separate endpoint**: `GET /api/envs/:env/marks?against=baseline|source&draft=` returns
  `{anchorKey: new|changed|removed}` (+ "what changed" text). Trace, service view and inventory responses are
  untouched; the UI decorates from the marks. One anchor grammar in `core/anchors.ts`
  (`svc:`, `ing:`, `egr:`, `res:`, `link:`, `dto:…#$.path`, `schema:…#path`) is shared by marks, draft ops and threads.
- **Diff core** (pure, browser-safe): `core/diff/{keys,entities,steps,fields,propagate}.ts`. Steps aligned by
  content, not `seq`. Ignores provenance/version/group noise. Highest-new-level rule in `propagate.ts`.
- **Drafts**: `drafts` + `draft_ops` (whole-item upsert/delete with `base_hash`). Read = env + ops overlaid in
  memory (`core/draft-apply.ts`, pure); cached per draft in an LRU. Apply = conflict check (stop and list) →
  manifests → existing ingest in one transaction → one changelog entry tagged with the draft. AI edits are ops too.
- **Every read route takes `?draft=`** through one `ctx.graphOf(req)` (≈18 route + 18 MCP call sites).
- **Harvested envs read-only for design writes** in one guard in the write path; harvester ingest unchanged;
  ingest into a design env's name is refused (409).
- **Static preview** bundles baselines + env metadata; `api-local-design.js` computes marks with the same core;
  drafts/threads in memory like bug edits today; apply/import refused.

## Groundwork (before features)
1. CI size check `scripts/check-size.ts`: 250 lines (350 tests), `core/` has no `node:` imports; the 7 files
   already over the limit are frozen at today's size on an allowlist (they may shrink, not grow).
2. Split before extending: `web/js/views/flow-draw.js` (one 210-line function; return geometry),
   `server/store/snapshots.ts` → read / ingest / crud, `server/mcp/tools.ts` → `tools/` folder,
   `web/js/graph/canvas-graph.js`, `web/js/api-local.js` (bugs / design parts). Leave `core/trace.ts` alone.
3. Graph cache LRU with a testable `size()`; per-draft graphs dropped on apply/discard.

## Increments (each: tests, preview, size check, UI-GUIDE checklist, screenshots vs its mockup frame,
## docs + DEMOS row, version bump, deploy + re-seed)
| # | Increment | Migration | Size |
|---|---|---|---|
| G | Groundwork above | — | M |
| F1 | Flow page: description box under the title, numbered steps, ‹ › walk, step description, `step=` in URL | — | M |
| F2 | Squeeze (pure `flow-squeeze.js` inside the existing fit loop) | — | M |
| 1a | envs table, copy from any env (Blank / Components / Full), neighbours (one hop, through channels), `kind` + path field, env picker and New environment page | 005 | M |
| 1b | Baseline + diff core + marks endpoint + drafts backend (REST + MCP) + draft bar, View/Edit, marks in map / inventory / flows / field diffs | 006 | L |
| 2a | Edit forms in the panel (components, endpoints, calls, flows), flow names | — / 007 | L |
| 2b | Import into draft (search all envs, MCP `find_in_envs`, `import_into_draft`) | — | M |
| 2c | Direct canvas editing (drag to add a call, add lifeline) — may slip after phase 3 | — | L |
| 3 | Subsystem level: abstract links (refine end by end), roll-up, level control, map grouped by subsystem | 008 | L |
| 4 | Discussions on any anchor, MCP thread tools, per-call AI descriptions, all-discussions page | 009 | M |

F1/F2 need no schema change and run in parallel with 1a. Data lane (G → 1a → 1b → 2a → 3 → 4) is sequential with
migration numbers reserved; at most two implementers at once (the bug loop keeps one slot). Each migration only
adds tables: rollback = previous commit + restart; every migration is dry-run on a copy of `data/` first.

## Testing (qa.md has the case lists)
Pure core first (diff fixtures per level under `tests/fixtures/diff/`, op replay, squeeze, roll-up vs brute force),
then API/MCP via `startApp()` with a `designEnv()` helper, migration upgrade from an old DB, a golden `traceHash`
over every prod entry point (proves harvested flows didn't change), concurrency on one draft, preview build.
Visual: F1–F9 at 1440/760, light/dark, `act.mjs` scripts for the walk, squeeze, Edit mode; stable `data-qa` hooks.
Demos: `sase-hld` (Components copy + open draft), `blank-hld` (one import), `sase-hld-v2` (Full copy of a design),
a prod delta after the copy (drift).

## Decided by the lead (no need to ask)
- Field name: `groupPath` on the service (not `group`: overloaded in the code); view shapes say `subsystem`.
- Agent kind: `client-app` (`client` clashes with the trace's browser participant).
- "Transport not decided": a new transport value `undecided` (neutral grey), not `other` + flag.
- Removed calls are listed under the diagram for now, not drawn inside it.
- Env picker shows for everyone; the `--flow-2` yellow stays (spark is a shape, never a fill area);
  dark-mode `--warn`/`--bad` tokens become a separate small fix.
- Mockup CSS is not copied; implementers use the app's `.seg`, `.select`, `flow-desc.js`, `schema-table.js`.

## Decided by the maintainer (2026-10-21)
1. Apply conflict (rare): the easier rule, **newer edit wins**: apply overwrites; the changelog records what it
   replaced. No base-hash conflict machinery (draft ops still store their base version, for the record).
2. Changed mark: **yellow ring**.
3. Baseline **frozen at copy/import**; no full history.
4. Order approved: G → F1/F2 → 1a → 1b (drafts backend with marks) → 2a forms + names → 2b import → 3 subsystem
   level → 4 discussions; 2c canvas drag-editing may slip after 3.
5. A design is **a full copy of its own: no shared objects** with its source. Full copy of a design keeps the
   original baseline and copies discussions, not open drafts.
6. Flow names, descriptions and discussions allowed on every environment (annotations).
7. **Environment kind `sealed` | `design`** (replaces "harvested"):
   - `sealed`: populated only through the harvester APIs (ingest full/delta, DTOs, schemas, Redis keys). Manual
     entity CRUD (REST services/entity routes, MCP `upsert_entity` / `delete_entity`) is refused with 409.
     Annotations (names, descriptions, discussions, bugs) stay allowed. Existing envs are backfilled as `sealed`.
   - `design`: no harvester ingest (409); all edits go through drafts.
   - Removing a dead service from a sealed env: a harvester delta, or an admin script (no UI action).
