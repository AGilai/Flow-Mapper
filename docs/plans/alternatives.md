# #82 parts 2 and 3: alternatives as scenarios, external view, DB groups, lambda folding

Status: plan (architect, 2026-10-22). Input: bug #82 ("Additions" 4–7 supersede "Display" 1–2) and the
TL-QA triage comment. Part 1 (0.36.1, TL-QA) is not merged yet; this plan builds on its uncommitted work in
`.claude/worktrees/agent-ab6c9726efa5ecc51` (schema, `altsOf`, `stepId`, `tests/step-alternatives.test.ts`).
Part 2 = core trace + counts + API/MCP (items 3–6 + `choose`). Part 3 = scenario bar in the Flows view (item 7), mockup frame 21 first.

## 1. Data model

**What part 1 delivers (read from its diff):**
- Step field `alternatives: StepAlternative[]` (`core/types.ts`): `{group_id, arms: [{arm, label?, guard_text?, step_ids[]}], name?,
  name_source?, llm_name?, llm_provenance?, depends_on?: 'data'|'message', guard?: {text, file, line}}`; extra fields are kept
  (`additionalProperties: true` on group and arm). `altsOf(st)` (`core/step-marks.ts`) reads the field, else `details.alternatives`.
- **Step id** = `<service>:<function id>#<seq>` (steps have no id of their own). `arms[].step_ids` use it.
- The trace message of a step that carries groups gets `alternatives` (verbatim) and `stepId`. Other messages get neither.
- A group may be repeated on several steps ("belongs to or opens"), so groups are deduped by `group_id`.
- No drawing change; the sample is `api-gateway/routeCreateOrder` (then: egress `orders.create`, else: leaf "reject 422").

**What parts 2/3 derive (pure, `core/alternatives.ts`, memoised per GraphIndex in a WeakMap):**
- `groupsOf(g)`: `group_id -> {group, hosts: stepId[]}` and `armOf(g)`: `stepId -> [{group, arm}]` (a step can sit in arms of
  several groups: nested ones). An arm's step brings its whole subtree (callee functions, deliveries) into the arm.
- **Arm path** of a message: the list of `{group, arm}` the walk is inside when the message is pushed, outermost first.
  Nested = a group whose host step is reached inside an arm of another; its `parent` is the innermost arm on the path.
