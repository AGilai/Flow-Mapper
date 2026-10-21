# Tech lead: delivery plan for design environments (HLD)

Spec: `design/mockups/design-env.html` rev 3 (frames 1-9, "What the build needs", "Decided").
Baseline today: 0.19.1, migrations 001-004, 7 files already over 250 lines (core/trace.ts 447,
core/channel-flow.ts 286, core/events.ts 271, server/store/snapshots.ts 268, core/instances.ts 266,
web/js/graph/canvas-graph.js 262, tests/flow-chain.test.ts 308).

## Facts from the code that change the plan
- **No history is kept per snapshot.** `snapshots`/`entities` hold only the latest row per
  (env, service); `changelog` holds change lists. The mockup's "versions are already kept per
  snapshot" is wrong, so the baseline has to be **stored at copy time** (frozen copy of the copied
  rows), not rebuilt from the changelog (fragile, and DTOs/schemas are not in it).
- **No envs table**: an environment exists because rows carry `env`. Migration 005 must backfill
  `envs` from `SELECT DISTINCT env` across snapshots, bugs, dtos, schemas, keys, descriptions.
  Ingest into an unknown env must keep auto-creating it as `harvested` (harvesters change nothing).
- **Rollback is cheap for additive migrations**: the runner only checks files it has, so older code
  ignores tables it does not know. Rollback = `git checkout <prev tag>` + restart; the
  `<db>.pre-NNN.bak` restore is only for data damage (and loses writes since the upgrade).
- `descriptions` already has a `callee` column: per-call descriptions (phase 4) fit with no table.
- `graph-cache.ts` is an unbounded `Map`. Each design env and each open draft adds a GraphIndex;
  on 2 GB this needs an LRU before envs can be created by hand.
- The preview build (`web/js/api-local.js`) computes everything in the browser from
  `FLOW_PREVIEW.models`. If diff/roll-up/draft overlay live in `core/` (pure), preview keeps working
  by shipping the baseline model too; drafts in preview stay in memory like bug edits.

## 1. Increments
Each row is one implementer brief, one worktree, one QA pass, one merge, one deploy. Size: S <1 day
of agent work, M 1-2, L 3+. Minor bump per feature increment, patch for review fixes (same as 0.17-0.19).

