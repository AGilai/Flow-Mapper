# QA plan: design environments (HLD)

Author: QA lead. Read-only study of tests/, scripts/, samples/, docs/DEMOS.md, the rev 3 mockup and qa-browser.

## 0. Facts from the code that shape the tests
- `snapshots` keeps only the LATEST header per (env, service); `entities` only the latest rows. There is no stored
  history of a revision, only `changelog` change keys. So "baseline = source revision at copy time" needs its own
  stored copy (baseline tables or a frozen baseline env). Test it as data, not as a version number lookup.
- `listEnvs` = `SELECT DISTINCT env FROM snapshots`: a Blank design env has no snapshots and would vanish.
  `GET /api/envs` returns `string[]`; `api-local.js` returns `Object.keys(data.models)`. Changing the shape breaks
  the preview and any harvester script that reads it. Guard: keep `/api/envs` as is, add `/api/envs?detail=1` or a new route.
- `graph-cache.ts`: Map per env, no eviction, cleared wholesale on `PRAGMA data_version` change. Draft graphs keyed
  per draft add unbounded entries; 2 GB box. Needs an LRU with a testable `size()`.
- Tests: `node:test`, one file per feature/version, `startApp()` (random port, temp DB, `call()`), `sampleModel()`
  for pure core tests, web/js pure modules imported directly (`flow-scan.js`, `flow-tabs-state.js`). MCP via
  `POST /mcp` JSON-RPC in api.test.ts. Migrations via `oldDb()` + `openDb()` in migrations.test.ts.
- Preview: `build-preview.ts` ingests samples + mock into a temp DB and dumps `models`, dtos, descriptions, keys,
  schemas per env into data.js. Anything a design page reads must be in that dump or the page must degrade.

## 1. Test cases per phase
New suites (one concern each, ~150 lines): `env-copy`, `env-diff-core`, `env-diff-api`, `env-readonly`,
`drafts-core`, `drafts-api`, `drafts-concurrency`, `import`, `abstract-links`, `rollup`, `threads`,
`step-walk`, `squeeze`, `migrations-005` (extend migrations.test.ts with one test per new migration).

### Phase 1. Environments + marks
Migration (on `oldDb()` with 001-004 applied and rows in prod + `bugs` + `descriptions`):
- M1 the new migration creates `envs` (and baseline tables); every existing env becomes a `harvested` row;
  snapshot/entity/bug/description counts unchanged; `.pre-005.bak` exists and still lacks `envs`.
- M2 fresh DB gets all migrations, no backup. M3 re-open applies nothing. M4 concurrent openers (reuse the spawn test).
- M5 a copy of a real DB: `sqlite3 data/flow.db ".backup /tmp/x.db"`, then `FLOW_DB=/tmp/x.db node -e openDb`,
  compare `SELECT env, count(*) FROM snapshots/entities GROUP BY env` before/after. Never on `data/`.
- M6 assert the migration has no SQLite-only types/defaults that block Postgres (static check: no `WITHOUT ROWID`,
  JSON stays TEXT, timestamps ISO TEXT) — a grep test over the new .sql files.

Copy (API, `POST /api/envs`), each from prod AND from a design env (copy of a copy):
- C1 Blank: env row exists, kind design, source recorded, 0 services, appears in env list, groups/levels stored in order.
- C2 Components: picked services + their ingress/egress/channels/resources/bindings/DTOs/schemas come along;
  `functions` count is 0 and no ingress has a `handler` that points to a missing function (integrity must not 422);
  no flows trace (entry points list empty or "no flow yet"), summary sentence counts match.
- C3 Full: entity-for-entity equal to source (normalize JSON, compare per list), DTOs, schemas, descriptions,
  resource keys equal; `trace()` of every entry point in source and copy gives the same `traceHash`.
- C4 Full copy of a design env carries its groups, abstract links (phase 3), flow names; not its drafts or threads
  (decide and assert).
- C5 neighbours: one hop only (calls or called-by, incl. via topic/queue? decide and assert), each with a reason;
  never pre-ticked; a two-hop service is absent.
- C6 source unchanged after copy (row counts and `version` per service), changelog of source untouched.
- C7 errors: name exists (409), name equals a harvested env, bad mode (422), unknown source (404), empty name,
  names with `/`, `%`, spaces (env names travel in URLs).
