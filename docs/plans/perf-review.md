# Performance review at scale (2026-10-22, 0.37.2)

Read-only review. No repo code was changed. Scripts, data, raw results and the proposed migration are in the session
scratchpad (`.../scratchpad/perf/`: `harness.ts`, `bench-*.ts`, `results.jsonl`, `explain.json`, `migrations/019_perf_indexes.sql`).

## Setup

- **Data (not scaled down):** 10 envs in one 533 MB SQLite file, 913k entity rows.
  - 6 sealed envs (prod, staging, qa, p81, dev-eu, dev-us), each with 908 to 1,003 services: about 34k ingress, 46k functions, 20k egress, 6k channels and 5k bindings per env. They come from `scripts/mock/generate.ts`, scaled to 200 domains, with about 670 #82 either/or groups per env.
  - 4 design envs: two Full copies (`hld-full` of prod, `hld-full2` of staging) and two Components copies (50 and 200 services), plus 4 open drafts.
  - 55k comments (30% on a step, 10% on step ranges, 40% replies, skewed toward hot flows), 9.4k mentions across 500 users, 18k action items, 8.7k note versions, 5k flow names, 2.5k descriptions, 300 bugs.
- **Method:** the app runs in-process on 127.0.0.1:3600. Every prepared statement is counted and timed per request. "cold" is the first call; "med" is the median of 5 warm calls. Every recorded statement went through `EXPLAIN QUERY PLAN`, and CPU hot spots come from `--cpu-prof`.
- **Noise:** another agent was running tests at the same time (load average 3 to 7). The same CPU-bound call varied 2 to 5x between runs (`health(g)` took 26 s in one run and 88 to 177 s in others). Read the numbers as orders of magnitude. The ranking held in every run.
- **The headline:** at this size the server is CPU-bound in `core/`, not in SQLite. One request (a cold graph, an ingest, `/inventory`) blocks the single event loop for 1 to 6 minutes, and every other user waits.

## Ranked findings

Each row gives the path, the measured cost, the root cause, the fix (as a coder brief), the expected gain, the risk and the effort.

### F1. Graph build: `resolve()` is O(egress × ingress). Effort M, risk low/medium

- **Measured:** `buildIndex` takes 0.9 s at 128 services, 3.2 s at 253, 12.8 s at 503 and 85 to 156 s at 1,000. It grows quadratically. Every cold env, draft view, env copy and ingest pays it, some of them twice (F2). Example: `entry-points` cold 135 s, `?draft=` view cold 142 s.
- **Cause** (`core/resolve.ts`):
  - `matchIngress` filters all consumers for every egress (`consumers.filter(keyMatches)`). That is 62% of the profile.
  - `bindingsFrom` filters all bindings for every egress and every channel.
  - The queue loop does `consumers.filter` for every channel.
  - `unbound` does `consumers.some` and `model.bindings.some` for every channel.
- **Fix brief:**
  1. In `resolve()`, split `consumers` into `exact: Map<bindKey, Ingress[]>` (no `match`, or `match: 'exact'`) and `patterns: Ingress[]` (`glob`, `amqp-topic`).
  2. Split `model.bindings` the same way, by `from`.
  3. Give each item its original array index. A lookup is then `exact.get(key)` plus a scan of `patterns` only, merged and sorted by that index, so the candidate order and therefore `ranked[0]` and the `tied` sets stay identical.
  4. Build `bindingsByTo` and `exactConsumerKeys` once for the queue and unbound loops.
  5. Leave `routeKey` (AMQP) as it is. It is already per exchange.
  6. Keep `tests/core.test.ts` green, and add a test that compares the old and new `resolve()` outputs (links in order, dangling, orphans, unbound, ambiguous) on `generateMock({services: 125})` and on the samples.
- **Expected:** linear. Well under 2 s at 1,000 services (100x or more).

### F2. Harvester ingest blocks the server for 6 minutes. Effort S for (a) and (c), M for (b)