| # | Increment | Scope | Ver | Migration | Demo (samples/, env prod + seeded `sase-hld`) | Size | Needs |
|---|---|---|---|---|---|---|---|
| 0 | Guard rails | `scripts/check-size.ts` + CI step (see 4); graph-cache LRU (cap by env count, draft graphs evicted first); `seed.ts` learns to create one design env through the copy store fn, idempotent, touching only `prod` + `sase-hld` | 0.19.2 | none | none (internal) | S | - |
| F1 | Flow description box + numbered steps + walk | frame 9: wide collapsible description under the title (moves the 0.14.0 Human/AI block out of the panel), step tiles, ‹ › walk + ←/→, step description box, click arrow = jump | 0.20.0 | none | `#/flows?tabs=api-gateway/in.createOrder` (walk), DEMOS row | M | 0 |
| F2 | Squeeze | fold lifelines a step does not touch, default on, remembered per viewer; pure fold rule in `web/js/views/flow-squeeze.js` | 0.20.1 | none | same flow at 1100px | M | F1 |
| 1a | Groups + `client` kind | optional `service.group` path and `kind: client` in `schema/manifest.schema.json`, samples, HARVESTER-GUIDE, API.md; map draws client as device; no UI grouping yet | 0.21.0 | none (kind/meta already free columns; group lives in `meta`) | sase-agent client in samples `prod` | S | 0 |
| 1b | Envs + copy | `envs` table, list/create/delete, copy Blank/Components/Full with one-hop neighbours, frozen baseline rows; ingest refuses `kind=design` envs (409 `ENV_IS_DESIGN`), delete refused for harvested; picker shows kind + "from prod, <date>"; `#/envs/new` (frame 1); MCP `list_envs`, `create_env` | 0.22.0 | **005_envs.sql** (envs + backfill), **006_baseline.sql** (baseline_snapshots, baseline_entities, baseline_dtos, baseline_schemas, all keyed by env) | `#/envs/new`, seeded `sase-hld` in picker | L | 1a |
| 1c | Diff engine + API | `core/diff-*.ts` per level (component, endpoint, call, channel, message, schema field), "highest new level only", compare `baseline` or `source-now`; `GET /api/envs/:env/diff?against=`; marks cached with the graph; MCP `diff`; preview ships baseline | 0.22.1 (API only) | none | `GET /api/envs/sase-hld/diff` in DEMOS | M | 1b |
| 1d | Marks in the UI | frame 2 map grouped by subsystem (column layout), region heads, spark/ring; frame 7 inventory status filter + "what changed"; frame 5 field diffs in endpoint panel + schema; "Compared with" switch | 0.23.0 | none | `#/?env=sase-hld`, `#/inventory?env=sase-hld`, endpoint with UserUpdated | L | 1c, mark decision (6.1) |
| 2a | Drafts core | `drafts`, `draft_ops`; pure `core/draft-apply.ts` (env model + ops in memory); REST create/list/op/discard/apply; apply = one delta ingest per touched service through `snapshots.ts`; conflicts listed and stop; MCP `open_draft`, `edit_in_draft`, `apply_draft` | 0.24.0 | **007_drafts.sql** | draft `use-token-grant` seeded on `sase-hld`, MCP walkthrough in DEMOS | M | 1c, conflict decision (6.2) |
| 2b | Edit mode, forms | View/Edit toggle, draft bar (+/−/~, Review, Discard, Apply), panel forms for components, endpoints, calls; in-place "in draft"/"removed in draft" | 0.25.0 | none | `#/flows?env=sase-hld&draft=use-token-grant&tabs=sase-agent/tunnel.open` | L | 2a, 1d |
| 2c | Flow names | name beside the description record; flows list by name (frame 7 right) | 0.25.1 | **008_flow_names.sql** (new table keyed like descriptions; no ALTER of 003) | inventory flows list on `sase-hld` and prod | S | F1 |
| 2d | Import | `GET /api/search?envs=all`, `POST .../drafts/:id/import`, missing-target notice, import dialog (frame 6); MCP `find_in_envs`, `import_into_draft` (asks first) | 0.26.0 | none (imports are draft ops; baseline row written at apply) | import `devices` into the seeded draft | M | 2b |
| 2e | Direct canvas editing | add/remove lifelines and calls on the diagram, drag to reorder | 0.27.0 | none | same draft | L | 2b; may slip after phase 3 |
| 3a | Roll-up + level control | pure `core/rollup.ts` (one line per direction+transport, count), `level=subsystems` on the map, click lists calls | 0.28.0 | none | `#/?env=sase-hld&level=subsystems` | M | 1d |
| 3b | Abstract links + refine | `links` table, refs = group path / component / endpoint; endpoint-endpoint becomes an egress/ingress pair at apply; refine panel; draft ops for links | 0.29.0 | **009_links.sql** | two seeded links on `sase-hld`, one half-refined | M | 3a, 2a |
| 4a | Threads | `threads`, `thread_posts` (bug-comment pattern, `updatedSince`); anchors by key with "subject removed"; thread UI on every anchor; MCP `list_threads`, `reply_thread` | 0.30.0 | **010_threads.sql** | thread on a call and a field in `sase-hld` | M | 2a |
| 4b | Per-call AI descriptions | reuse `descriptions.callee`; Generate prompt per call; shows in the step box from F1 | 0.30.1 | none | `orders-svc` call description in the walk | S | F1 |
| 4c | All discussions | `#/discussions?env=` (frame 8), filters | 0.31.0 | none | `#/discussions?env=sase-hld` | S | 4a |

Change from the lead's phases: flow-page work (F1, F2) goes first, in parallel with phase 1, because it
touches only harvested-flow UI, needs no migration, and is the first visible value for prod users.
Phase 1 is split so the diff engine (1c) can ship and be tested before any UI depends on it.

Migration safety for every row with a migration: the implementer adds a test in
`tests/migrations.test.ts` that builds a DB from 001-(N-1), inserts rows, upgrades, and checks old
rows are intact; QA runs the upgrade on a **copy** of `data/flow.db` (`FLOW_DB=<copy>`, port 3100,
started and killed by `$!`) and diffs row counts of every old table before/after. Deploy: lead checks
`data/` free space (VACUUM INTO doubles the DB), restarts, confirms the `backed up ... pre-NNN.bak`
line in `data/server.log` and `GET /api/version`. All of 005-010 are additive (CREATE TABLE, INSERT);
none needs `foreign_keys=off`. Rollback: previous commit + restart; restore `.pre-NNN.bak` only if
rows were damaged.

## 2. Parallel vs sequential (max 2 implementers, never 2 QA browsers at once)
- Lane A (data): 0 → 1a → 1b → 1c → 2a → 3b/4a. Strictly sequential: each adds a migration or
  extends the store the next one builds on, and migration numbers must not collide.
- Lane B (UI): F1 → F2 → 2c → 4b, then 1d once 1c is merged, then 2b → 2d → 2e, 3a, 4c.
- Pairs that may run together: (F1, 1a/1b), (F2, 1c), (1d, 2a), (2b, 3a), (2d, 4a).
- Never together: two increments that add a migration; two that edit the same view file (e.g. 1d and
  3a both touch `views/system.js`); any implementer while a bug agent is mid-fix on the same area.
- One headless Chromium at a time: QA/designer screenshot passes run one after another, not in parallel
  with a test run. The bug-loop agent counts as one of the two implementer slots.
- Migration numbers are reserved in this plan (005-010); a bug fix needing a migration takes the next
  free number and the feature brief renumbers before merge.