- C8 atomicity: a forced failure mid-copy (inject a bad row via a test-only hook or a trigger) leaves no partial env.
- C9 delete: design env deletable (cascades snapshots, entities, DTOs, baseline, drafts, threads); harvested env
  delete returns 4xx and the UI has no action.

Diff (pure `core/diff-*.ts`, fixture pairs baseline/current; then the same through the API):
- D1 component new / removed / unchanged / changed ("+1 endpoint", "+1 call" label text).
- D2 endpoint new/removed/changed (transport, bindKey, handler); D3 call (egress) new/removed/changed transport,
  including "transport not decided"; D4 channel and binding/subscription filter changes.
- D5 message (DTO JSON): field new, removed, changed type (`was string`), nested object, array of objects
  (`devices[].certFingerprint`), required flag; D6 collection schema field (mongodb schema, source manual/code).
- D7 highest-new-level: a new component's endpoints/calls/fields carry no mark; a new field's children carry
  none; a new endpoint on a prod component is marked, the component is "Changed" (roll-up of marks one level up).
- D8 renamed vs removed+added: an entity whose key changes is removed+added (keys are identity) unless the design
  records a rename op (phase 2). Field rename inside a DTO = removed + added. Assert exactly, since threads (phase 4)
  depend on it.
- D9 "Compared with: source now": change prod after the copy (ingest delta v13); the design shows drift marks;
  baseline mode does not. Then delete a prod service the design copied: shows Removed in source-now mode only.
- D10 imported items (phase 2) compare with their own source revision: no spark.
- D11 counts in head sentence and inventory filter (New/Changed/Unchanged) equal the per-row marks (one function
  computes both; test equality on the full sample copy).
- D12 deterministic: diff of identical inputs is empty; key order in JSON does not matter; arrays of fields are
  compared by name, not index.
- D13 performance budget: diff of a full copy of `scale-test` (100 mock services) under ~200 ms, cached with graph.

Read-only + harvester (guard suite `env-readonly`):
- R1 ingest/CRUD/MCP `ingest_manifest` into prod behaves byte-for-byte as before (reuse api.test cases unchanged).
- R2 harvested env: draft create, edit endpoints, `upsert_entity` from the design UI routes → 403/409 with a clear code;
  existing CRUD routes keep working for harvesters (decide: the existing `/services/:s/functions` CRUD on prod is used
  today by api.test "CRUD on entities"; it must stay).
- R3 a harvester ingesting into a design env name is refused (or allowed? decide) — and into a new name still
  auto-creates a harvested env row.
- R4 `GET /api/envs` still returns `string[]` (contract), new metadata elsewhere.

### Phase 2. Drafts, editing, flow names, import
Core (`drafts-core`, pure: env model + ops → model):
- O1 ops apply in order: create component, add endpoint, add call to it, update transport, delete call → final model.
- O2 order matters: update before create is rejected; delete then re-create same key yields the re-created one.
- O3 ops on items that came from the copy vs items created in the same draft.
- O4 the draft view = env + ops in memory; marks show "in draft" / "removed in draft" separately from baseline marks.
- O5 counts (+1 −2 ~1) equal the review list.
API (`drafts-api`):
- A1 create/list/open/rename/discard; discard leaves env and changelog untouched, draft graph dropped from cache.
- A2 apply = ONE delta ingest per touched service (one changelog row per service, kind `delta`, source `ui|mcp`),
  versions bump by exactly 1, `changes` lists the right keys, draft status `applied`, further ops refused.
- A3 apply is all-or-nothing across services (one transaction): an integrity error in service 2 leaves service 1 unchanged.
- A4 conflict: the env item changed after the op was recorded (base version per op/service) → apply returns 409 with
  the list, nothing written. Unrelated env change does not conflict. (Spec still open: "stop" vs "newer wins";
  the test pins whichever is decided.)
- A5 apply with zero ops: no-op, no version bump.
- A6 AI edits: MCP `edit_in_draft`/`apply_draft` produce the same ops/rows as REST, author recorded as by_ai.
Concurrency (`drafts-concurrency`):
- K1 two clients append ops to one draft concurrently (Promise.all of 20 ops): no lost op, total order stable (seq
  assigned by DB), reading back gives the same model on both.