- **Measured** (dev-us, 908 services), each of these is one blocking request:
  - Full manifest of one unchanged service: 381 s.
  - Delta of one function: 344 s.
- **Breakdown:**
  - `buildIndex` for the contract: 109 s.
  - `contractReport` for one manifest: 10.6 s. Without `harvestQuality` it takes 7 ms.
  - `afterWrite`: rebuilds the same graph (another ~110 s), then `health(g)` (88 s).
- **Batch:** a 1,000-manifest batch is N × `mixedCommits`. 100 manifests took 10.8 s, 200 took 48.9 s, and 1,000 did not finish in 10 minutes. The build had to drop the rule.
- **Causes:**
  - (a) `core/contract.ts` `harvestQuality` calls `mixedCommits(g)` and `drift(g)` over the whole env for every manifest, then keeps only `m.service`. `mixedCommits` itself is O(S×E): `mine()` filters every list for every service.
  - (b) `ingestIn` builds an index, then `afterWrite` → `invalidate` + `graphFor` builds the same index again.
  - (c) `afterWrite` runs the full `health()` (F3) only to write 4 numbers per service.
- **Fix brief:**
  - (a) Add `mixedCommitsOf(g, service)` and `driftOf(g, service)`, which read only that service's items (`byService`, see F3), and use them in `harvestQuality`. `health` keeps the whole-env versions.
  - (b) Return the post-apply `GraphIndex` from `ingestIn` (per env). After commit, `ctx.changed(env, g)` puts it in the LRU instead of rebuilding. Drafts and dry runs never pass one.
  - (c) Compute `health_history` rows straight from `g.resolution` (egress, dangling, orphans and unbound per service, one pass) instead of `health(g)`.
- **Expected:** with F1, a one-service ingest takes about 2 to 3 s, and a 1,000-manifest batch takes under 10 s.
- **Note:** the static preview build ingests one manifest at a time: 21 s at 100 mock services and 36 s at 125 (data.js 3.0 / 3.5 MB). Switching it to `ingestBatch` is a 1-line quick win for CI.

### F3. Derived reports are O(services × entities) and recomputed on every request. Effort M, risk low

- **Measured** (prod, warm graph, median):

  | Endpoint | Time | Response size |
  |---|---|---|
  | `/inventory` | 135 s | |
  | `/health` | 26 s | |
  | `/services` | 16 s (it calls `health`) | |
  | MCP `list_services` | 26 s | |
  | `/views/system` | 22 s | 23.5 MB |
  | `/components` (copy picker) | 20 s | |
  | `/views/service/public-gateway` | 4 s | 9.4 MB |
  | `/model` | 5.8 s | 23.7 MB |

- **Cause** (profile): the same anti-pattern everywhere, a scan of a whole model list for each item.
  - `events.ts` `eventFromTypes` loops over all functions for each egress, and is called from `egressEvents` for each egress inside `eventTypes` and `eventReport` (38% of the profile).
  - `stores.ts` `usesOf` loops over all functions for each resource, via `instanceDef` and `stores`.
  - `harvest-quality.ts` `mixedCommits`.
  - `system-graph.ts` filters `of(xs)` per service.
  - `neighbours.ts` `carryRows` calls `channelsFor(model, {s})` per service.
  - Nothing is memoised except `flowCounts` and `componentSets`, so `health`, `eventReport`, `stores`, `inventory` and `systemGraph` are rebuilt on every call.
