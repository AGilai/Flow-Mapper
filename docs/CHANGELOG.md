# Changelog for harvesters and importers

This file lists, per version, only what a harvester, importer or MCP agent needs to know: API and plan changes, new
fields, MCP tools, and anything breaking. Read it after every `git pull`. UI-only changes get one line. Details are
in [API.md](API.md), [DESIGN-IMPORT.md](DESIGN-IMPORT.md) and [HARVESTER-GUIDE.md](HARVESTER-GUIDE.md); demos are in
[DEMOS.md](DEMOS.md). **Breaking** marks a change that needs an update on your side.

## Unreleased
Performance batch 1 (docs/plans/perf-review.md). No API or schema change; the resolved graph is identical.
- **F1.** `resolve()` looks exact bind keys up in maps and scans only glob / amqp-topic items (`core/resolve-lookup.ts`): a 1,000-service graph builds in about 1.5 to 3 s instead of 85 to 156 s. `tests/resolve-equal.test.ts` compares it with the old resolver (`tests/resolve-reference.ts`).
- **F4.** `requireEnv()` (`server/store/envs.ts`) is the 404 check without entity counts; drafts list, relations, subsystems, components, neighbours and plan apply use it. `getEnv` / `GET /api/envs/meta` keep their counts, read the creation-order ranks in one query and backfill component colours only for envs that have none.

## 0.38.1 (2026-10-22)
The Loader now exports `alternatives` only where BOTH arms lead to a flow. Two step markers under `details` (no schema change):
- `details.can_fail: [{when, error, source: {file, line}}]` on a step that succeeds but can fail; `details.only_when: {guard, source}` on each step of the arm that remains.
- **API (additive).** `GET /api/envs/:env/trace` and MCP `trace_flow` return them on the message as `canFail` and `onlyWhen`; a DB-group row carries its members' entries together. The Mermaid export writes each as a `Note over` line.
- **UI.** A small "can fail: <error>" tag next to the step label ("can fail (2)" for several; the tooltip lists when, error and file:line), and "only when <guard>" under the arrow, once per run of consecutive steps with the same guard, with a thin gutter line across the run. Both are in the step details panel, in External and Full, and on a DB-group row. No dropdowns.