## 3. Definition of done (every increment)
1. `npm test` passes; new behaviour has tests (core pure tests for diff/roll-up/draft-apply; API tests
   via `startApp()`; migration upgrade test where there is one).
2. `npm run preview` builds and the new page works in the preview (api-local.js updated in the same
   commit; drafts/threads in memory).
3. `npm run check:size` passes (section 4).
4. UI: UI-GUIDE "Checklist before merge" (1440 and 760, light and dark, 5-second answer, no duplicate
   rows, no zero alarms, nothing truncated). Designer agent compares `qa-browser` shots with the
   matching mockup frame and lists deviations; frame-less UI (dialogs not in the mockup) gets a
   mockup addendum approved first.
5. Docs in the same commit: ARCHITECTURE.md (new files in the tables), API.md (every new route, error
   code, MCP tool), DESIGN.md (why: baseline storage, diff levels, drafts-as-delta, roll-up computed),
   HARVESTER-GUIDE.md (1a group/client; 1b "ingest into a design env is refused"). DEMOS.md row with
   a working link.
6. `package.json` version bumped; commit titled `<feature> (<ver>): ...`; review fixes as a follow-up commit.
7. Deployed by the lead, samples re-seeded, link given to the maintainer.

## 4. Maintainability rules (checked, not just asked)
- **Size check in CI**: `scripts/check-size.ts` (no deps), `npm run check:size`, added to
  `test.yml` after `npm test`. Fails on any `.ts/.js/.css` in core, server, web, scripts over 250
  lines, except an allowlist `scripts/size-allowlist.json` that holds today's 7 files at their
  **current** count (may shrink, never grow, never gain entries). Tests: limit 350.
- Purity check in the same script: no `node:` import under `core/`; type-only imports use `import type`
  (grep `import {` of names only used as types is hard; enforce by type-stripping failure already).
- One concern per file; the "What the build needs" pieces map to named modules: `core/env-copy.ts`
  (pure selection of what a mode copies), `core/diff-service.ts`, `core/diff-message.ts`,
  `core/diff-schema.ts`, `core/diff-marks.ts` (highest-level rule), `core/draft-apply.ts`,
  `core/rollup.ts`, `core/anchors.ts`; `server/store/envs.ts`, `baseline.ts`, `drafts.ts`,
  `links.ts`, `threads.ts`; one route file per area. New code must not grow `snapshots.ts` (268):
  apply goes through its existing ingest function, envs logic lives in `store/envs.ts`.
- No env-kind `if`s scattered in views: one `envKind(env)` helper; read-only harvested vs editable
  design is decided in one place (`web/js/env-mode.js`).
- Reviewer checklist line: "Which file did this grow, and is it still one concern?" QA rejects a diff
  that adds >60 lines to an allowlisted file.
- Opportunistic split: when an increment must touch `core/trace.ts` (F1 step numbering might), split
  it first in a no-behaviour-change commit.

## 5. Risks to the bug loop and live data
| Risk | Avoid it |
|---|---|
| Migration damages live rows or fails midway | additive only; upgrade test + dry run on a copy of `data/flow.db`; backup line checked in the log; code-only rollback |
| A harvester pushes to an env name a designer created (or the reverse) | `envs.kind` checked in ingest (409 `ENV_IS_DESIGN`); create refuses an existing name; HARVESTER-GUIDE says so |
| Copy of prod is large and blocks the server (one transaction) | copy is INSERT...SELECT in SQL, not JS loops; test with `seed:mock` 100 services on a scratch DB; time it in QA |
| Memory: many env/draft graphs on 2 GB | LRU in increment 0 before any env can be created; draft graphs evicted first |
| Seed wipes user designs | seed touches only `prod` and `sase-hld`; never `db:install --force` on live |
| Bug agents push to main mid-feature (version and rebase clashes) | features keep minor bumps, bug fixes patch; implementer rebases before QA and again before merge; lead deploys features only between bug-loop runs, and never with a bug agent running |
| Bugs filed against design envs confuse the loop | bug loop step 1 filters to harvested envs (`GET /api/bugs?envKind=harvested`, added in 1b) or the lead ignores design-env bugs |
| Draft apply writes through ingest and bumps versions/changelog of copied services | apply only on design envs; harvested envs have no draft routes (409) |
| Diff cost on every read | marks cached with the graph, invalidated by `afterWrite`; baseline index built once per env |

## 6. Decisions needed from the maintainer
1. Changed mark: yellow ring or pencil glyph (blocks 1d).
2. Apply conflicts: list and stop, or newer edit wins (blocks 2a). Recommendation: list and stop.
3. Baseline storage: frozen copy of copied rows at copy time (recommended; the snapshot history the
   mockup assumes does not exist) vs adding snapshot history for all envs (bigger, touches ingest).
4. Order: flow-page work (F1/F2) first alongside phase 1, and direct canvas editing (2e) allowed to
   slip after phase 3?
5. Size rule: OK to add the CI size check with today's 7 oversize files frozen at their current size,
   tests at 350?