- **Lock** (needs one additive field, see open question Q2): on a *calling* step,
  `fixes: [{group_id, arm, source?: {file, line}, literal?}]` (top-level step field; part 1's schema adds it, or
  `details.fixes` until then). It scopes like `bind` (#42): it holds for everything below that call on this path.
  The walk then follows only the fixed arm; the decision reports `locked: {arm, at: 'svc:fn#seq', source, literal}`.
- **Lambda**: a function whose id or name matches `<arrow@N>`, `_arrow_N_`, or `details.callback: true` (preferred, Q3).
  Display name `lambda@<file>:<line>` from the function's `file`/`line` (else the matched N). `when`: `details.callback.when`
  (`error` | `timeout` | `always`), else `conditional` when the calling step has a `condition`, else `always`.

## 2. Core trace changes (all pure, core/)

**Principle: one canonical trace, then views.** `trace()` keeps producing one ordered message list: full detail, every
arm (except locked ones), lambdas folded. Everything else is a pure post-pass over it, so the server (REST/MCP) and the
browser (UI, preview) run the same code and agree, and choosing an arm in the UI never refetches.

```
trace(g, start, opts)              -> canonical Trace (+ msg.key, msg.arms, msg.lambda, trace.decisions)
viewOf(trace, {choose, detail, open, dbOpen}) -> Trace (filtered, grouped, renumbered) + counts {steps:{min,max}}
```

**2a. Lambda folding (in `trace.ts`, new helper `core/lambda.ts`).** A `call` step to a lambda pushes no message; its steps
run in place (same `depth`, same `fn` = the parent's, so the row sits on the parent's activation bar) and their messages carry
`lambda: {name, when}` (`when` only when not `always`: the UI draws a small "on error" / "on timeout" marker). Nested lambdas fold
into the outermost non-lambda function. `stack` still records the lambda (cycles). An async lambda keeps `afterCaller` order (#73).
`internalCalls` and `maxMessages` stop counting the removed hop. `flow-counts.ts` needs no change (components, not messages).

**2b. Alternatives in the walk (in `trace.ts`).** In `visitFn`, before a step runs, look up `armOf(stepId)`:
- enter an arm context (like `altCtx` of #41): the **tally** reuses `AltCtx`, so only the largest arm counts toward
  `maxMessages` (the "all" view never truncates earlier than the largest single scenario would).
- every pushed message gets `arms: ['<group>:<arm>', ...]` (outermost first; absent when empty: no change for other traces).
- a step in an arm the path's `fixes` exclude is skipped (with its subtree).
- **#43 repeat rule, scoped:** `expanded` remembers the arm path of the first expansion; a later delivery reuses it
  (`repeatOf`) only if the two paths are compatible (no group where they pick different arms). Otherwise it expands again,
  so choosing arm B never leaves a `repeatOf` pointing at a message of a hidden arm A. A hard ceiling (4 × maxMessages
  pushed, counted or not) stops runaway duplication: `truncated`.
- `trace.decisions`: one entry per group reached, in first-seen order:
  `{group, name, templateName, llmName, dependsOn, guard, parent?: {group, arm}, locked?, arms: [{arm, label, guardText,
  values?, steps: {min, max}}], external: boolean}` (`name` = `llm_name ?? name`; `external`: the arms differ in what the
  external view shows; values = an arm's literal values when the Loader sends them, for message-field decisions).
  A group reached at several places: one entry; `locked` only when every place fixes the same arm, else
  `lockedAt: n of m` for the tooltip.

**2c. `detail=external|full` (`core/trace-view.ts`).** External keeps: `entry`, `egress` (calls out of the service,
publishes, hops), `deliver`, `resource` (then DB-grouped), gaps (`gap`, `broken`, `unhandled`: problems are never hidden),
and any message that is the only content of an arm (an outcome like "reject 422"). Hidden: internal `call` self-messages,
`leaf`, `frontier` markers, a middleware's internal calls. `open: ['svc' | 'svc:fn']` brings back the internal messages of
that service / function (item 5 "expand on request"). `scope: 'intra'` ignores `detail` (its lifelines are the functions).

**2d. DB-op grouping (`core/trace-db-group.ts`).** Over the *view's* message order: a maximal run of `kind: 'resource'`
messages with the same `service`, same store (`store` bind key), same `of`, same arm path, and no other visible message
between them, with 2 or more members, becomes one message `{kind: 'resource', dbGroup: {count, collections[], access,
members: [keys]}, label: 'DB: 3 ops (users, devices)'}` drawn to that store's lifeline. A different store, any external
call, delivery or async start (`n`) breaks the run (item 6: order kept). `dbOpen: [key]` (first member's key) leaves a run
expanded. In full view internal calls are visible, so they break runs too; in external view they are hidden, so runs merge
across functions of one service. Grouping is on in both views.

**2e. `choose` (`core/trace-view.ts`).** `choose: Map<group, arm>`. Drop every message whose `arms` names a chosen group
with another arm; a decision whose `parent` arm is not chosen is not offered (item 7: nested only under the chosen parent).
Locked groups ignore a conflicting choice (`warnings: ['<group>: locked to then']`). Unknown groups: warning, ignored.

**2f. Renumbering (one function, `renumber(kept)`).** After any drop: `n` / `of` (#73), `repeatOf`, `group: 'm<i>'`,
`delivery` ordinals, `deliveries` are rewritten to the kept list, exactly as #73 defines them, so `flow-scan.js` /
`flow-lane.js` read a view like any trace. `participants` keep only lifelines that still have a message; `internalCalls`
recomputed. This is where #73's lesson applies: core and the scan change together, with one golden fixture.

**2g. Counts (min–max).** `counts.steps = {min, max}` of the view: each undecided group contributes min/max over its
arms (recursive for nested ones); chosen/locked groups contribute their arm. `counts.messages` likewise. With no
undecided group, `min === max`. The flows list keeps component counts (every arm counts once: unchanged, see
flow-counts.ts header). Nothing sums all arms silently: the "all" view says "18–24 steps per scenario", not 42.

**2h. Step keys stay stable.** `trace()` stamps `key` on every canonical message (`stepKeys` over the canonical list,
`core/description.ts`, so `~2` repeats count over the full, all-arm trace). Views copy messages, never re-key. A DB group
row takes its first member's key. `flow-steps.js` uses `msg.key` when present (it already maps keys "over ALL the trace's
messages"; this moves that rule server-side). `traceHash` and `HASH_TRACE` use the canonical trace: choosing an arm or
the external view never marks a description outdated. One-time churn: lambda folding removes the lambda call arrows and
may shift a `~N`; list the affected sample flows in the CHANGELOG like 0.32.4 did.

**2i. Interaction with existing features.**
| Feature | Rule |
|---|---|
| async tags `n`/`of` (#73) | renumbered per view (2f); deferred work keeps its arm context (`withAlt` already carries `altCtx`; it carries the arm path too) |
| comments `step`, `steps:{from,to}`, action items `step` | keys (2h), so stable. A step hidden by the view: the thread shows "Not in this scenario" / "Hidden in External view" with a "Show" button that clears the conflicting choice or opens that service. Server `hasStep` checks the canonical trace |
| notes step chips | numbers today (0.34.0). New chips also store `data-key` (+ `data-key-to` for a range; sanitizer `{notes:true}` allows them); a chip resolves by key to the current view's number, "hidden" when not visible. Number-only chips resolve against the canonical full, all-arm numbering |
| bracket gutter | ends resolved by key; a hidden end clamps to the nearest visible step inside the range; nothing visible: no bracket |
| step bar / `sb=` `sd=` / `step=` | apply to the view. `step=` is the view's number (its `choose`/`detail` are in the same URL). Switching scenario keeps the current step by key, else the previous visible step |
| current-step highlight | by key, as above |
| Mermaid export | exports the view the tab shows (choose + detail). Undecided groups in "all" are written as `alt <name>` / `else <label>` frames around their arms (round-trips into design `groups` on import) |
| cross-env tabs `env|key` | choices are per tab. `group_id` is a uuid5, stable across runs, so a choice carries to the same flow in another env |
| harvested vs design envs | `alternatives` come from harvesters; design `altGroup`/`groups` frames stay frames (Q4). Default detail: Q1 |
| drafts / copies | `alternatives` and `fixes` ride in the step JSON: the overlay, Components/Full copy and `draft-manifests` must pass them through untouched (test it; the edit forms never write them) |
| frontier, `depth=` select, squeeze, stores=0 | unchanged, applied after the view. External view hides the internal-call pill; `open=` replaces it per service |

## 3. URL, REST, MCP

**REST `GET /api/envs/:env/trace`** adds `detail=external|full` (default **full** for REST: back-compat for scripts and
tests), `choose=<group>:<arm>,...`, `open=svc,svc:fn`, `dbOpen=<key>,...`. Response adds (additive): `key`, `arms`,
`lambda`, `dbGroup` on messages; `decisions`, `counts`, `detail`, `choose` (as applied), `warnings` on the trace.
`GET .../flows/mermaid` takes the same params. `?draft=` works as today.

**MCP `trace_flow`** adds `detail: 'external'|'full'` (default **external**: the agent reads less; the description says
how to get full), `choose: {group_id: arm}`, `open: string[]`. Description text: "alternatives are either/or: counts
are min–max; never add arms up". Tool hash moves (`tests/mcp-tools.test.ts`). `set_description` prompts ask for
`detail: 'full'`.

**UI URL (Flows view, active tab only, like `zoom=` and `step=`):**
- `ch=<g8>:<arm>,<g8>:<arm>`: `g8` = the first 8 characters of `group_id` (unique within a flow; on a clash use more
  characters). Arm names are `encodeURIComponent`'d (`,` and `:` reserved). Absent = all "show both". Other tabs keep
  their choices in memory (`flow-tabs-state.js`) and write them to the URL when they become active.
- `detail=full` | absent (= the viewer's default, Q1; remembered per env kind like squeeze, `flow-prefs.js`).
- `open=svc,svc:fn`: services opened in external view. DB group expansion is session-only.
- Back-compat: an old link has none of these and opens the default view; an unknown `g8` or arm is dropped with a toast.

## 4. UI (part 3): the scenario bar

**What it shows, in plain words.** One dropdown per decision on the current flow. Each says the decision's name and the
arm in force: `Member: [ all (show both) ▾ ]` → `createFromIdp` / `invite`. Choosing `createFromIdp` redraws the flow
with only that arm's steps, and a second dropdown appears, *indented under the first*, because that arm holds its own
decision: `└ user exists: [ all ▾ ]` → `yes (existing user)` / `no (new user)`. Choosing `invite` removes the nested
one (its choice is forgotten). A **locked** decision shows its arm with a lock icon, cannot be changed, and says why:
`triggerBy: installation_key 🔒 fixed by the caller at routes/register.js:75` (link to code). A **depends on data**
decision carries a small badge "depends on data" (tooltip: guard text, `file:line` link). The name is `llm_name` when
present, else the template name; the template name is the tooltip either way. A "Reset" link returns all to "all".
The step count beside it reads "18–24 steps" while something is undecided, "21 steps" when all are chosen.

**States the frame must show:** (a) no decisions (bar absent: traces without alternatives look exactly as before);
(b) two top-level decisions, both "all", min–max count; (c) parent chosen, nested dropdown visible; (d) one locked
decision; (e) a "depends on data" badge with its tooltip open; (f) 6+ decisions: the bar wraps to two rows then folds
into "+3 more ▾"; (g) external/full detail toggle and one DB group row ("DB: 3 ops (users, devices)") collapsed and
expanded, and a folded lambda row with its "on timeout" marker; (h) a comment on a hidden step ("Not in this scenario ·
Show"); (i) "all" view: how both arms read as either/or without boxes (arm chip on each arm's first arrow, e.g. `⑂ then`
/ `⑂ else`, thin separator); (j) maximized: the bar sits in the sticky top band under the max bar.

**Placement.** In `.flow-top`, under the flow header (title, description, related flows) and **above the step bar**
(`walk.el`): order = header → related → **scenario bar** → step bar → diagram → splitter → bottom pane tabs. It
belongs to the tab (each tab its own). The Detail toggle (External | Full) sits at the right end of the same bar, so
one row holds "what you are looking at". Maximized: the bar joins the sticky band (`--max-stick` adds its height);
under the max bar and above the step bar. At 760 px the dropdowns wrap; the toggle stays right on the first row.

**Designer brief (frame 21, `design/mockups/frames/frame-21.html`).** *"Scenario bar: pick one path through
either/or decisions above a flow."* Follow `design/mockups/` layout (index card in `design-env.html`, prev/next links
on frame 20/21, `shared.css`, status chip "Awaiting approval"), `docs/UI-GUIDE.md` and the frontend-design skill. Use the
attr-fix example: `POST /api/v1/devices/tenant/register` with `Member.createFromIdp` / `Member.invite` and the nested
existing-user / new-user split, a `withTimeout` lambda, a run of 3 Mongo ops. Show states (a)–(j) above, each in light
and dark, at 760 px wide (and one at 1280 px for (b)/(c)). Keyboard: dropdowns are native `<select>`-like, Tab order
left to right, nested after its parent; locked ones are focusable read-only with the reason as text, not tooltip only.

## 5. Build steps (each shippable, `npm test` + `npm run preview` green, a sample in `samples/` and a DEMOS row)

| Step | Version | What | Files (main) | Tests |
|---|---|---|---|---|
| 0 | (part 1) | merge TL-QA's 0.36.1; add `fixes` to the step schema if Q2 says yes | schema, `types.ts`, HARVESTER-GUIDE | part 1's |
| 1 | 0.37.0 | lambda folding + `lambda@file:line` + `msg.key` on the canonical trace; `flow-steps.js` reads `msg.key`; CHANGELOG lists moved sample flows | `core/lambda.ts`, `trace.ts`, `description.ts`, `web/js/views/flow-steps.js`, `flow-draw-rows.js` (marker), samples | `tests/trace-lambda.test.ts`, golden `trace-golden.json` (only lambda flows move) |
| 2 | 0.37.1 | arm paths in the walk, fixes/locks, scoped #43 rule, `decisions`, largest-arm tally | `core/alternatives.ts`, `trace.ts`, `alt.ts` (AltCtx reuse) | `tests/trace-alternatives.test.ts`: nested, locked, repeat across arms, cap |
| 3 | 0.37.2 | `viewOf`: choose, detail, open, DB groups, renumber, counts; REST + MCP params; Mermaid export of the view | `core/trace-view.ts`, `core/trace-db-group.ts`, `routes/queries.ts`, `mcp/tools/flows.ts`, `routes/mermaid.ts`, `mermaid-export.ts`, `api-local.js` | `tests/trace-view.test.ts` (renumber keeps `of`→`n`; a view of a view = one view; no-alternatives trace identical in full view), `mcp-tools.test.ts` hash, API |
| 4 | 0.38.0 | frame 21 approved → scenario bar, detail toggle, `ch=`/`detail=`/`open=`, DB group row, hidden-step states in comments/notes/brackets, notes `data-key` | `web/js/views/flow-scenarios.js` (+ `-pure.js`), `flow-tab-view.js`, `flows.js`, `flow-tabs-state.js`, `notes/*`, `brackets/*`, `comments/thread.js`, `core/rich-text.ts` (notes attrs), CSS | pure tests for URL encode/decode and bar model; QA headless screenshots vs frame 21 |

Steps 1–3 change no drawing for flows without lambdas or alternatives when `detail=full`; step 4 changes the default view only per Q1.

**Risks.**
- *Performance:* two extra O(n) passes per view; `armOf` memoised per GraphIndex. The "all" view draws every arm
  (sum, not product), and scoped #43 can expand a delivery once per exclusive arm: the 4× ceiling bounds it. Measure on
  `npm run seed:mock` (100 services) and the largest prod flow; the UI cap stays `maxMessages: 800`.
- *Counts mismatch:* the step bar counts lane steps (`flow-steps.js`), the API counts messages. Define `counts.steps` with
  the same rule as `isStep` (a pure copy in core, tested against the lane on the samples) or show only API counts.
- *Step-key churn:* lambda folding and the canonical `~N` move some keys once (step 1, listed in CHANGELOG); after that,
  choices and detail never re-key. Comments on a removed lambda arrow show as "step gone" (existing behaviour).
- *Truncation:* a truncated canonical trace makes a chosen view incomplete; show "truncated" on every view of it.
- *Data quality:* `step_ids` that name no step or two groups claiming one step in conflicting ways: ignore the bad ids,
  report them in `warnings` and in Health (harvest quality) later.

**Open questions for the maintainer (proposed defaults).**
- Q1 Default detail: **External in harvested (sealed) envs, Full in design envs** (designs are drawn by hand; every step is
  meant). REST default stays full, MCP default external. Acceptance "traces without alternatives render exactly as
  before" then holds for design envs only; harvested flows lose internal pills by default.
- Q2 Locks need data the Loader does not send yet: **propose `fixes: [{group_id, arm, source, literal}]` on the calling
  step** (path-scoped like `bind`). Until it exists, nothing is locked. Ask the Loader to add it.
- Q3 Lambda detection: **`details.callback: {when}` on the function from the Loader**, with the name patterns as fallback.
- Q4 Design `alt` frames (`altGroup` / `groups`, #41/#72): **stay frames for now**; making them dropdowns too is a later step.

## Maintainer decisions, 2026-10-22 (these override the sections above)
1. **No new row above the flow.** The scenario choice lives where the decision happens:
   - The either/or divider row in the diagram carries an inline dropdown with the arms, plus "Both". A nested decision's dropdown appears on its own divider once its parent arm is visible.
   - The existing flow header row gets one compact chip, `Scenario ▾ (2)`, with nothing new under it. It opens a popover listing every decision (and the locked ones with their reason), plus "Reset". On 760 px the chip is all there is.
2. **The default arm is the first arm, not "Both".**
   - "Both" is still an option, for anyone who wants it.
   - With every decision on a single arm, counts are exact. min–max shows only when "Both" is chosen somewhere.
   - `choose=` in the URL lists only the choices that differ from the default.
3. **External is the default everywhere, and internal calls are lazy.**
   - The trace API and MCP return external only unless asked (`detail=full`, or `open=<service>` per service).
   - There is no "+N internal" count: the server doesn't compute what it doesn't send.
   - A service lifeline gets a plain expand control that fetches that service's internal calls on demand. "Full" fetches everything.
   - The REST default changes to external. Callers that need full pass `detail=full`; list them in the CHANGELOG.
4. **Lambdas and callbacks are ordinary internal calls.**
   - The scraper names them by `file:line`.
   - Drop the lambda folding step (0.37.0 as planned) and the `details.callback` ask. They hide with the other internal calls in External.
   - The build steps renumber: 0.37.0 arms in the trace and locks, 0.37.1 views (external/full lazy, choose, DB grouping, counts), 0.38.0 scenario UI after frame 21 is approved.

## Lead decisions on frame 21's open points (the maintainer may override)
- **Long decision names:** clip them, with the full text on hover. The Loader may later send a short label; if one arrives, show it.
- **Step numbers:** a step keeps its row number in "Both", and the bar reads "6–7 steps per path". Numbering does not restart inside an arm.
- **"Not in this scenario · Show":** this switches the decision to the arm that contains the step, not to Both.
- **Links:** locks never go into the URL, because they come from the data.
- **Flows without decisions:** no chip, and the header is unchanged apart from the small External | Full switch.
- **"⊕ internal":** shown on lifeline hover or focus, and always visible on touch.

## Rule change from the Loader side (#82 comment 225, 2026-10-22), for 0.38.1
`alternatives` now carries only if/else where BOTH arms lead to a flow. Two new step markers, both under `details` (no schema change):
- `details.can_fail: [{when, error, source:{file,line}}]` on a success step. Draw a small "can fail: <error>" marker on the step: a tag next to the step label, with when, error and file:line in a tooltip. Several entries collapse to "can fail (2)". No dropdown. Show it in the step details panel too.
- `details.only_when: {guard, source}` on each step of the arm that remains. Draw "only when <guard>", clipped, full text on hover. Consecutive steps that share the same guard get one marker on the first step plus a thin gutter line across the run. No dropdown. Show it in step details too.
- The trace API passes both through on the message (`canFail`, `onlyWhen`, read from details). MCP trace_flow returns them too. Mermaid export writes them as `Note over` lines.
- Both markers show in External and Full, and when the step is folded into a DB group.

## Maintainer correction (2026-10-22): older alt groups are decisions too
The older either/or groups also become scenario decisions. This covers `condition` with `altGroup`, implicit groups formed by the same file:line with conditions, and design `alt` frames. For example, prod `account-lambda-erase-controller/in.advanceErase` has a 4-way next-priority branch.
- The arms are the branches. Each arm is labelled by its `condition`, and the first branch is the default.
- "All" shows every branch, using today's alt-frame drawing.
- The kinds opt, loop, par, critical and break are not choices.
- A group that already comes from `alternatives` is never counted twice.
This replaces Q4 above, which said to keep them as frames. It ships in 0.38.1 with the markers.