- K2 two clients apply the same draft at once: one 200, one 409/`already applied`; env version bumped once.
- K3 two drafts touching the same item: first apply wins, second gets the conflict list.
- K4 edit on a stale op list (client sends `expectedSeq`) → 409, not a silent fork.
Flow names: N1 set/get name keyed (env, service, ingress), survives re-ingest of an unchanged service, shows in
entry points list and MCP `list_entry_points`; N2 harvested env names allowed? (decide; descriptions already are).
Import (`import`):
- I1 search all envs groups results by env, excludes the current env, says what comes along.
- I2 import into a Blank env's draft: component + endpoint arrive as ops; baseline for them = source's current
  revision; after apply, no spark (D10); meta "from prod, imported <date>".
- I3 import an endpoint onto a component that exists: merges, does not replace other endpoints.
- I4 import of an item already present → reported as "matches", no op. I5 import never applies without an open draft.
- I6 MCP `find_in_envs` returns matches/elsewhere/nowhere triples; `import_into_draft` refuses without explicit items.

### Phase 3. Subsystem level
- L1 abstract link CRUD (in a draft), ends as group path, component, or endpoint; validation of refs that don't
  resolve. L2 refine end by end: group→component→endpoint; when both ends are endpoints it becomes an ordinary
  egress/ingress pair, the link row is gone, and the roll-up count goes up by one (no double count).
- L3 roll-up (pure, from graph): one line per (from group, to group, transport, direction), count = number of calls,
  async separate from sync; calls inside one group not drawn; calls via topic/queue attributed to publisher group →
  consumer group (decide); "transport not decided" is its own bucket. Click list = exactly those calls.
- L4 roll-up counts on full sample copy grouped by a fixture group map equal a brute-force count in the test.
- L5 group path parsing: "platform", "platform/identity", trailing slash, empty → ungrouped; level names per env.
- L6 kind `client`: schema accepts it, harvested manifests with it validate, trace/health treat it like a caller
  (not "never called" as an orphan entry).

### Phase 4. Discussions, per-call descriptions
- T1 thread on each anchor kind (flow, call, component, endpoint, field, subsystem link); list filters (open/resolved,
  draft/env, level). T2 anchored by key: rename a message (op) → thread follows if the anchor key is stable; a key
  change → "subject removed" (pins D8). T3 thread in a draft moves to env on apply; discard keeps or closes (decide).
- T4 MCP `list_threads` with `updatedSince` (same as `list_bugs`), `reply_thread` sets by_ai.
- T5 per-call AI description: outdated hash per call, same pattern as 0.14.0 descriptions tests.

### Flow page (any phase; ships for harvested envs too)
- F1 step numbering (pure, in a web/js module like flow-scan.js): steps in run order, returns excluded, steps inside a
  folded lifeline keep numbers; numbering identical with Squeeze on/off.
- F2 squeeze (pure `foldColumns(participants, step, caller)`): both ends + caller visible; untouched between-lanes
  folded into one column with count; recomputed per step; open fold toggles; off = today's layout.
- F3 walk state: prev at 1 and next at N clamp; clicking an arrow sets the step; collapsed-box choice remembered
  (localStorage wrapped in try/catch, test the pure reducer).

## 2. Regression risks and guards
| Risk | Guard |
|---|---|
| Traces change for prod when `service.group`/`client` added | `traceHash` of every prod entry point before/after the branch, stored as a fixture in a new `trace-golden.test.ts` (hashes only) |
| Description `outdated` flips because hash input now includes group/flow name/step numbers | keep `traceHash` input unchanged; descriptions.test.ts stays green unmodified |
| Link health counts move (client kind not an orphan; design "missing" not dangling in prod) | health-019-1, harvest-quality, api `services list includes health` stay unmodified; new test: design env gaps show as notices, not in prod health |
| Graph cache: draft graphs leak or a draft read invalidates prod | test cache size bound and that a draft write does not `invalidate('prod')` |
| Ingest path touched by apply-as-delta | api.test delta/version/409 tests untouched; apply goes through `ingest()` not a parallel writer |
| Bug loop (`list_bugs`, comments, updatedSince) shares code with threads | do not refactor bugs store; threads get their own store; bug tests unmodified |
| Preview build | CI runs it; add a check in a test that `data.js` contains a design env and the UI degrades (no Edit) on api-local |
| `/api/envs` shape, env picker | R4 + api-local contract test |
| Live :3000 DB upgrade | M5 on a copy; backup file assertion |
| Existing tests edited to pass | review rule: a diff that changes an existing assertion needs a reason in the commit |

