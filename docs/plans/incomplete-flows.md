# #85 Show broken flows: incomplete badge, blocked count on the frontier, Why incomplete, filter, LLM-inferred style

Status: build spec (designer, 2026-10-25). Mockup: `design/mockups/frames/frame-22.html` (open it next to this file).
Approved by the maintainer; the visual is approved by the lead. Display part only (asks 1-5). The contract
(ask 6: `gap`/`plain` accepted on `unresolved[]`, returned verbatim by the trace API and MCP) is the QA TL's 0.41.x patch and is
a precondition of this work, not part of it.

## 1. Problem

A flow whose harvester could not resolve some calls folds them into "frontier: N steps", so a broken flow looks complete.
Show where a flow is incomplete, how much, and why, and let people find all incomplete flows.

## 2. Data (what the build reads)

All of it is optional. A flow or environment without it must look exactly as today.

**Per unresolved entry** (`unresolved[]` on a step, function or call, arriving in 0.41.x):

```
{ what, reason, detail?, candidates?,            // existing
  gap?: boolean,                                  // false = not a real missing hop (e.g. a built-in receiver). Absent = false.
  plain?: string }                                // plain-English reason, short, lower-case, no full stop: "receiver type unknown"
```

Only `gap === true` counts as blocked. `gap` absent or false never counts and never draws.

**Per ingress** (entry point), in `details.coverage` (free-form `details`, already stored and returned):

```
details.coverage = {
  status: 'complete' | 'incomplete',
  blocked: number,                                // gap=true sites in the entry's OWN service only
  sites: [{ fn, seq, file, line, call, reason, plain }],   // at most 20
  more: number                                    // sites beyond the 20 listed (0 when none)
}
```

