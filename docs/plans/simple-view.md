# Simple view (#90, comments 263–264) — build spec

Status: draft by the lead, 2026-10-26. Target 0.44.0, after the QA TL's 0.43.4 core fold (internal callee repeats → `repeatOf`).
Mockup: frame 24 (needs the maintainer's approval before code). The 0.43.5 lane check and "expand here" toggle are folded in.

## Why
The External detail of a big flow is still unreadable. For example, production `DELETE_/api/v1/users/{p1}` returns 217 messages: 91 store
ops and 84 frontier markers, and the same Role findOne + Redis get/set/del block appears 4+ times. The trace is the static union of every
call site and every arm, so a helper reached from 12 sites is drawn 12 times. The Simple view answers "what does this flow touch, and in
what order" in one screen.

## The three details
The detail switch becomes **Simple · External · Full**. Simple is the default in the UI (stored as today in `flow-mapper.detail`, URL
`detail=simple|full`; no param = the stored choice, falling back to simple). The API default stays `detail=external`, so this is not a
breaking change. `detail=simple` is new on `GET /api/envs/<env>/trace` and on MCP `trace_flow`.

## Rules (a pure post-pass: `core/trace-simple.ts`, called from `viewOf` when `detail === 'simple'`)
1. **Kept:** what External keeps, minus internal calls and frontier steps and markers. Problems (gap, broken, unhandled, blocked) are
   always kept.
2. **Arms flattened:** `choose` is ignored, every arm is in, alt frames are dropped and `decisions` is omitted from the view. The
   view carries `flattened: N` (the number of decisions) so the UI can say "N decisions shown together".
3. **Consolidation.** Key = (caller service, target store or service, op, key template / collection / endpoint).
   - The first occurrence is drawn and later ones are removed. The drawn message carries `occurrences: [{fn, seq, key}]`, every
     place it happens, first included. `label` gets the `*N ` prefix when N > 1, as #88 does.
   - **Same target, different ops:** messages with the same caller and the same store/service (different op) merge into one arrow at the
     first one's place, *even when not adjacent*. The label is `*N get, set, del` and `dbGroup.calls` lists them. This reuses the #88
     row shape, so the Info pane, the store panel and regroup work unchanged.
4. **Cross-service repeats:** a call or delivery to the same (callee service, ingress) as an earlier one is drawn as one arrow with
   `repeatOf: N`, and the callee's messages below it are dropped (the #43 rule). Combined with rule 3, the same caller makes it a
   count, and a different caller makes it a repeat marker.
5. **Hidden-steps badge:** each service participant carries `hiddenSteps: N`, the internal calls and frontier steps rules 1–4
   removed for that service (consolidated duplicates are not counted; they are in `occurrences`).
6. **Budget:** the server builds the canonical trace with `maxMessages × 4` (hard cap 4000). The Simple view is cut at the requested
   `maxMessages` consolidated items. `truncated` is true only if that cut happens (or the canonical trace itself truncated).
7. **Numbering:** renumbered per view (`renumber`), and `repeatOf` follows the drawn numbering (#89).
8. `viewCounts` supports simple (the Flows list shows the simple count when the stored detail is simple).

## Drawing (web/)
- **Switch:** three segments, Simple first. A caption under the header reads "Simple: each external call once, decisions flattened ·
  N internal steps hidden". The count links to External.
- **Lifeline head badge:** "N hidden" in the existing internal-calls pill position and style. Clicking it opens **External** with that
  service opened (the existing `open=` behaviour).
- **Counted arrow:** the `*N` prefix, drawn like a #88 group row. Info pane → "Happens N times" lists each occurrence as `fn · line`,
  each a code link, and "Seen in External at steps …" when it maps.
- **Repeat marker (call kind, from 0.43.4 and from rule 4):** drawn like a delivery repeat: a thin arrow, `↩ seen at step N`, clickable
  (jumps to step N). The Info pane has an **"Expand here"** button that switches to External with that call's subtree unfolded in place
  (view option `unfold: [key]`, which copies the first expansion's messages after the marker; pure, in trace-view). The copies are
  numbered as sub-steps of the marker (7.1, 7.2 …), so later step numbers do not shift, and they are bracketed "unfolded copy of steps 3–7".
  The button is also offered on External and Full repeats.
- **From 0.43.4 (QA TL's report):**
  - The call repeat is `{kind:'call', internal:true, to: fnPart(service, fn), calls, label:'<fn> ↩ seen at step N', repeatOf:N}`.
  - The fold key is service + fn + bound values + fixes in force (core/trace-fold.ts). `renumber` already rewrites `repeatOf` and the label.
  - Today `flow-lane.js` draws it as a plain self-arrow, with no repeat style and no jump.
  - flow-panel.js:54's text says "The same delivery (consumer, ingress, event)…" for every repeat. Make it say the right thing per kind: for calls, "The same function call (same bound values)…".
  - Demo: prod roles-svc in.removeUser.
- **Flattened note:** where alt frames were, there is nothing. The decisions bar is replaced by "N decisions shown together ·
  choose in External".

## Demo and tests
- Sample (env `prod`): a flow whose service calls a helper from 3 sites that each hit Redis get/set and Mongo findOne, with one
  decision and one cross-service call made twice. In Simple: one `*3 get, set` arrow, one `*3 findOne`, one repeat marker, and a
  "N hidden" badge. Add a DEMOS row and a CHANGELOG entry.
- Pure tests for each rule (keep, flatten, consolidate key, non-adjacent merge, repeat, hiddenSteps, budget, numbering, viewCounts) and
  for `unfold`. API test for `detail=simple` and that the default stays external. MCP field test. Render tests for the switch, badge,
  counted row and Expand here.
- Screenshots, light and dark, compared with frame 24.

## Decided
- Three-way switch rather than overloading External. External stays reachable, and the badge and Expand here need it.
- "Also at" uses code locations (fn · line), not step numbers: the other occurrences are not drawn in Simple.
- `unfold` lives in the view, not the trace: the canonical trace already holds the first expansion, so no refetch is needed.