## 3. Visual QA plan (designer agent + QA, after `npm run seed`, scratch server on another port)
Mockup frames to compare (`design/mockups/design-env.html`, screenshot each frame by its label):
F1 `#/envs/new` · F2 `#/?env=sase-hld` · F3 `#/?env=sase-hld&level=subsystems` · F4 `#/flows?env=sase-hld&draft=
use-token-grant&tabs=sase-agent/tunnel.open` · F5 endpoint panel `UserUpdated` + schema `mongodb:users-db/users` ·
F6 import dialog · F7 `#/inventory?env=sase-hld` · F9 flow page (prod `#/flows?tabs=api-gateway/in.createOrder` too). F8 later.
Viewports: 1440x900 and 760x900, each light and `dark`. 9 frames x 4 = 32 shots per full pass; phase passes shoot only
their frames. Check: spark/ring/strike marks and left edge, "Compared with" switch, draft bar counts, prod edges thin grey,
no horizontal page scroll at 760, CONSOLE-ERROR/PAGE-ERROR none (shoot.mjs exits 1).
Scripted interactions (`act.mjs`, one run at a time, close the server after):
- Step walk: `click:#flow-next` x3 → shot; `key:ArrowLeft` → shot; `click:[data-step="5"]` → shot (step inside fold).
- Squeeze at 760: default shot (fold column "⋯ N" visible, both ends on screen); `click:.fold` → shot (opened);
  `click:#squeeze-toggle` → shot (horizontal lane scroll, today's look). Repeat on `stress-gateway/in.startChecked`.
- Description box collapse: `click:.flow-desc .chev` then reload → still collapsed.
- Edit mode: `click:[data-mode=edit]` → draft picker; open draft → in-draft chips + struck-through removed call.
- Compared with: `click:[data-compare=source-now]` on F5 after the drift delta is seeded.
Ask the implementer for stable selectors (`data-qa=` or ids above) as part of the brief.

## 4. Demo cases in samples/ (and rows in docs/DEMOS.md)
Design envs are not manifests: add `samples/envs/*.json` (a recipe: source, mode, groups, picked services, ops) that
seed.ts and build-preview.ts replay through the same store functions as the API. Names:
- `sase-hld` (from prod, Components, 3 subsystems agent/network/platform; client `sase-agent`; new pop-edge, pop-swg,
  auth-svc +1 endpoint, UserUpdated field changes, users schema field changes, a call with no transport, two abstract
  links one half refined, flow "Agent connects to POP" with 7 steps, a thread on a field) → frames 2-5, 7, 9.
- `sase-hld` draft `use-token-grant` left open (2 ops, 1 removal) → frame 4.
- `blank-hld` (Blank, then one imported endpoint from prod) → import, "imported, not new".
- `sase-hld-v2` (Full copy of sase-hld) → copy of a design, marks against sase-hld baseline.
- Drift: a prod delta in `samples/deltas/` applied AFTER the copy recipe so "source now" shows a change (order in seed!).
Prod stays the harvested demo env; the flow-page rows use existing prod flows (createOrder, stress-gateway).

## 5. Test data and design-for-testability
Fixtures: `tests/fixtures/diff/*.json` small baseline/current pairs per level (component..schema field, rename cases);
a helper `designEnv(app, recipe)` in helpers.ts (one call: copy + ops) next to `startApp()`; a clock injection
(`now()` in ctx) so "Oct 21" labels and `updatedSince` are deterministic; a 2-group fixture map for roll-up.
Design now for testability:
1. Diff, roll-up, draft-op replay, step numbering and squeeze folding as PURE functions (core/ or web/js pure modules)
   with plain-object inputs; the server only loads rows.
2. Op seq assigned by the DB (`INTEGER PRIMARY KEY`), each op records the base version of its service → conflicts testable.
3. Apply funnels into existing `ingest()`; a `dryRun` apply returns the delta manifests (testable and useful for Review).
4. Baseline stored as data rows with a revision id, not inferred from versions (section 0).
5. Graph cache exposes `size()` and keys by `env` or `env#draft`; LRU capacity configurable via ctx for tests.
6. Read-only guard in ONE place (env kind check in the write path), so one test matrix covers REST and MCP.
7. Stable `data-qa` selectors on walk, squeeze, fold, compare switch, draft bar, marks.
Hard to test (accept manual/visual): canvas direct editing (drag "+" between lifelines), force layout held to
subsystem columns, thickness scaling of roll-up lines; cover their pure parts (target lane from x, column order) only.