**Alt frames are decisions too (#82, the older either/or).** Every `alt` group (an `altGroup`, an implicit file:line group, a design `groups` frame of kind `alt`) is now a decision in `decisions`: `group_id` = `alt.group` (`<fn>:<altGroup>`, it contains a colon), `from: "alt"`, arms `b1..bN` labelled with the branch's `condition` (else `branch N`), `name` the conditions' common left-hand side (`nextPriority`) else the group name, `guard.file/line` the step's source, `depends_on` unset. Messages carry `arms` (`<group_id>:b2`; split at the last colon) and, as before, `alt`. `opt`, `loop`, `par`, `critical` and `break` frames are not choices. A group whose steps host `alternatives` is not counted twice. Because the default view is the first arm, **`GET /trace` (and MCP `trace_flow`) of a flow with an alt group now returns only the first branch by default**; `choose=*:both` returns every branch (with the `alt` frames, as before); a view on one arm drops the frame. Keys are stamped on such flows now. Flows without an alt group are byte-identical. UI: the dropdown, the Scenario chip, `ch=` (prefix with `:` and `,` replaced by `_`), counts and the Flows list "N decisions" chip work for them; the "both" entry reads "All" for more than two arms.

**Design drafts in edit mode.** Every decision starts on All (Both) there, so editing never hides a branch; outside edit mode the first arm is still the default. `choose=<group>:both` also works for an alt group id that contains a colon.

## 0.38.0 (2026-10-22): #82 part 3, the scenario UI
**UI.** The Flows page draws the new views. Defaults: External, and every either/or decision on its first arm.
- A decision is a divider row in the diagram with an inline dropdown of its arms and "Both"; a nested one has its own divider (indented, only while its parent arm is drawn); a locked one shows its reason and file:line (locks never go into a link). The flow header row has a "Scenario (N)" chip (accent while anything differs from the defaults) that opens a popover with every decision and "Reset to defaults", and a small External | Full switch (remembered per viewer). With "Both" the arms follow one another (a caption and a 3 px gutter marker per arm) and the step bar reads "6-7 messages per path". A service lifeline has a plain "⊕ internal" control that loads that service's internal calls (`open=`); Full loads all. DB operations are one "DB: N ops (collections)" row; a click opens them (`dbOpen=`).
- Links (active tab only): `ch=<first 8 characters of group_id>:<arm>,...` for the choices that differ from the default (longer on a clash), `detail=full`, `open=svc,svc:fn`. An old link opens the default view. An unknown group or arm in `ch=` is dropped with a toast.
- A comment, action item or note chip on a step the scenario hides says "Not in this scenario · Show" (Show switches that decision to the arm that holds the step); on an internal call that External does not load, "Not in this view · Show" (loads Full). Keys never change, so nothing is lost. A new Notes step chip also stores the step's key (`data-key`, `data-key-to`; the notes sanitizer keeps them), so it follows its step across scenarios; chips without a key keep reading numbers.
- Internal calls (Full, or after "⊕ internal") are rows of their own with a grey "internal" tag and a step number, no longer the folded "N internal calls" pill.
**API (additive).**
- `GET /api/envs/:env/flows/counts`: a flow that reaches either/or decisions also carries `decisions` (how many), `steps` (the default view: External, first arms), `both: {min, max}` (messages per path with Both) and `full` (every internal call, first arms). Other rows are unchanged. Cheap: only flows that reach a decision are traced, once per graph (`core/flow-decisions.ts`).
- `GET /api/envs/:env/flows/mermaid` takes `detail`, `choose`, `open`, `dbOpen`, `group` like the trace API and exports that view; without any of them it exports the full trace as before. The page's Export writes the view the tab shows. Step keys of an export are the canonical keys.
- Callers: `web/js/api.js` no longer sends `detail=full&choose=*:both` by default; a tab asks for `choose=*:both&group=0` and `detail` / `open` itself and chooses in the browser (`viewOf`), so choosing an arm needs no request.

## 0.37.2 (2026-10-22)
- UI: the step bar is always visible. On the first load of a flow the open Human description could push the bar out of the scrolling header, behind the diagram; now the description scrolls inside the header and the bar stays put (also maximized).
- UI: after Previous to step 0 (or Next at the last step) by mouse, focus moves to the other walker button, so the arrow keys, Home and End keep working.

## 0.37.1 and 0.37.0 (2026-10-22, shipped together)
**#82 part 2, A (0.37.0): arms and locks in the trace.** `GET /api/envs/:env/trace` and MCP `trace_flow` add, only for a flow that reaches an `alternatives` group (every other trace is byte-identical, tested against a golden file):
- `arms` on a message: the either/or arms it sits in, outermost first, each `"<group_id>:<arm>"` (split at the first `:`). An arm's step brings its whole subtree (callees, deliveries, async work). Nested groups: a message in an arm of a group that sits in an arm of another carries both.
- `decisions` on the trace, one per group reached, first seen first: `{group_id, name, template_name, llm_name, depends_on, guard, parent?: {group_id, arm}, lock?: {arm, at, source?, literal?}, lock_places?: {fixed, of}, arms: [{arm, label, guard_text, steps: {min, max}}]}`. `name` is `llm_name` when there is one. `steps` is what the arm shows as a range (a nested undecided group adds its smallest and largest arm, never the sum).
- Locks: `fixes` on a calling step hold for everything below that call on this path, like `bind` (#42); the nearer fix wins. The walk follows only the fixed arm and the decision reports `lock` (`at` = `<service>:<fn>#<seq>` of the fixing step). A group fixed at only some places reports `lock_places` (step visits) instead and nothing is dropped.
- `key` (the stable step key of the canonical trace, as `stepKeys` gives it) on every message of such a trace. A trace without decisions has no `key`, `arms` or `decisions`.
- Behaviour: `maxMessages` counts only the largest arm of a group (a hard ceiling of 4 x maxMessages pushed stops runaway duplication, `truncated`); the "seen at step N" rule (#43) now reuses an earlier expansion only when its arms are all on the later one's path, so a hidden arm is never pointed at. A flow without alternatives is unchanged.
- Demo: new sample services `member-api` (nested decisions, a lock, runs of DB ops) and `member-notifier`: DEMOS.md. The seeded env `prod` has two more services.

**#82 part 2, B (0.37.1): views. Breaking for callers that read the trace API or `trace_flow` messages: the default is now `detail=external`.** `GET /api/envs/:env/trace` and MCP `trace_flow` take:
- `detail=external|full` (MCP: `detail`). **The default is `external`** (the maintainer's decision): ingress, calls out of a service, deliveries and hops, DB operations, problems, and the only content of an arm. Internal calls, leaf notes and frontier markers are left out; there is no "+N internal" count. `detail=full` is exactly the trace of 0.37.0 (and, without alternatives, of 0.36.x). `open=svc,svc:fn` (MCP array) adds the internal calls of a service or function.
- `choose=<group_id>:<arm>,...` (MCP object `{group_id: arm}`, `both` allowed, `*:both` for both everywhere). Without it every decision follows its FIRST arm, a lock wins. The response carries `choose` (as applied), `decisions` (offered ones, with `chosen`), `counts.messages {min, max}` (exact unless `both` is chosen somewhere, never a sum of arms), `warnings`.
- `group=0|1` and `dbOpen=<key>,...`: consecutive DB operations of one store fold into one message `DB: 3 ops (users, devices)` with `dbGroup {count, collections, access, members}` (default on in external, off in full). `n`, `of`, `repeatOf`, `group`, `delivery` are renumbered to the view (#73).
- Messages carry `key` (stable, from the canonical trace) in any view that changes the list; `viewOf(trace, {choose, detail, open, dbOpen})` is the same pure code in `core/trace-view.ts` for the server and the browser.
- Callers to update (pass `detail=full` / `detail: 'full'` where they read internal calls or step numbers): the web UI (`web/js/api.js` and the preview's `api-local.js` now send `detail=full&choose=*:both`, so the page draws exactly what it drew before; the scenario UI is 0.38.0), the `set_description` prompts of `core/description.ts` (they now ask for `detail="full"`), and this repository's tests (about 60 trace calls). Anything of yours that reads `/trace` or `trace_flow` should do the same until it wants the shorter view. The flows Mermaid export, comments, notes, action items, step keys and the Flows list counts read the canonical trace and do not change.
- `trace_flow` description and input schema changed (MCP hash updated). `maxMessages` of a flow with decisions counts only the largest arm (0.37.0).
- Demo: DEMOS.md (`member-api`, API links). The 0.38.0 UI builds on `decisions`, `arms`, `key` and `counts`.

## 0.36.2 (2026-10-22)
- The step walker starts at step 0 (no step selected): a flow, tab or sub-flow opened without `step=` shows no highlighted step and the bar reads "Step 0 of N". Next goes to step 1, Previous from step 1 returns to 0 (no `step=` in the URL). An explicit `step=N` still selects that step.
- A tab of another environment, maximized, shows "read-only · Switch" next to the env chip (the full note is hidden there).
- Clicking a capped "Tab" button again no longer stacks identical toasts: the one showing stays and its timer restarts.
- On touch screens the Flows list "Tab" button has a 44px tall hit area.

## 0.36.1 (2026-10-22)
**#82 part 1: either/or alternatives on a step.** A step takes an optional `alternatives: [{group_id, arms: [{arm, label?, guard_text?, step_ids}], name?, name_source?, llm_name?, llm_provenance?, depends_on?: "data"|"message", guard?: {text?, file?, line?}}]` (extra fields allowed; old manifests unchanged). `group_id` and `arms[].step_ids` are required. Stored in the step's JSON: no migration. A step without it but with `details.alternatives` is read the same way (the top-level field wins), so data already on `attr-fix` works without a re-push; please move to the top-level field. `GET /api/envs/:env/trace` and MCP `trace_flow` return `alternatives` verbatim on each message whose step has them, plus `stepId`; absent means omitted. Steps have no id field: `stepId` is `<service>:<function id>#<seq>`, so send `step_ids` in that form. Also `fixes: [{group_id, arm, source?: {file?, line?}, literal?}]` on a step (the caller's literal fixes this arm; scoped to the path like `bind`): same storage, `details.fixes` fallback and verbatim return. No drawing change yet (parts 2 and 3 of #82 are the trace behaviour and the scenario dropdowns). The `trace_flow` description changed (MCP hash updated). Demo: DEMOS.md.


## 0.36.0 (2026-10-22)
- UI only (env colours, step 2): flow tabs of different environments sit side by side. In a link a tab key may start with its environment, `tabs=a/b,sase-hld|c/d&tab=sase-hld|c/d`; a key without one is the `env=` environment, so every old link reads as before, and the page leaves the prefix off for tabs of its own environment. A name with `|` in it is written `%7C`. Choosing another environment in the picker keeps the open tabs. A tab of another environment is read only (no pencils or forms; comments, notes and action items stay) and says so; each tab shows a short chip with its environment name while the open tabs span two or more. A tab whose environment does not exist shows "unavailable". No API, schema or MCP change.

## 0.35.0 (2026-10-22)
- **Environment colours (migration 018).** Every environment has a colour slot 1..10 (Teal, Orange, Violet, Rose, Green, Brown, Steel, Plum, Pine, Navy; `core/env-colors.ts`). `GET /api/envs/meta` and `GET /api/envs/:env/meta` return `color` (always resolved 1..10) and `colorAuto` (nobody chose it: NULL in `envs.color`, the slot follows creation order). New: `PUT /api/envs/:env/color {color: 1..10 | null}` on any environment (`422` otherwise; event `env.updated`), MCP `set_env_color`, and `list_envs` returns `color`, `colorName`, `colorAuto`. A new environment (ingest or copy) takes the lowest free slot; a copy never inherits its source's. Existing environments get a stored slot by creation order. Harvesters need no change.
- UI: the flow tabs' top bar, the picker, the Flows list header and the maximized bar carry the env colour; the transport hue moved to the tab's glyph and number. Environment settings has a Colour section.

## 0.34.1 (2026-10-22)
**#81: what a call returns.** A step takes an optional `returns: {label, detail?}` (manifest, draft function steps and plans, the call edit form, `edit_design` `{kind: 'call', returns}`; `null` clears). The label (1 to 80 characters, one line of plain text) is drawn on the dashed return arrow of a sync call, which says `return` without it; the detail (plain text, up to 500) shows in the step panel ("Returns") and as the arrow's tooltip. The trace message and `GET .../call` carry it. A bad value is a `422`. Stored in the step's JSON like `mark` and `groups`: no migration. The Mermaid import reads `B-->>A: text` into `returns.label` and the export writes it back. The MCP tool list changed (hash updated). Demo: DEMOS.md.

**#71 gaps closed.** A `rect` with a green colour (`rgb(214, 245, 214)`, `#d6f5d6`, `lightgreen`) marks its steps `new`, any other colour `changed`; the export writes a `new` step in the green rect, so it round-trips. A return inside a branch that holds no step of its own (`else` with only returns) has nothing to attach to: the import now warns with its line instead of dropping it silently. Still open: step titles (a separate store keyed by the step key, which only exists after the draft is applied) and the exact place of a note (it goes after the call it follows, so it can come after the callee's own calls).

### #71 Mermaid import (the fuller reading)
**Fuller Mermaid import (#71).** A Confluence `sequenceDiagram` imports 1:1. No schema or migration change; the edit forms and the trace gain a few optional fields. The importer reads, per construct:
- **Return arrows** (`-->>`, `--x`, `-->`): the label of the return is the **`returns.label`** of the call it answers (#81; `returns` on the trace message). They are never steps. A return labelled `return` (or empty) sets nothing. A second return in another branch of a frame (`alt` / `else`, one return each) does not replace the first.
- **Self-messages** (`A->>A: text`): an internal step of A (`kind: "leaf"`, `operation: text`, `details.self: true`) in the function A is in.
- **Notes**: `Note over A`, `Note over A,B`, `Note left of A`, `Note right of A` are note steps (`kind: "leaf"`, `note: text`) with `over: [component names]`, so the note spans those lifelines (#74). The step goes into the function that made the last call, after it (a return hands it back to the caller): never into the callee's function, which runs for every call to that endpoint. A note over a client or data store is skipped with a warning; before the first call it is skipped.
- **`rect <colour>` ... `end`**: `mark: "changed"` (a green colour: `"new"`) on every step inside it (calls, notes, self-messages), any colour (#75). `box` is still only a warning.
- **`alt` / `else`, `opt`, `loop`, `par` / `and`, `critical` / `option`, `break`**: `groups: [{id, kind, condition}]` on the steps inside, outermost first, nested as written, with the condition of the section the step is in (#72). A frame is declared on the steps of the function that made its first call; the calls below those steps run inside the drawn frame, so their functions do not repeat it. The `[alt: cond]` prefix of the step text is gone (0.27.4 wrote it).
- **`%% real: <bind key>`** on the line before a message, or at the end of the message line (`A->>B: text %% real: http:GET svc/x`): sets `details.real` of that step (`real` on the trace message). Self-messages too.
- **`%% flow: <name>`** sets the flow name (it wins over `title`). **`%% link: <label> <url>`** adds a flow link (#54): http or https only, the label is at most 120 characters; the first is the main link, the others are sub links (21 at most). A bad link is a warning with its line. Both are lower case, so the export's own header comment `%% Flow: <name> (<where>)` stays a comment.
- Still true: preview, the matching table, undo by batch, the sealed guard (`409 ENV_SEALED`) and "importing the same text again adds nothing" (notes and self-messages are found again by their words). Parsing stays linear: every line over 2000 characters is skipped, a return looks back at most 100 open calls.

**Export** writes the same constructs back, so export -> import round-trips them: `%% flow:` and `%% link:` lines before `sequenceDiagram`, `%% real:` before the message, frames as nested `alt`/`else`, `opt`, `loop`, `par`/`and`, `critical`/`option`, `break` ... `end` (also for frames a harvester or plan drew with `altGroup` / `groups`), `rect rgb(255, 244, 214)` around steps marked `changed` and `rect rgb(214, 245, 214)` around steps marked `new`, `Note over A,B:` for a leaf step with `over`, `A->>A:` for an imported self-message, the `returns.label` on the return line (`return` when none), and an undecided call by its operation instead of its `tbd:` key.
- **Edit forms / MCP `edit_design`:** the `call` form takes `groups`, `real`, `returns`; the new `{kind: "leaf", from: {service, fn}, operation?, note?, over?, mark?, groups?, before?}` adds a step with no target (a note over components, or an internal step). `import_mermaid` answers `summary` with `groups`, `marked`, `links` too. The MCP tool list changed (hash updated).
- Demo: `samples/mermaid/hld-full.mmd` (every construct), see DEMOS.md.

## 0.34.0 (2026-10-22)
Notes per flow, step-range comments and the tabbed bottom pane. Additive; migration `017_flow_notes.sql` (new table `flow_notes`, two nullable columns on `comments`); the MCP tool list hash moves (`get_notes`, `set_notes`, `list_mentions` returns `notes`, `add_comment` takes `steps`).
- **Notes per flow (importers and agents).** One document per flow, kept as versions: `GET/PUT /api/envs/:env/notes?anchor=flow:<service>/<ingress>`, `GET .../notes/history`, `POST .../notes/restore`, MCP **`get_notes`** and **`set_notes`** (`body`: Markdown-lite headings or HTML; `base_version` refuses a stale write with `409 STALE_NOTES`). The body is the comment HTML subset plus `h2`, `h3` and the step chip `<span data-step="4">` (`"4-9"` for a range). Works in every environment, sealed and harvested too. Event `notes.updated`. A Full copy carries the notes; `@[userId]` in the current notes is listed by `GET /api/mentions` and `list_mentions` as `notes`. Details in [API.md](API.md) "Notes per flow".
- **Comments on a range of steps.** A comment may carry `steps: {from, to}` (step keys of the flow, 2 or more steps) instead of `step`: REST `POST /comments`, MCP `add_comment` (`steps: {from, to}`), returned as `steps` on every comment. The Mermaid export writes a range comment as a `rect` around those messages with a `Note over` carrying the comment's first line (plain comments and Notes are not exported); the importer will read it back (0.33.1).
- UI: the pane under a flow's diagram is tabbed (Notes, Comments, Action items) with a tab row that never scrolls away and a draggable border to the diagram; brackets for step ranges in the diagram's left gutter (Step details: "Comment brackets", on in design environments, off in harvested ones).

## 0.33.3 (2026-10-22)
- UI only: **the active tab is clear, a click replaces it, "Tab" opens a new one, at most 10 tabs (maintainer).** The active tab joins the pane (same fill, a full top bar, a bold label); the others recede. A click on a flow in the Flows list opens it in the active tab (a flow that is open elsewhere is switched to; no tabs: the first tab). Every list row, "All endpoints" rows included, has an always-visible "Tab" button that opens it in a new tab. Ten tabs is the limit in every opener (toast "You have 10 tabs open. Close some tabs to open another."; the Tab buttons turn dashed and `aria-disabled`; the overflow button reads "8/10" from 8). "Open all distinct" opens what fits and says how many it skipped; a link with more than 10 tabs opens the first 10 (a `tab=` beyond them takes the last slot).
- UI only: **#80, component page header.** The name and its badges stay on one line, the description goes under them and the doc-link chips get their own wrapping row below it, at every width.

## 0.33.2 (2026-10-22)
- UI only: **a sub-flow has a way back (maintainer).** A tab opened from another flow (an async consumer, "Full flow from here", "Zoom in to ...", "Open the async flow in a tab") shows "← Back to <main flow>" with a "Main flow › Sub-flow" trail at the top (and first in the maximized bar). It switches to (or reopens) the main flow's tab on the step you left; the browser's Back button does the same (opening a sub-flow now adds a history entry, and `step=` no longer leaks into the URL of another tab).
- **`owners`: an entry that reads as a user id is an id.** A string `u_...` (no spaces) that is not a user is a `422` (`owners[1]: no user 'u_abc'`) and creates nobody; before, only `u_` plus 8 hex digits was checked and anything else became a new user named after it. Names still match or create users.
- UI only: the info pane's `E` expands it whenever it is open and focus is not in a field, an editor or a dialog; the subsystem pane's sub line wraps as one text (no dangling "Subsystem ·"); the pane's section bar wraps at the 340 px minimum width instead of touching the edge.

## 0.33.0 (2026-10-22)
The info pane of a component or a subsystem (bug #68 part 2). Additive; no migration; the MCP tool list hash moves (`list_open_questions`, `owners` on `edit_design`, `set_subsystem_settings`, `create_env` groups; `list_mentions` also returns `about`).
- **`owners` (importers and harvesters).** A component header (`service.owners` in a manifest, `extensions[].owners` and `manifests[].service.owners` in a plan, `{kind: 'component', owners}` in `edit_design`) and a subsystem (`environment.groups[].owners`, `groups[].owners` in `create_env` / the sealed `PUT /api/envs/:env/subsystems`, `{kind: 'subsystem', owners}`) take a structured list of people next to the free-text `## Owners` section (which stays allowed). Each owner is a **name**, or **`{name?, externalSource, externalId}`** (for example a Confluence account id), or a user id (`u_...`). The server matches it to a user like every other person: external id first, then an exact name or alias (case and space-insensitive), else a new user is created; it is stored and read back as a **list of user ids** (`GET .../services/:name` `service.owners`, `GET .../subsystems` `owners`). Left out keeps what is there (a delta, a plan, a settings list); `[]` (or `null` in an edit) clears. At most 20; a bad entry is `422` naming where (`owners[0]: ...`). Schema: `service.owners`, `$defs.owner`; a dry run creates nobody. Shown in the pane's Overview and editable there as user chips.
- **`@{Display Name}` in an `about`** (manifest, plan, edits, settings, create_env groups) is written as the token `@[userId]` when a user of that name exists (the rule of `add_comment`); an unknown name stays plain `@Name` text and creates nobody. The pane draws a token as a chip.
- **`GET /api/envs/:env/open-questions[?draft=]`** and MCP **`list_open_questions {env, draft?}`**: every list item of a `## Open questions` section in the `about` of the components and subsystems of an environment, as `{count, questions: [{kind: 'component' | 'subsystem', id, label, subsystem, text, index, line}]}` (subsystems first, then components by name; a draft shows as it would leave them). Write questions as list items under that heading; the Questions page and the rail count read them.
- **`GET /api/mentions` and MCP `list_mentions` also return `about`**: `[{env, kind, id, label, text}]`, the About texts that `@[userId]` mention the user (never unread, not in the rail badge). Empty with `unread=1` or `anchor`.
- **`GET /api/envs/:env/flows-through?service=a,b`**: the entry points (as `GET .../entry-points` rows) whose flows run through any of those components.
- UI: the right-hand info pane for a component or a subsystem (System map at both levels, a flow's lifeline head or subsystem band, `sel=svc:<name>` / `sel=grp:<key>` in the URL), an expanded page (`expanded=1`), editing the About in place, the Questions page, and owners.

## 0.32.5 (2026-10-22)
UI only. No API, schema or manifest change, no migration.
- **Flows list, Group by (#79).** "Group by: Component | None" above the filters. None is one flat list in natural name order (`ARL_2` before `ARL_10`), unnamed entries after the named ones by their key. Default None in design environments, Component in harvested ones; `group=` in the URL only when it differs from that default; remembered per environment. The Component and Subsystem filters apply in both modes.
- **Current-step highlight.** The numbered black dot of the current step always shows. The bordered rectangle is replaced by a soft yellow filled band behind the step row (new token `--step-hl`, light and dark). "Highlight current step" in the Step details panel turns the band off (`hl=0` in the URL, remembered per viewer).
- Seeds: `samples/flow-names/<env>.json` names three flows of `hld-drawing` (a name already given is kept).

## 0.32.4 (2026-10-22)
**Trace order after an async call** (bug #73 of corev5-importer). No migration, no schema change. **The order of `messages` changes for flows where the caller has steps after an async call; the messages themselves do not.**
- **The rule (one, for every async call).** A step with `mode: async` draws its arrow where it stands, and the callee's work (what a consumer does after a delivery, what an async call or egress to a service runs) comes **after the rest of the calling function's steps**, not right after the arrow. Before, a caller step that followed an async publish (an audit call, a second publish, a cleanup) was listed after the whole consumer subtree, so it read as if the consumer had called it. Harvested fan-outs follow the same rule (their consumers already ran after the last delivery; now they also run after the caller's remaining steps). Sync calls are unchanged. An async call inside an `alt` / `loop` frame keeps its frame for its arrows and counting.
- **Additive tags on trace messages (MCP `trace_flow`, `GET .../trace`).** `n` (the 1-based message number) on a message that starts deferred work (a delivery, an async call or egress), and `of` on every message of that work: the `n` of the innermost delivery or async call it runs under. The caller's own steps have no `of`. A consumer's whole work is contiguous and tied to its delivery by `of`, so use `of`, not `depth`, to tell a consumer's steps from the caller's later steps. Consumers that ignore unknown fields need no change; `depth`, `group`, `delivery` and `repeatOf` mean what they meant (`repeatOf` and `group` ids are message numbers, so they follow the new order).
- **What moves in the sample data:** 4 of 83 prod entry points list their messages in another order: `api-gateway/in.createOrder` (the audit POST at step 25 now follows the order-events publish), `cp-middleware/in.deviceLogout` (the firmware publish comes before the consumers' work), `saga-controller/in.start`, `saga2-eraser-entry/in.erase` (the second and third status-event fan-outs come before the deeper work). `traceHash` of those 4 changed (descriptions of them show "outdated" once); the other 79 are identical.
- UI: the flow view draws a publish region from the tags, so the consumer cards and the "Inside the service" subflows keep their rows when the caller continues in between. The Mermaid export lists the same new order (create-order golden updated).

## 0.32.3 (2026-10-22)
- UI only: the MCP author user "Assistant" is no longer a choice in the sign-in picker or the "@" mention picker (it stays on the Users page and as an author).
- UI only: the "@" mention popup flips above the caret when there is no room below it.
- UI only: the sign-in picker list uses up to 60% of the window height before it scrolls.
- UI only: a flow link takes `comment=<id>` (a comment or a reply): the flow tab opens its comments, scrolls to it and outlines it. Rows on the Mentions page use it.
- UI only: a link to an environment created after the page was loaded now works (the environment list is fetched again once); an environment that does not exist shows "No environment <name>" with a button to choose one, instead of a blank page.

## 0.32.2 (2026-10-22)
HLD flow drawing (bugs #72, #74, #75, #76 of corev5-importer). Additive; no migration; the MCP tool list hash moves (`edit_design`'s `call` form takes `mark`).
- **#72 nested frames (`groups` on a step).** A step can list the frames it sits in, outermost first: `"groups": [{"id": "each", "kind": "loop", "condition": "for each item"}, {"id": "pay", "condition": "card"}]`. `kind` is `alt` (default), `opt`, `loop`, `par`, `critical` or `break`; steps with the same `id` are in one frame, the same `condition` in one section. The flow view draws the frames inside each other (inset per level, every frame's tab and condition visible) and the "Inside the service" panel nests the blocks. The trace message's `alt` keeps `{group, branch, of}` for the innermost frame and gains `kind`, `condition` and `parent` (the enclosing frame). `altGroup` / `condition` work as before; `groups` wins for a step that has it. The schema takes `groups`; `maxMessages` counts a nested frame toward its parent's branch.
- **#74 notes over several lifelines (`over` on a leaf step).** `{"seq": 5, "type": "call", "kind": "leaf", "operation": "order served", "note": "...", "over": ["orders-svc", "cache-main", "orders-db"]}` draws the note as a box spanning the leftmost to the rightmost of those lifelines (components, or data stores by instance / database name); over one name it sits under that lifeline; folded lifelines: out to the fold column's edge. A leaf without `over` is not drawn, as before. The trace message carries `over`.
- **#75 step marks (`mark` on a step).** `"mark": "new" | "changed"` on a manifest step, a plan step, a `call` design edit (`{kind:'call', ..., mark}`; `null` clears it; REST `edits` and MCP `edit_design`) or any function upsert. Drawn like the component and flow marks: a coloured band along the arrow plus the mark icon at its tip; `details.changed` (free text) stays the tooltip and shows in the step panel. "Changed only" counts it: an entry point whose flow runs a marked step has `marked: n` in `GET /entry-points` / `list_entry_points` (design environments) and is listed as changed. Trace messages carry `mark` and `changed`. **MCP hash moves** (`edit_design` description). Schema and the demo sample change together.
- **#76 step labels.** UI and URL only, no data change. A step's arrow shows its **title** when it has one (0.30.0 titles); the bind key is in the arrow's tooltip, the step panel and the step bar's API line tooltip. A `tbd:<component>/<operation>` key is never drawn: the step's `operation`, else the key's last part. The Step details "Arrows" default depends on the environment kind: a **design** environment shows Title (a step without a title falls back to its API), a harvested environment shows API as before. `sd=` is left out of the URL at the environment kind's default (so `sd=a` is kept in a design, `sd=t` in a harvested environment); a viewer's remembered choice still wins. New preset "Title, else API".

## 0.32.1 (2026-10-22)
- **`POST /api/envs` / MCP `create_env`: `source` is optional for `mode: 'blank'`** (#77): a known one is still recorded as lineage, a missing or unknown one leaves `source` `null`. `components` and `full` still need it: a missing `source` is now `400` with `details.field: 'source'` instead of a `404` about `'undefined'`.
- UI only (#78): the environment menu has "Delete environment" for design environments (not for harvested ones or the default environment), behind a confirm where you type the environment name. It uses the existing `DELETE /api/envs/:env`; afterwards the UI switches to the default environment.

## 0.32.0 (2026-10-22)
**Users, sign-in and @mentions** (bug #66, part 2). Migration `016_users.sql` (additive; the live database is backed up first as `<db>.pre-016.bak`). Spec: [plans/users-mentions.md](plans/users-mentions.md). Everything below is backwards compatible: a client that still sends `author` / `actor` names keeps working.
- **Users registry (new):** `GET /api/users`, `GET /api/users/:id`, `POST /api/users {name, externalIds?: [{source, externalId}], match?}`, `PATCH /api/users/:id {name, keepAlias?}`, `POST /api/users/:id/merge {into}`. Users are global (not per environment); names are unique ignoring case and spacing; there is no delete (a merge folds one user into another, keeps the old name as an alias, and the merged id still resolves). Existing comment authors and action item owners became users in the migration.
- **Identity (importers and scripts, read this):** the web UI now sends the header **`X-Flow-User: <userId>`** on every request and has no name field. REST clients without it keep sending `author` (comments) / `actor` (action items, resolve) / `owner`: each is **matched** to a user (external id, then exact name or alias, case and space-insensitive) and a user is created when none matches. The header wins over a name in the body. MCP writes are by **"Assistant"** unless `author` is given (`author` is no longer required on `add_comment`, `resolve_comment`, `add_action_item`, `update_action_item`).
- **Author matching on import:** `authorExternalId` + `externalSource` (comments) now **create or link a user**: the same external id is the same user whatever name the importer sends, and an unknown pair creates a user that holds it (the id is shown on the Users page). Send the same pair on every run.
- **Rows:** comment rows and nodes add `authorId`; action items add `ownerId` and `createdById`; reads show `author` / `owner` / `createdBy` under the user's **current** name. Action items take `ownerId` as well as `owner`. Edit and delete compare user ids (a rename never locks the author out), falling back to the name for rows without an id.
- **Mentions (new):** a comment body may hold the token **`@[userId]`**, or the name form **`@{Display Name}`** (resolved by the server to the token; an unknown name **creates a user**). The sanitizer keeps tokens as text. `GET /api/mentions?user=&unread=1&env=&anchor=` (all environments), `POST /api/mentions/seen {user, commentIds}`, `GET /api/envs/:env/mentions/counts?user=`. A Full copy keeps authors, owners and tokens (its mentions are not unread). Plain "@Name" text in old comments stays text.
- **MCP:** `list_users {query?}`, `list_mentions {user, unread?, env?, limit?}`; `add_comment` accepts `@[id]` and `@{Display Name}`. The tool list hash moved (two tools added, `author` no longer required on four tools).
- **Samples:** prod has three users (one with the Confluence id `noa.barak`) and two comments that mention "Asaf G." and "Dana Levi" (written as `@{Name}`, so a re-seed adds nothing twice).
- **UI:** a sign-in button under the environment picker (avatar with initials, menu: Switch user, Users, Sign out); the sign-in picker; no name prompts anywhere; "@" picker and an "@ Mention" toolbar button in the comment editor; chips in threads; a **Mentions** page with an unread badge in the rail; "@ n new" on Flows list rows; "Mentioned me" filter in a flow's Comments header; action item owners as avatar and name; a **Users** page with rename and merge.

## 0.31.1 (2026-10-22)
UI only: a small pencil on every editable item (service header, Docs, About and each section, endpoint and flow rows, Inventory rows and subsystem headers, the map and flow panels) opens the same form the diagram uses; in View mode it first picks or starts a draft. Harvested environments keep only the flow and step description pencils. Also (#69 follow-up): Fit now enlarges a short flow to fill the panel, up to 200%.

## 0.30.4 (2026-10-22)
UI only (#70): on a flow arrow, "transport not decided" is a small icon (its words in the tooltip and in the step bar); the new toolbar toggle "Transport hints" (`th=0|1` in the URL, left out at the default) shows the full label again. Default: off in a design environment, on elsewhere. Decided transports keep their compact label.

## 0.30.3 (2026-10-22)
UI only (#69): the flow diagram zooms: a "- [100%] + Fit Reset" control in the flow toolbar (and in the bar of a maximized flow), Ctrl/Cmd + wheel and pinch around the pointer; per tab, `zoom=` in the URL (25 to 400, or `fit`; left out at 100).

## 0.30.2 (2026-10-22)
**`about`: a rich description per component and per subsystem** (bug #68, the data part; the dedicated info pane is a later, separate UI). Additive; no migration (it lives in the service header JSON and in `envs.groups` JSON).
- **Manifest (harvesters and importers):** optional **`service.about`**, a string of at most 20 000 characters, next to `description`. Markdown-lite: `##` / `###` headings, paragraphs, `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, fenced code, `- ` and `1. ` lists, `[text](https://...)` links. No HTML (it is shown as text) and only `http(s)` links. By convention the sections `## Capabilities`, `## Motivation`, `## Roles and responsibilities`, `## Owners`, `## Open questions`; nothing enforces them. Status, doc links (`links`) and related flows already have their fields: do not repeat them in `about`. A changed `about` is a Changed mark on the component, like any header field. Over the limit or not a string: `422` from ingest.
- **Import plan:** `manifests[].service.about`; `extensions[].about` sets or replaces it on an existing component (`''` clears); `environment.groups[].about` (and `groups[]` of the plan) sets a subsystem's text. For a group the design already has, the plan's `about` replaces the stored one (a re-import is idempotent); its label is still kept. A too long group text is a warning and is left out.
- **Design edits (REST `edits`, MCP `edit_design`):** `{kind:'component', ..., about?}` and `{kind:'subsystem', key, about?}`; `''` (component) or `''` / `null` (subsystem) clears it, leaving it out keeps it. A text over 20 000 characters is `422 INVALID` with `field: 'about'`.
- **Subsystem lists:** `PUT /api/envs/:env/subsystems` (sealed), MCP `set_subsystem_settings` and `create_env` / `POST /api/envs` `groups[]` take `about` per group; a list item that leaves `about` out keeps the stored text, `''` or `null` clears it.
- **Reads:** `about` comes back wherever the header or the groups do: `get_service` / `GET /services/:name` (`service.about`), the system graph node, `GET .../subsystems` and `get_subsystems` (`subsystems[].about`), the subsystem map boxes, `GET /api/envs` (`groups[].about`).
- **UI:** an "About" block (folded after about 12 lines, "Show all") in the component page and map panel and in the subsystem panel; in a design draft the component form has an About field with Write / Preview, and the subsystem panel has "Edit".

## 0.30.1 (2026-10-22)
UI only (#67): in the flow view with Group by subsystem, a data store is drawn inside the subsystem band of the component that declares it (its collections too); a store with no owner in a subsystem goes to a "Shared" band at the end. Resource-step trace messages carry an additive `owner` (the declaring component).

## 0.30.0 (2026-10-22)
Step details: a step (one arrow of a flow) can carry a short **title** next to its description. Additive; migration `015_step_titles.sql` (`ALTER TABLE descriptions ADD COLUMN title TEXT`; backed up to `<db>.pre-015.bak` first; 014 belongs to another branch and the runner does not need contiguous numbers). Details in [API.md](API.md) "Flow descriptions".
- **Agents (MCP `set_description`):** new optional argument **`title`**, for a step (`callee` starting `#step:`) only: a short name for the arrow, at most 80 characters, trimmed; ignored for other callees. Omit it to keep the stored title, send `''` to clear it. `text` may be empty when the note carries a title (a title-only note). The human title wins over the AI title, like the text.
- **REST:** `PUT /api/envs/:env/descriptions` takes the same optional `title` (a step). Reads return `title` (string or null) in every `human` and `ai` record. An empty text with no title removes the human record. A title over 80 characters is `400`. `get_service` descriptions carry `title` when set.
- **Mermaid export:** a step with a title writes the title as the message text and the API (`POST /path`) into a `Note over` line.
- **UI:** the Step bar shows the step's title, API and description (`sb=`); the toolbar control "Step details" also puts title / description on the arrows (`sd=`; default API only); a step editor (button, pencil, right-click, key E).

## 0.29.2 (2026-10-22)
Comment importers (bug #66, first part): your own ids and times on comments, an idempotent re-import, and resolved threads. Additive; migration `014_comments_import.sql` (five new columns on `comments` and a partial unique index; the database is backed up to `<db>.pre-014.bak` first). Details in [API.md](API.md) "Comments under a flow". The users registry and @mention chips are not part of this: a mention stays plain `@Name` text.
- **`POST /api/envs/:env/comments` takes:** `createdAt` (ISO 8601, kept as that instant, stored as UTC; `400` if not a time or more than 5 minutes ahead), `externalSource` + `externalId` (both or neither, at most 200 characters each), `authorExternalId`, `parentExternalId` (instead of `parentId`; looked up by `externalSource` + that id in the same env, so send parents first; unknown is `400`), `resolved` (true/false) with `resolvedBy` / `resolvedAt`.
- **Re-import:** posting the same (`externalSource`, `externalId`) again **updates** that comment (body, author, step, `createdAt`, `authorExternalId`; `resolved` only when you send it) and answers **`200` with `updated: true`**; a new comment is **`201`** (**breaking** only if your client checked for exactly `200` on create: creating comments answered `200` before). It never duplicates. The same pair under a different flow is `409 EXTERNAL_ID_TAKEN`. A comment someone deleted comes back on re-import. `parentExternalId` of a reply is not re-parented.
- **Resolve:** `PATCH /api/envs/:env/comments/:id {actor, resolved: true|false}`: anyone may resolve or reopen a thread (top comment; a reply is `400`, its thread decides). Body edits stay author-only and cannot be sent in the same request. Reads return `externalId`, `externalSource`, `authorExternalId`, `resolved`, `resolvedBy`, `resolvedAt` per comment (replies show their thread's state), and the thread has `resolvedThreads`.
- **Counts changed:** `GET .../comments/counts` is now the number of **open top threads** per flow (resolved threads and replies are not counted).
- **Events:** `comment.resolved` and `comment.reopened` (once per change).
- **MCP:** `add_comment` takes the same fields (and returns `updated: true` on a re-import); new `resolve_comment {env, id, author, resolved}`; `list_comments` returns the new fields.
- **Copy:** a Full copy carries the importer ids and the resolved state.
- UI: "Resolve" / "Reopen" on a thread; resolved threads are hidden behind "Show resolved (n)"; an imported comment shows its given time and a small "imported" hint (tooltip: source and id).

## 0.29.1 (2026-10-22)
UI only: a Maximize button (key F) on every flow header fills the window with the flow, its action items and comments; `max=1` in the URL opens it that way.

## 0.29.0 (2026-10-22)
Action items under each flow: owner, description, status and due date, linked to comments. Additive; migration `013_action_items.sql` (two new tables, nothing existing is touched; the database is backed up to `<db>.pre-013.bak` first). Details in [API.md](API.md) "Action items under a flow".
- **REST:** `GET /api/envs/:env/action-items?anchor=flow:<s>/<i>[&draft=]` -> `{items, events, next}`; `GET .../action-items/counts` -> `{anchor: openCount}`; `POST` `{anchor, owner, description, status?, due?, step?, commentId?, actor}`; `PATCH .../:id` `{actor, owner?, description?, status?, due? (null clears), step? (null clears)}`; `DELETE .../:id?actor=`. Status is `open | progress | done | dropped`; `due` is `YYYY-MM-DD`. Numbers (`#1`, `#2`...) are per flow and never reused.
- **Rules:** anyone edits any field (the `actor` is kept in `updatedBy`); only the creator deletes (`403 NOT_CREATOR`). Validation errors are `400 VALIDATION`. Any environment takes them, sealed ones too, and `?draft=` works like comments.
- **Events (`GET /api/events`):** `action_item.created`, `action_item.updated`, `action_item.deleted`, each with `env` and `data {anchor, id, number, status, actor}`.
- **MCP:** `list_action_items {env, service, ingress, draft?}`, `add_action_item {env, service, ingress, owner, description, author, status?, due?, step?, commentId?, draft?}`, `update_action_item {env, id, author, owner?, description?, status?, due?, step?}`. What MCP writes has `source: "ai"` (a "by AI" chip in the UI). The tool list hash moved (three tools added).
- **Copy:** a Full copy carries items, their events and the comment links; Blank and Components copies do not.
- UI: an "Action items (3 open · 5)" section above Comments, "+ Action item" and "Make action item" on comments, events under a comment, and an open-actions badge per entry in the Flows list. The static preview shows them.

## 0.28.4 (2026-10-22)
Flows list in design environments, from #65. No migration.
- **Breaking (default flip):** a Components copy (`POST /api/envs {mode: "components"}`, MCP `create_env`) now defaults to `entryPoints: "none"`: copied ingress get `entryPoint: false` and are not entry points. Pass `entryPoints: "keep"` for the 0.28.3 behaviour. Full copies still default to `keep`. Existing environments are unchanged. `create_env`'s description changed (the tool list hash moved).
- UI: in a design environment the Flows list shows flows only (an entry point with a flow name, a description or `entryPoint: true`). "All endpoints" lists every endpoint as before and is kept in the URL (`endpoints=all`). A component's own list and harvested environments are unchanged.
- "Changed only" compares against the baseline, so a copied item equal to the baseline is not marked. This could not be reproduced on a fresh copy, an import or a `behaviour: true` copy; if you still see copies marked as changed, add to #65 how the environment was made.

## 0.28.3 (2026-10-21)
Two Components-copy options from the importer's bugs. Additive; no migration. Details in [API.md](API.md) (`POST /api/envs`) and [DESIGN-IMPORT.md](DESIGN-IMPORT.md).
- **`entryPoints: "keep" | "none"`** on `POST /api/envs` and MCP `create_env` (#63; default `keep`, today's behaviour). `none` sets `entryPoint: false` on every copied ingress, in the environment and in its baseline, so the copies are not entry points, show no marks and diff as unchanged; ingress added later are unaffected. Works for `components` and `full`; `422` for another value or for `blank`.
- **`infraGroupPath`** (#64; components mode, default `infra`): the synthetic `<source>-infra` service now has a `groupPath` (it had none), so it is a box in the subsystem view. Validated like any groupPath; it need not exist in `groups` (a derived box). **Behaviour change:** new Components copies carry `groupPath: "infra"` on that service. Existing copies are not migrated: set its `groupPath` with one edit.

## 0.28.2 (2026-10-21)
Flow-to-flow relations (#50). Additive; no migration (the table came with 012). Details in [API.md](API.md) "Flow relations" and [DESIGN-IMPORT.md](DESIGN-IMPORT.md).
- **Plan `links[]` between flows are applied now** (they were skipped with "flow relations land in 0.28.2"): `{from: "flow:<s>/<i>", to: "flow:<s>/<i>", type, note?}` with `type` one of `contradicts`, `variant-of`, `supersedes`, `same-topic` (`variant`, `variant_of`, `same_topic` accepted) becomes the draft item `rel:<id>`. A bad one is a warning and is skipped. The result's `links.flow` counts them, `links.skipped` / `skipped.links` only the ones not applied. **Counts that moved:** a plan with flow relations adds one op each.
- **Drafts imported before 0.28.2:** `POST .../drafts/:slug/plan/links` (MCP `apply_plan_links`) now adds their kept relations as well (`409 NO_CHANGE` when nothing is new).
- **Edits:** `{kind: 'flow-relation', from: {service, ingress}, to: {service, ingress}, type, note?, id?}` (`id` changes an existing relation); `{kind: 'delete', anchor: 'rel:<id>'}`. New codes `BAD_TYPE`, `NO_FLOW`, `SAME_FLOW`. A symmetric type (`contradicts`, `same-topic`) is stored once whichever flow is `from`. Deleting a component or endpoint deletes the relations that name it, in the same request.
- **REST:** `GET /api/envs/:env/flow-relations?service=&ingress=&type=&draft=`: `[{id, type, from, to, note?, other, direction, phrase}]`, with `phrase` written for the asking flow ("supersedes" / "is superseded by"). Design environments only (a sealed one answers `[]`).
- **MCP:** `list_flow_relations {env, draft?, service?, ingress?, type?}` (read); writes through `edit_design`. `edit_design`'s description changed (the tool list hash moved).
- **Marks:** `rel:<id>` New / Changed / Removed, counted in `counts.relations`. A Full copy of a design carries its relations.
- UI: "Related flows (n)" under the flow's description, + relation / Edit / Remove in Edit with a draft, a relation filter and a badge in the Flows list (`rel=any|<type>` in the URL). The static preview shows them.

## 0.28.1 (2026-10-21)
UI only, nothing for harvesters or importers: the subsystem level in the web UI. The 0.28.0 routes and edits are unchanged.
- **System map:** a Subsystems | Components level control (`level=subsystems` in the URL; hidden in an environment without subsystems), subsystem boxes with the rolled-up calls and the abstract links, regions round the components at component level.
- **Abstract links:** "+ link", a panel with Refine (From, Via, To), the suggestions with "Use <name>" and "Make it a call…" (the call builder). A refined link folds into its line ("includes: <name>").
- **Marks:** a subsystem's `what` now names each kind (`1 new component, 1 changed component`; a single kind reads as before).
- **Flows:** subsystem bands over the heads ("Group by subsystem", on by default) and a per-flow colour de-clash. **Settings:** `#/envs/<name>/settings` (name, icon, order, level names).

## 0.28.0 (2026-10-21)
The subsystem level (backend; the UI follows in 0.28.1). Details in [API.md](API.md) "Subsystems". Migration 012 is additive (the database is backed up to `<db>.pre-012.bak` first).
- **Breaking, plans and edits:** a component belongs to **exactly one subsystem** (maintainer decision; `alsoIn` / #51 will not be built).
  - **`422 TWO_GROUPS`**: a plan (manifest + extension), an ops request, an edit batch or `apply_import_plan` that gives one component two different subsystems is refused, nothing is written. The message names the component and both paths.
  - **`details.alsoIn` (and a top-level `alsoIn`) on a manifest header or extension is refused** with the same code ("a component belongs to one subsystem: pick one"). Remove it from your plans.
  - Changing a component's `groupPath` (edit form, ops, extension) **moves** it: the old value is replaced. A move shows on both `grp:` boxes and in the draft's changes ("subsystem: Network → Platform").
- **Breaking, small:** in the plan result `skipped.links` now counts only the links **not applied** (it counted every link before; links used to be kept and never applied). New `links: {abstract, flow, skipped}`.
  Suites that deepEqual `GET /marks` `counts` see three new keys (`subsystems`, `links`, `relations`), and marks gain `grp:` anchors (see below).
- **Plan import** now applies `links[]`: an abstract link (ends `grp:` / `svc:` / `ing:`, `egr:` as `from`, no `type`) becomes `link:<id ?? slug(name)>`; a bad link is a warning and is skipped, the rest imports; a typed flow link is skipped
  with "flow relations land in 0.28.2". `environment.groups` the design lacks become subsystems (with `icon`); a different label for a known key is a warning. **Refine, do not delete:** when a link's ends become endpoints, set its `refinedBy`
  (the `refine-link` edit) instead of deleting it; it stays and folds into its roll-up line.
- **A draft imported before 0.28** kept its links without applying them: `POST /api/envs/:env/drafts/:slug/plan/links` (MCP `apply_plan_links`, `{from?}`) re-reads them (`409 NO_CHANGE` when there is nothing new).
- **Anchors** `grp:<path>` (a subsystem's settings), `link:<id>` (abstract link), `rel:<id>` (flow relation, 0.28.2). `GET /marks` carries `grp:` and `link:` marks and `counts.subsystems` / `counts.links` / `counts.relations` (additive).
  A subsystem is New when every component in it is New, Changed when a member changed or moved or a link into it is marked; reordering never marks.
- **REST** (all take `?draft=`): `GET /api/envs/:env/subsystems`, `.../views/subsystems` (boxes, calls rolled up by subsystem, transport and mode, each counted once), `.../abstract-links[?subsystem=]`, `.../abstract-links/:id` (with `suggestions`).
  `PUT /api/envs/:env/subsystems` (sealed only; a design is `409 USE_DRAFT`) and `PUT /api/envs/:env/levels` (any environment) are annotations. `GET /api/envs/meta` groups carry `icon` (`platform agent network cloud shield database`); `POST /api/envs` `groups` accept it.
- **Edits** (`edit_design`, `POST .../edits`): `{kind: 'subsystem', key, label?, icon?, order?}`, `{kind: 'abstract-link', ...}`, `{kind: 'refine-link', id, from?, to?, use?, call?}`; `delete` accepts `grp:`, `link:`, `rel:`.
  New error codes: `BAD_KEY`, `BAD_ICON`, `GROUP_IN_USE`, `TWO_GROUPS`, `NO_END`, `BAD_END`, `SAME_END`, `NOT_INSIDE`, `REFINE_DANGLING`. `NO_GROUP` now reads the subsystems of the request's result (one added in the same request counts).
- **MCP:** `get_subsystems`, `get_subsystem_map`, `list_abstract_links`, `suggest_refinements`, `apply_plan_links`, `set_subsystem_settings` (sealed: at once; a design needs `draft`), `set_levels`. `edit_design` and `apply_import_plan` descriptions changed.
- A Full copy of a design copies its links and baseline groups; Blank and Components copies do not. Harvester ingest into a design is still `409 ENV_DESIGN`. Traces are unchanged (golden hashes identical).

## 0.27.5 (2026-10-21)
- UI: the Comments section sits under the diagram, at the bottom of the flow page (maintainer request). The diagram keeps at least 260 px; the comment pane scrolls.

## 0.27.4 (2026-10-21)
- Mermaid export and import of flows (details in [API.md](API.md) "Mermaid"). Additive; no migration.
  - Export, any environment (sealed and the static preview too): `GET /api/envs/:env/flows/mermaid?service=&ingress=&draft=` answers `text/plain`; MCP `export_mermaid {env, service, ingress, draft?}` -> `{text}`. The full trace as `sequenceDiagram`: `participant <id> as <name>` per lifeline (channels and data stores labelled by their key, the entry client an `actor`), `->>` with its `-->>` return, `-)` async, `Note over` the step description, `title` the flow name, a `%% Description:` comment.
  - Import, design environments only, always into an open draft (sealed: `409 ENV_SEALED`): `POST /api/envs/:env/drafts/:slug/mermaid/preview {text, matches?, groupPath?}` (writes nothing), `POST .../mermaid {text, matches?, groupPath?, author?}` (201), MCP `import_mermaid {env, draft, text, matches?, groupPath?, dryRun?}`.
  - Dry-run / preview shape: `{title, description, summary, participants: [{id, label, actor, match, how, candidates, source?, note?, choice, createName}], matches, components, source, creates, imports, counts {components, endpoints, calls, notes, reused}, undecided, flow {service, ingress, name?}, edits: [DesignEdit], ops, warnings: [{line?, text}]}`. An agent sends the `matches` back, corrected: participant id -> a component name, `{create: true, name?}`, `{fromSource: true}`, `{client: true}` or `{skip: true}`.
  - Matching, in order: id or `as` label equals a component name (`how` `exact` / `alias`); normalized equal (case, `-` `_` space, a trailing `-svc` / `service`); a close spelling (2 edits or fewer, only when exactly one component is that close, 4 letters or more); a name only the source environment has (`in-prod`). A name found only in the source is **never imported by itself**: the default is `create`, copying it (one level, the 2a-1 import rules, same batch) is the choice `{fromSource: true}`. A label that is a key (`sns:q`, `users-db.users`) is `infra`: skipped by default. An unmatched actor is the entry client.
  - What it makes: `component` edits for created participants; `METHOD /path` messages become `http:METHOD <callee>/<path>` endpoints, other messages `undecided` endpoints (`tbd:<callee>/<label>`, the label as the operation); `-)` messages are `mode: 'async'` calls; notes, the part after `: ` of a label and the innermost block (`[alt: cond]`) become the step's `note`; `title` is the flow name, `%% Description:` its description. New: `note` on the `call` form of `edit_design` / `POST .../edits` (the step's own text).
  - Limits and errors: a line over 2000 characters is skipped with a warning (the parser is linear); a `matches` value naming a component that is not in the design is `422 UNKNOWN_COMPONENT` (use `{create: true, name}`); on MCP, a `dryRun` that is not a boolean is a JSON-RPC `-32602` invalid-params error for every tool that takes `dryRun` (a string like `"false"` is no longer read as a real run). `%%` in exported text is written `%#37;`.
  - Re-import is idempotent: a component, endpoint (same bind key) or call (same function, bind key and occurrence) that exists is reused (`counts.reused`); nothing new answers `batch: null`.
  - Undo: each import is one batch, its ops carry `origin {kind: 'mermaid', batch}` (ops copied through `fromSource` carry `{env, version, batch}`). `DELETE /api/envs/:env/drafts/:slug/mermaid/:batch` removes them; `409 DEPENDENT_OPS` with `error.details.blocking: [{seq, op, anchor, author}]` when a later op touches what the batch made. `404` for an unknown batch.
  - UI: Export menu on a flow's header (Copy Mermaid, Download .mmd), "Edit" menu in the draft bar with "Import Mermaid…" (also on the flow header while Edit is on), a three-step dialog (paste, match, preview), and "Undo import" under the draft bar. The static preview exports; its import is refused.

## 0.27.3 (2026-10-21)
- UI: flow diagrams show the product icon of what each lifeline is: data stores and store bands (MongoDB, Redis, Postgres, DynamoDB, S3, MySQL, Elasticsearch), topics and queues (SNS, SQS, EventBridge, RabbitMQ), lambdas and gateways. Unknown kinds keep the line glyph. No API change.

## 0.27.1 (2026-10-21)
- UI: in a flow diagram each data-store collection is its own lifeline (a band names the store; more than 5 collections of one store fold into one lifeline), and every store arrow shows the operation as harvested. Reads and writes differ by line weight. Additive on the trace: a resource message also carries `storeKind` and `access` (`read` / `write` / `read_write` / `unknown`); trace hashes are unchanged (#62). Also UI: a flow with no comments starts its Comments section collapsed to one line.

## 0.27.0 (2026-10-21)
- Comments under each flow (details in [API.md](API.md) "Comments under a flow"). Additive; nothing breaks.
  - REST, any environment (sealed too, no draft needed): `GET /api/envs/:env/comments?anchor=flow:<service>/<ingress>`,
    `GET /api/envs/:env/comments/counts`, `POST` (`{anchor, step?, parentId?, author, body}`), `PATCH /:id`, `DELETE /:id?author=`.
    The anchor is `flow:<service>/<ingress>`; `?draft=` lets a flow that exists only in an open draft be discussed.
  - MCP: `list_comments {env, service, ingress, draft?, since?}` (plain `text` and sanitized `html`, replies nested; `since` is for polling)
    and `add_comment {env, service, ingress, author, body, step?, parentId?, draft?}`.
  - What an agent must know: the body is HTML limited to an allowlist (`p br b strong i em s del strike u ul ol li a table thead tbody tr th td span code pre blockquote`;
    links `http(s)` only; colours are `cc-*` classes). Everything else is stripped, text is escaped, 20 000 characters at most (`422`).
    For `add_comment` you can send plain text with Markdown-lite (`**bold**`, `~~strike~~`, `- ` lists) instead of HTML.
    A comment is by `author` (at most 80 characters); only that author can edit or delete it (naive identity, `403` otherwise).
    Replies are one level deep. A `step` is a step key (`#step:...`) of the flow's trace, else `400`.
  - A Full copy of an environment copies its comments; Blank and Components copies do not.
  - Push events `comment.created`, `comment.edited`, `comment.deleted` (`env`, `data {anchor, id, author, text}`).
  - Migration 011 (`comments` table, additive; the database is backed up to `<db>.pre-011.bak` first).

## 0.26.2 (2026-10-21)
- UI: the app icon is now option D, two lifelines.

## 0.26.1 (2026-10-21)
- UI: new app icon (favicon, touch icon, rail logo).

## 0.26.0 (2026-10-21)
- UI only (2a-2):
  - references (lock), partial-flow line, Import panel
  - edit forms, "+ call", "+ component"
  - editable flow names, component colours
  - Flows list: Subsystem/Component filters, change marks, "Changed only"; collapsible list
  - Inventory subsystem filter
- Data your plans already carry now shows in the UI: links (#54), `details.runtime` (Kubernetes icon, #49), the
  empty-flow hint (#59), and flow text in draft review (#57).

## 0.25.3 (2026-10-21)
- **#58:** `POST /api/envs` (MCP `create_env`) takes `behaviour: true` with `mode: "components"`. It copies the picked
  services' functions and steps into the env and its baseline, so they show no marks and their flows trace like the
  source. The default is false (endpoints stay references to the source).
- **#59:** a trace of an endpoint with no handler function that did not come from a source env returns an empty
  flow, `noHandler: true`, instead of 404. A reference to a source env keeps `409 NO_HANDLER`.
- **#56:** a discarded draft's slug can be reused. The old record is renamed `<slug>~<id>`.
- **#55:** ingress `entryPoint: true|false` (manifest, plan, design edits). `false` is never an entry point; `true`
  always is. When absent, the old rule applies. Set `entryPoint: false` on hop ingresses (tunnel, BGP, BFD) and keep
  their real transport.
- **#54:** `links: {main?: {label, url}, sub?: [{label, url}]}` (http(s) only, label 1–120 characters, ≤ 20 sub) on
  the service header, function and ingress (manifest, plan, edits), and on flows (`PUT /flow-names`, plan
  `flows[].links`). It is returned in the service view, in entry points (`links`, `flowLinks`), in trace
  `start.links` and in `/flow-names`. Flows with links but no name are listed with `name: null`.
- **#49:** `details.runtime` must be one of `k8s-pod | k8s-deployment | k8s-daemonset | k8s-operator | k8s-job`
  (component edit `runtime`).
- The edit form semantics: `links` absent keeps the stored value, `null` removes it, an object replaces it. There is
  a new `function` edit kind.
- Migration 009 (`flow_links`).

## 0.25.2 (2026-10-21)
- **#47:** assumed values (basis + reason) in the contract. See HARVESTER-GUIDE.md. Migration 010.

## 0.25.0 (2026-10-21)
- References and partial flows: marks carry `refs`, a trace message carries `reference`, entry points carry
  `partial`.
- One-level import into a draft: `GET …/drafts/:slug/import/preview?source=&anchor=`, `POST …/import`; MCP
  `import_preview`, `import_into_draft`.
- Design edits: `POST /api/envs/:env/drafts/:slug/edits {edit}` and MCP `edit_design`. The edit kinds are component,
  endpoint, call, flow and DTO.
- **Breaking:** the manual CRUD routes and the MCP tools `upsert_entity` / `delete_entity` are removed. In a design
  env, write through drafts. A sealed env takes harvester ingest only.
- **#52:** flow names show in plain reads too (entry points, `flows/counts`, search, trace `start.name`, MCP).
- **#53:** up to 5000 ops per plan, edits or ops request (was 500), applied in one transaction.
- Component colours: `GET /api/envs/meta` returns `colors` ({component: slot 1..8}).
- Migration 008.

## Coming next
- 0.28.1: the subsystem level in the UI (map level switch, link panel, flow bands, settings page).