`fn` is the function id, `seq` the step sequence in it (so `service:fn#seq` is the step id, as in #82), `call` the code text
(`this.checkSecretIsValid(secret)`), `reason` a machine code (`no-receiver-type`, `class-not-in-repo`), `plain` as above.

**Provenance (reserved, ask 5):** a step or edge whose provenance says it was inferred by an LLM. Provisional field:
`provenance.kind === 'llm'` (the existing `Provenance` on steps and edges; add the value when the loader starts sending it).
Nothing sends it yet; build the style and a unit test with a fixture, no data work.

## 3. The number N

Two places show N; one rule with one fallback.

1. **Trace N** (trace header, "Why incomplete" title, frontier marker): the number of **distinct** steps the trace visits, in **all
   services**, whose `unresolved[]` has at least one entry with `gap === true`, **folded frontier steps included** (count them
   even when the frontier is not expanded; the server already knows them). Distinct by step id (`service:fn#seq`); a step reached
   twice (repeat, `repeatOf`) counts once. A step with two gap entries counts once.
2. **Fallback**: if no step on the trace carries a `gap` field at all (the loader sent details only, or older data), N =
   `details.coverage.blocked` of the trace's ingress (own service only). If that is absent too, there is no badge.
3. **Frontier marker M**: the blocked steps inside that one marker's folded set (same rule, restricted to it). The sum of the
   markers' M plus blocked steps drawn outside frontiers equals trace N.
4. **List N** (Flows list row): `details.coverage.blocked` only. The list has no trace, so it cannot count other services. It can
   therefore be lower than the trace's N. The tooltip says "in this service" and the header badge corrects it. Do not fetch
   traces for the list.
5. **Complete**: N = 0 means no badge, no "Why incomplete", marker reads "frontier: K steps". `coverage.status === 'incomplete'`
   with `blocked` 0 (a harvester that knows it is incomplete but not where): show the badge as `incomplete` without the count
   (text "⚠ incomplete"), no "Why incomplete" section.

Put the pure functions in `core/` (no `node:` imports): `blockedSteps(trace)`, `traceBlocked(trace, ingress)`,
`listBlocked(ingress)`, `blockedSites(trace, ingress, cap = 20)` returning `{ sites, more, source: 'trace' | 'coverage' }`.
Unit-test the rule above, including the fallback, dedupe, and `gap:false`.

## 4. UI elements (exact text, states)

Icons are inline SVG (a triangle with an exclamation mark, the `i-warn` shape), never the emoji glyph; the badge text below is
written with "⚠" only for readability in this document.

### 4.1 Badge: "⚠ incomplete · N blocked"

- Text: `incomplete · N blocked`; N = 1 reads `incomplete · 1 blocked`. Triangle icon before it.
- Style: height 22 px (18 px in a list row), radius 11 px, 1 px border `--inc`, fill `--inc-bg`, text `--inc-ink`, 700 weight, 11.5 px
  (10.5 px in a row). Tokens in 6.
- **List row**: in the row's meta line, after the "N decisions" chip. A plain `<span>`, not focusable (the row is the link).
  Accessible name via `aria-label="Incomplete: N blocked calls not followed"`; `title` is the tooltip.
- **Trace header**: in the header row, immediately **before** the Scenario chip, after the title block. A `<button type="button">`:
  `aria-label="Incomplete: N blocked calls not followed. Show why incomplete"`, `aria-controls="why-incomplete"`. Activate
  (click, Enter, Space) opens the info pane if closed, selects the flow-level view and scrolls "Why incomplete" into view (focus
  moves to the section heading, `tabindex="-1"`). Hover background mixes `--inc` 24% into the surface. Focus ring: 2 px `--focus`,
  offset 2 px.
- **Tooltips** (native `title` is acceptable; the mockup shows a custom one, either way the text is exact):
  - List: `Incomplete flow. N calls in <service> could not be followed, so part of this flow is not drawn. Open the flow for the full count across services.`
  - Header: `Incomplete flow. N calls could not be followed, so part of this flow is not drawn: the harvester could not tell what they call. Counted across every service on this trace, folded frontier steps included. Select to see why.`
  - Fallback (no gap data on the trace): header tooltip ends `Counted for safer-auth only.` (the service name of the ingress) instead of the "across every service" sentence.
- Not shown when N is 0 (see 3.5). In a maximized flow (frame 16) the badge stays in the sticky header row.

### 4.2 Frontier marker

- Today a folded frontier is text. It becomes a `<button type="button" aria-expanded aria-controls="frontier-<fnId>">`: 24 px high,
  1 px border `--line-strong`, radius 5 px, fill 7% `--ink` into surface, 11 px / 600 weight, a chevron before the label.
- Label: `frontier: K steps` when M = 0; `frontier: K steps · M blocked` when M > 0 (the `· M blocked` span is `--inc-ink`, 700 weight, and
  the border becomes `--inc`). K is the existing `frontierSteps`. K = 1 reads `frontier: 1 step`.
- Chevron: right-pointing (collapsed), down (expanded), 120 ms rotate (off with reduced motion). Hover: accent-soft fill, accent border.
  Keyboard focus: 2 px `--focus` ring, offset 2 px. Enter and Space toggle. A short hint to the right of the button
  (`click to expand` / `click to fold`, 10.5 px muted) shows while the marker is hovered or focused, and is hidden below 900 px.
- **Expanded**: the frontier's steps are drawn under the marker exactly as the existing "show frontier" mode draws them
  (`TraceOptions.frontier`; fetch lazily for that function only, same as the lazy internal calls of #82), as grey dots. Steps that are
  blocked are marked (4.3). The marker stays above them and now has `aria-expanded="true"`. Expansion is session state (not in the URL).
  The existing cap on expanded frontier rows applies to **ordinary** steps only; blocked steps are never cut by it.
- Collapsed with M > 0: nothing else is drawn; the amber text on the button is the whole cue. (No stubs while collapsed.)

### 4.3 Blocked step (inside an expanded frontier, and anywhere a `gap=true` step is drawn on the main path)

- A full-width row tint (`--inc` 9% into transparent), a 3 px `--inc` stripe at the row's left edge, a "!" bubble (18 px circle, `--inc-bg`
  fill, `--inc` border, `--inc-ink` "!") in the step-number gutter instead of a number.
- Two lines at the lifeline: line 1 the call text in mono (`this.checkSecretIsValid`; from the step's `call`/name), line 2
  `blocked: <plain>` where `blocked:` is bold and `<plain>` is `unresolved.plain`; without `plain`, use `unresolved.reason`
  (the existing text), and if both are missing, `target not resolved`. One line, ellipsis, full text in `title`.
- A short dashed stub from the lifeline: 1.5 px, rhythm 2 px on / 3 px off, `--inc`, ending in a 2 px stop bar (not an arrowhead).
  It goes nowhere on purpose. Dash rhythms are distinct from the return arrow (5 on / 3 off, grey) and the LLM-inferred edge (4.7).
- Selectable like any step (click, Enter on the row, Up/Down in the step bar). Selected: 18% tint and the standard focus-blue 2 px outline
  inset. Selecting it opens the info pane on that step and highlights its row in "Why incomplete" (class `me`, scroll into view).

### 4.4 "Why incomplete" section in the info pane

- Rendered at the **top of the pane body** whenever the pane shows the flow or one of its steps and N > 0. Hidden entirely (not
  rendered, no empty box, no "nothing blocked" line) when N is 0.
- Container: `<section id="why-incomplete" aria-labelledby>`, 1 px `--inc` border, radius 10 px, 5% `--inc` fill. Header strip: triangle icon,
  `Why incomplete` (700), right-aligned `N blocked` (N = trace N; fallback N = coverage.blocked). Header fill `--inc-bg`, text `--inc-ink`.
- Intro line (xs, `--ink-2`): `These calls could not be followed, so what they reach is not drawn.` In fallback mode instead:
  `From the entry point's coverage report (<service> only). Other services on this trace may add more.`
- One list item per site, in trace order (fallback: `sites` order), each with three parts:
  1. **Plain reason**: first letter capitalised (`Receiver type unknown`), 600 weight; the machine `reason` code after it in muted 10.5 px
     (`no-receiver-type`). No `plain`: the existing `reason` text.
  2. **Code**: the `call` text in a mono 11.5 px block (surface-2 fill, 1 px border, radius 4 px), wrapping with `overflow-wrap:anywhere`.
     No `call`: the step's function name.
  3. **Source link**: `file:line` in mono 11.5 px, accent colour, an external-link glyph, opening the GitHub (or the environment's) source URL with the
     same link builder as other `file:line` links (`Links`/commit). No repository link known: the `file:line` shows as plain mono text, not a link.
- **Cap**: at most **20** sites are listed. More: a last row `+ N more` (N bold) with the muted text `not listed here.` N =
  (total sites - 20), or in fallback `coverage.more` (sites past the loader's own cap of 20 are only counted). The section does not scroll by itself.
- **Grouping**: when sites span more than one service, group under a small uppercase heading `<service> · <count>`; with one service no headings.
- **Selected step**: if the pane is on a blocked step, that step's row has the highlight and is first in view; the section otherwise shows the whole flow.
- Order of pane body: Why incomplete, then the existing sections.

### 4.5 Filter: "Incomplete flows only"

- On the Flows list filter line, after "Changed only" and "All endpoints": a checkbox `Incomplete flows only (N)`. N = number of flows in the
  current scope (service, design, "All endpoints" state) whose `coverage.status === 'incomplete'`, **ignoring this filter** (like the count of
  "All endpoints"). It is available in every environment, not only designs.
- Checked: the list keeps only incomplete flows; groups with no row disappear; the status line under the filters reads `K of T flows are incomplete`
  (`role="status"`); the URL gets `incomplete=1`. Unchecked: param removed.
- Visible only when at least one flow in the current environment has coverage data (`details.coverage` present). Otherwise the checkbox is not rendered (no
  disabled/(0) state), and `incomplete=1` in the URL is ignored without error (the filter simply does not apply).
- Empty result: the status line reads `0 of T flows are incomplete` and the list shows: bold `No incomplete flows in <env>.` then
  `Every flow here is fully mapped, or the harvester has not reported coverage yet.` and a link `Clear the filter`.
- Combines with the other filters by AND (Subsystem, Component, Changed only, text box). The checkbox count does **not** change with them, except
  the scope ones named above.
- A flow with `status: 'incomplete'` shows the badge in the row regardless of whether the filter is on.

### 4.6 URL parameters

| Param | Meaning | Written when |
|---|---|---|
| `incomplete=1` | Flows list shows incomplete flows only | checked |
| `open=<service>` / `ch=...` / `detail=full` | existing (#82); unaffected | |

Frontier expansion, "Why incomplete" selection and the badge button are session state, not in the URL.

### 4.7 Reserved style: LLM-inferred

- **Edge**: dash-dot in the hop's transport colour: 9 px on, 3 off, 1.5 on, 3 off (one rhythm unit 16.5 px), 1.5 px thick, normal arrowhead. Plus
  the tag `inferred (LLM)` on the label: 15 px high, 9.5 px / 700 weight, 1 px **dashed** `--inf` (= `--accent`) border, 8% accent fill, accent text, radius 4 px.
- **Step** (a bar, dot or row): dashed 1 px outline and the same tag after its name.
- The return arrow stays grey even-dashed (5/3) with a back-pointing head; the blocked stub stays amber short-dotted (2/3) with a stop bar; the inferred
  hop is never amber, never solid, never grey.
- Tooltip on the tag and the edge: `Inferred by a model from code context, not proven by a call in the code.` Accessible name of the owning step or edge ends with `, inferred by a model`.
- Legend: the legend line lists only kinds that are drawn, so `inferred (LLM)  not proven by code` appears only when such a hop is on the page. Legend items (in order):
  call, return, inferred, blocked, frontier.
- Counts: an inferred hop counts as a step like any other (it is not "blocked"). Mermaid export marks it with a dotted arrow `-.->` and a note; out of scope until data exists.

## 5. Keyboard and accessibility

- Tab order in the header row: title, badge button, Scenario chip, External|Full. In the list: row link, then (in the filter bar) the checkboxes in
  visual order. The badge in a list row is not a tab stop.
- Marker: a native `<button>`; Space and Enter toggle `aria-expanded`; the expanded rows follow it in DOM order; `aria-controls` points at the rows' container.
- Blocked rows are selectable steps with an accessible name: `Blocked: <call>, <plain>`. Colour is never the only cue: icon, the word "blocked", the stop bar.
- Focus ring on every new control: 2 px `--focus`, offset 2 px (the app's existing rule).
- "Why incomplete": `<section>` named by its heading; list is an `<ol>`; links are real anchors with `rel="noopener"`.
- Reduced motion: no chevron rotation transition.
- Contrast: see 6; all text pairs reach 4.5:1 and all strokes 3:1 in light and dark.

## 6. Tokens and contrast

Add to `web/css/tokens.css` (all four places that define themes: `:root`, `prefers-color-scheme: dark` guard, `data-theme='dark'`):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--inc` | `#b06f00` | `#e0a030` | borders, stripes, stubs (non-text) |
| `--inc-ink` | `#7a4a00` | `#f2b84b` | text on `--inc-bg`, surface or paper |
| `--inc-bg` | `#f6eddb` | `#36302a` | badge fill, header strip |
| `--inf` | `var(--accent)` | `var(--accent)` | inferred tag (reserved) |

`--warn` stays as is and is **not** used for text here: it is 3.4:1 on white. Measured ratios (WCAG relative luminance):

| Pair | Light | Dark | Needs |
|---|---|---|---|
| `--inc-ink` on `--inc-bg` (badge) | 6.43 | 7.27 | 4.5 |
| `--inc-ink` on surface (list row) | 7.48 | 9.30 | 4.5 |
| `--inc-ink` on paper (diagram) | 6.93 | 10.20 | 4.5 |
| `--inc-ink` on the selected row tint (18%) | 5.63 | 7.45 | 4.5 |
| `--inc` on surface (stroke) | 4.10 | 7.32 | 3 |
| `--inc` on paper (stub) | 3.80 | 8.03 | 3 |

## 7. Where it goes in the code (pointers, not a design)

- Core: new `core/incomplete.ts` (the pure functions of section 3); `Unresolved` gets `gap?: boolean; plain?: string` in `core/types.ts`; the trace message that
  already carries `gap?: Unresolved` and `frontierSteps` also gets `frontierBlocked?: number` from the trace walker (`core/trace.ts`).
- Web: `web/js/views/flow-list.js` (+ `flow-list-filter.js`, `flow-list-rows.js`) for the checkbox, count and row badge; the trace header and frontier marker
  in `flow-lane.js` / `flow-draw-rows.js`; the section in `flow-panel.js` / `flow-inside-panel.js`; new `web/js/views/incomplete-badge.js` and
  `incomplete-why.js` (keep files near 250 lines). CSS in the existing flow stylesheet plus the tokens above.
- Preview build (`npm run preview`) must keep working: the static preview carries the same JSON, so no server-only logic.
- Tests: core rules (3), the filter (URL round trip `incomplete=1`, scope, count ignoring the filter, absent data), the marker label (M = 0, 1, many; K = 1),
  the 20-site cap and `+ N more`, the fallback source, and "no badge, no section" for a flow without gap data.
- Demo (project rule): a sample in `samples/` (env `prod`): a safer-auth style service whose handler has two blocked calls (`this.checkSecretIsValid`
  unknown receiver, `mw.extractOrgAuthData` class not in repo) inside a frontier of many steps, with `gap`/`plain` on the unresolved entries and
  `details.coverage` on the ingress; a second sample with `gap: false` only (no badge); a row in `docs/DEMOS.md`. Version bump (user-visible).

## 8. Open questions, with a decision for each

1. **List N vs trace N differ (own service vs all services).** Decision: accept the difference. The list uses `details.coverage.blocked`; the header uses the trace rule.
   The list tooltip says "in <service>", the header tooltip says "across every service". Do not fetch traces for the list.
2. **Show the filter when no coverage data exists?** Decision: no. Hide it and ignore `incomplete=1`.
3. **Does the badge also show on the service page or the system map?** Decision: not in this change. The two places asked for only. Note it as a follow-up if people ask.
4. **`coverage.status` incomplete but `blocked` 0.** Decision: badge reads `incomplete` without a count, no "Why incomplete" (nothing to list).
5. **Should blocked steps still count toward the frontier cap?** Decision: no; the cap applies to ordinary steps only, blocked steps always draw.
6. **Expanding a frontier: all steps or only the blocked ones?** Decision: all of them, as the existing frontier mode draws, with the blocked ones marked; showing only blocked steps would hide their context.
   If a frontier is huge the existing cap and the "+ N more" row apply to ordinary steps.
7. **Is the badge in the header a button?** Decision: yes, it jumps to "Why incomplete". The badge in a list row is not interactive.
8. **Provisional LLM field name.** Decision: `provenance.kind === 'llm'`; revisit when the loader ships it. Only the style and a fixture test are built now.
9. **Repeat visits of the same blocked step on one trace.** Decision: counted once (distinct step id).
10. **Mermaid export / import.** Decision: unchanged now; blocked steps stay out of the export as frontier already is.
11. **Colour: amber vs red.** Decision: amber (`--inc`), because red means "known broken link" (`--t-broken`); incomplete is unknown, not wrong.
12. **Not-gap unresolved (`gap: false`).** Decision: never counted, never marked; they keep today's treatment.