- **Fix brief:**
  1. In `core/graph-index.ts`, add `byService: Map<service, {functions, ingress, egress, resources, channels, bindings}>` and `stepsToEgress: Map<sid(service, egressId), {fn, step}[]>`, built in one pass in `buildIndex`.
  2. Replace every `g.model.<list>.filter((x) => x.service === s)` with `byService` (`grep -n "service === " core/*.ts`).
  3. `eventFromTypes` uses `stepsToEgress`.
  4. Memoise per graph with `WeakMap<GraphIndex, T>`, the way `flow-counts.ts` does, for `eventReport`, `health`, `stores`, `systemGraph`, `inventory` (keyed by its 2 extra arguments' identity or a hash) and `carryRows` (per model).
  5. core/ stays pure.
- **Expected:** these views drop to well under 1 s cold and about 1 ms warm. The page sizes (`/model` 24 MB, `/views/system` 24 MB) stay. Gzip in `sendJson` is a separate quick win; I did not measure it.

### F4. `getEnv` is used as an existence check, but it counts every entity of the env. Effort S, risk low

- **Measured:**
  - `/api/envs/meta` (10 envs): 0.8 s warm in a quiet process, 11 to 31 s cold or under memory pressure.
  - `SELECT list, count(*) FROM entities WHERE env=? GROUP BY list` (countsOf) ran 230 times in the copy and draft run, 272 s in total (1.2 s cold each).
  - `flow-relations` takes 107 ms and `drafts` list 2.2 s, mostly in this statement.
- **Cause:**
  - `getEnv()` (`store/envs.ts`) runs `ensureColors` (a possible write), `countsOf` (a walk of the wide primary key plus a temp b-tree over about 110k rows) and `ranksOf`. `ranksOf` runs one `SELECT created_at` per env, plus `listEnvs`, which reads `DISTINCT env FROM snapshots`.
  - It is called only to throw a 404 from `routes/drafts.ts`, `relations-read.ts`, `subsystems-read.ts` (×2: open questions, subsystem map), `routes/envs.ts` (components, neighbours) and `draft-plan.ts`.
- **Fix brief:**
  1. Add `assertEnv(db, name)` (it calls `getEnvRow` and throws `notFound`), and use it at all those call sites.
  2. In `ranksOf`, use one query, `SELECT name, created_at FROM envs`.
  3. In `listEnvMeta`, call `ensureColors` only for envs whose `colors` row is `{}` (backfill), not on every read.
  4. Apply the 019 index (`idx_entities_env_list`): countsOf for 10 envs goes from 448 ms to 95 ms warm and from 11.1 s to 0.18 s cold.
- **Expected:** drafts list and flow-relations minus 1 to 2 s; `/envs/meta` under 150 ms.

### F5. The graph cache can exhaust RAM. Effort S, risk low

- **Measured:**
  - One 1,000-service graph adds about 77 MB of heap and about 137 MB of RSS (116 MB at start, 253 MB after one graph).
  - Two Full designs, one draft view of a Full design and two Components copies came to 940 MB RSS and 570 MB heap.
  - The default `FLOW_GRAPH_CACHE_MAX=8` means up to 8 such graphs, about 1.2 GB or more, on a 2 GB box shared with Claude sessions. That is an OOM risk.
- **Cause:** the LRU is bounded by count, not by size. A draft view (`env#draft:x`) is a whole second graph. Memos (`flowCounts`, `componentSets`) live on the graph.
- **Fix brief:**
  - Bound the LRU by weight: the sum of `model.functions.length + ingress + egress` across entries, with a default budget of about 250k items, configurable as `FLOW_GRAPH_CACHE_ITEMS`. Keep `FLOW_GRAPH_CACHE_MAX` as an upper count.
  - Log evictions.
  - On this box, set `FLOW_GRAPH_CACHE_MAX=3` in `data/serve.sh` until then.
- **Expected:** a bounded peak of about 400 MB.

### F6. The first Flows-list visit after a change costs minutes. Effort M after F1 and F3

- **Measured:** `flows/counts` took 80 s cold (prod, 11,394 entry points, `componentSets`) and 130 ms warm. Together with F1, the first Flows page after an ingest took about 3.5 minutes.
- **Cost of the rest of the list (warm):**
  - entry-points: 144 ms, 2.9 MB
  - comments/counts: 103 ms (6 ms with 019)
  - mentions/counts: 98 ms (0.07 ms after `PRAGMA optimize`)
  - flow-relations: 107 ms (F4)
  - notes/index: 222 ms
  - flow-names: 34 ms
  - action-items/counts: 35 ms
- **Not profiled in detail.** Likely causes are the same per-service filters inside `boundValues` / `passesUntyped`.
- **Brief:** after F1 and F3, profile `componentSets` on prod. For notes/index, select `version` and `length(body)` and run `plainText` only on short bodies, or store a `has_text` flag at write.

### F7. Full env copy is N+1 per comment. Effort M, risk medium

- **Measured:**
  - `copyEnv` full prod: 32 s, with 349k statements and 197k `prepare()` calls.
  - staging: 57 s.
  - The route then adds `afterWrite` (198 s, F1).
  - A Components copy of 50 services takes 16 s and of 200 services 23 s (route, including `afterWrite`).
- **Cause:**
  - `copyComments` runs for every row: an INSERT, `syncMentions`, then `findUser`. `findUser` calls `listUsers()`, which is 3 full-table reads plus an O(users × aliases) filter and a sort, for every mention token.
  - It also runs `SELECT user_id FROM comment_mentions` and `markSeen` for every row, inside one transaction.
  - `db.prepare` is called inside the loops (`syncMentions`, `copyService`).
- **Fix brief:**
  1. Copy comments set-based. Create a temp table `cm(old_id, new_id)`. Insert rows in id order with `INSERT ... SELECT`, or keep the row loop but with hoisted statements.
  2. Copy mentions with `INSERT INTO comment_mentions SELECT cm.new_id, m.user_id FROM comment_mentions m JOIN cm ON cm.old_id = m.comment_id`.
  3. Mark the copies as seen with `INSERT OR IGNORE INTO mention_seen SELECT user_id, comment_id, ? FROM comment_mentions WHERE comment_id IN (SELECT new_id FROM cm)`.
  4. Remap `action_items.comment_id` the same way.
  5. Keep the rule that soft-deleted rows have no mentions.
- **Expected:** 32 s down to about 2 s.

### F8. Draft operations reload every row of the env. Effort M, risk low

- **Measured** on the Full design (1,000 services):
  - append 1 op: 3.0 s
  - create draft: 4.0 s
  - list drafts: 2.2 s
  - changes: 2.2 s
  - On the 200-service design: append 0.6 s, changes 1.5 s, list 1.0 s.
- **Cause:** `appendOps`, `info()` and `draftView` each call `envItemRows(db, env)`. That reads 110k entity rows plus JSON parse every time, and `listDrafts` does it once per draft.
- **Fix brief:**
  1. Memoise `envItemRows(env)` in the graph-cache memo (`memoSet(key, rows, [env])`), so it is dropped by `invalidate(env)`.
  2. In `appendOps`, validate against an overlay built only for the touched row ids (`SELECT ... WHERE env=? AND service=? AND list=? AND key=?` per op) plus the prior ops.
  3. In `listDrafts`, compute `counts` from net ops against the memoised rows.
- **Expected:** append under 50 ms, list and changes under 200 ms.

### F9. Every annotation write traces the whole flow. Effort S, risk low

- **Measured** on the largest flow (3,479 messages):

  | Write | Time |
  |---|---|
  | POST comment | 520 to 880 ms |
  | POST action item | 360 ms (even without a step) |
  | PUT notes | 500 ms |
  | PUT description | 960 ms |
  | PATCH (edit) | 25 ms (no trace) |

- **Cause:**
  - `comments.ts` `flowTrace`, `action-items.ts` `addItem` and `notes.ts` `putNotes` call `trace(g, ..., HASH_TRACE)` (`maxMessages` 2000) to check that the flow exists.
  - `checkRange` and `hasStep` then scan the messages.
- **Fix brief:**
  1. Check existence with `g.ingress.get(sid(service, ingress))`. Trace only when `step` or `steps` is given.
  2. Add `stepKeysOf(g, service, ingress)`, memoised in `WeakMap<GraphIndex, Map<anchor, Set<string> & ordered list>>` with a small cap.
  3. Use it in comments, action items and `checkRange`.
- **Expected:** plain writes under 20 ms. Step writes pay the trace once per flow per graph.

### F10. User lookups load the whole users registry. Effort S, risk low

- **Measured:** `/api/users` takes 110 ms; `SELECT * FROM users WHERE merged_into IS NULL` ran 78 times in the read run.
- **Cause:** `findUser` resolves merges with one query per hop, then calls `listUsers(db).find(...)`. `identify()` (every write), `syncMentions` (every mention), `userOf` (mentions) and `ensureUser` all do this.
- **Fix brief:**
  - `findUser` reads the one row plus its aliases and external ids by `user_id`.
  - Cache `listUsers` and `nameIndex` per `PRAGMA data_version`, and invalidate them on user writes.
  - In `listUsers`, replace the per-user `al.filter` and `ex.filter` with grouped maps.

### F11. Mentions page: LIKE scans and a bad plan. Effort S for `optimize`, M for the tables

- **Cause:** `mentions-about.ts` runs `flow_notes.body LIKE '%@[id]%'` and `snapshots.meta LIKE` as full scans on every mentions request: 70 ms plus 58 ms for each call. `mentions/counts` picks the env index over the user index because there are no statistics.
- **Fix brief:**
  - Run `PRAGMA optimize=0x10002` once at startup in `openDb` (it took 4.5 s on this database, and is cheap after that), then `PRAGMA optimize` hourly or on close. This took `mentions/counts` from 51 ms to 0.07 ms.
  - Later, a `note_mentions(env, anchor, version, user_id)` table plus an `about_mentions` table filled at write time (new migration). Backfill from the stored bodies.

### F12. Events: one commit per event and a full manifest stringify. Effort S, risk low

- **Measured:** `emit` was 15% of a 200-manifest batch profile (1.9 s of 12.6 s).
- **Cause:**
  - `manifestIngested` runs after the transaction, once per manifest. Each `emit` is an autocommit INSERT plus a prune DELETE, so 2 WAL commits per event.
  - `JSON.stringify(m).match(/"producer"/)` serialises the whole manifest (about 20 KB) to find one field.
- **Fix brief:**
  - Wrap the post-commit emits of one batch in a single `tx`.
  - Prune once per batch.
  - Read `m.producer ?? m.harvester?.producer` directly, or walk to it, instead of stringifying.

### SSE fan-out is fine

- One comment reached 30 SSE clients in 12 ms more than the POST itself (the POST took 562 ms because of F9).
- `maxClients` is 32 by default, and a tab holds one stream.
- `events/recent` takes 1.5 ms.

## Proposed migration `019_perf_indexes.sql`

The file is in the scratchpad at `.../scratchpad/perf/migrations/019_perf_indexes.sql`, not in the repo. It contains only plain and partial `CREATE INDEX` statements, all valid in PostgreSQL. It does not rebuild any table.

```sql
CREATE INDEX idx_entities_env_list ON entities (env, list);
CREATE INDEX idx_snapshots_env ON snapshots (env);
CREATE INDEX idx_changelog_env_id ON changelog (env, id);
CREATE INDEX idx_comments_open_top ON comments (env, anchor) WHERE parent_id IS NULL AND deleted_at IS NULL AND resolved_at IS NULL;
CREATE INDEX idx_action_items_open ON action_items (env, anchor) WHERE deleted_at IS NULL AND status IN ('open', 'progress');
CREATE INDEX idx_comments_author ON comments (author_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_action_items_owner ON action_items (owner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_bug_links_service ON bug_links (service);
CREATE INDEX idx_bug_links_ref ON bug_links (type, ref_id);
```

**Applying it** to a copy of the scratch database took 10.3 s and grew the file by 26 MB (5%). The extra write cost on ingest is 1 index entry per entity row.

**Before and after** (ms, cold / median of 7 warm):

| Statement (path) | Before | After | Plan change |
|---|---|---|---|
| countsOf prod (`getEnv`, F4) | 1525 / 43 | 15 / 13 | temp b-tree gone, covering index |
| countsOf × 10 envs (`/envs/meta`) | 11062 / 448 | 182 / 95 | same |
| ensureColors prod | 45 / 4.0 | 32 / 0.9 | ORDER BY rowid from the index |
| changelog page (no service) | 209 / 6.1 | 31 / 2.6 | temp b-tree gone |
| comments/counts prod | 1198 / 65 | 5 / 6 | partial covering index |
| action-items/counts prod | 252 / 6.3 | 4 / 2.9 | partial covering index |
| userCounts comments / items | 158 / 41, 66 / 12 | 8 / 6, 3 / 2 | SCAN becomes index |
| bugs of a service | 3.8 / 0.11 | 2.2 / 0.03 | SCAN bug_links becomes MULTI-INDEX OR |
| mentions/counts (user, env) | 54 / 51 | 67 / 51; **0.1 / 0.07 after `PRAGMA optimize`** | user index driven |

Every other hot-path statement already used an index search; `explain.json` has the full list of 60 statements. The remaining SCANs are the small `envs` and `users` tables, the LIKE scans (F11) and `bugs ORDER BY priority` (300 rows).

## Quick wins (S, roughly a day in total, no design change)

1. Migration 019 plus `PRAGMA optimize` at startup (F11).
2. `assertEnv` instead of `getEnv` for existence checks; one-query `ranksOf` (F4).
3. `harvestQuality` per service (F2a) and `health_history` from the resolution (F2c).
4. No trace on plain annotation writes (F9).
5. `findUser` by id, and a cached `listUsers` (F10).
6. Batched event emits; no manifest stringify (F12).
7. The preview build uses `ingestBatch` (CI time).
8. `FLOW_GRAPH_CACHE_MAX=3` on this box now (F5).

## Larger refactors (M/L)

| Change | Effort | Note |
|---|---|---|
| F1 indexed `resolve()` | M | **Do it first: it gates every cold path.** Needs an equivalence test. |
| F3 `byService` buckets and memoised reports | M | |
| F8 memoised env rows for drafts | M | |
| F7 set-based Full copy | M | |
| F2b reuse the ingest's index in the graph cache | M | |
| F5 size-bounded graph LRU | S/M | |
| F11 note and about mention tables | M | Needs a migration. |
| Run graph builds and big reports in a `worker_threads` worker | L | Keeps the event loop free during them. Needed if even a linear rebuild stays above about 1 s at 1,000 services. |
| Incremental resolve per changed service | L | Only if F1 is not enough. |
| gzip for JSON responses | M | `/model` and `/views/system` are 24 MB. |

## What I could not measure

- **The browser:** headless browsers were off-limits. I did not measure how the UI renders 2.9 MB entry lists, a 24 MB system map or a 425 KB trace.
- **Concurrency:** my test of a GET during an ingest was inconclusive, because the GET was answered while the ingest body was still being read. Blocking follows from the code: every handler after `await req.json()` is synchronous.
- **Clean absolute timings:** load average was 3 to 7 because of another agent, so CPU-bound numbers vary 2 to 5x.
- **Not profiled in detail:** the `flows/counts` cold cost (`componentSets`).
- **Not measured at all:**
  - draft apply at scale
  - Mermaid and plan imports
  - bug attachments and log scanning
  - user merge
  - `deleteEnv` on a 1,000-service design
  - PostgreSQL
- **Single runs:** env copy, ingest and graph build ran once each because each takes minutes. Medians exist only for HTTP reads and writes.
