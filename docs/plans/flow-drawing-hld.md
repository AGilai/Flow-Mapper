# Flow drawing for HLD flows (#72, #74, #75, #76 → 0.32.2; #71 Mermaid import → 0.32.2): build spec

From corev5-importer bugs #71–#76, triaged by the QA TL (decisions quoted), with the lead's decisions marked.

## 0.32.2: flow drawing (built)
- **#72 nested groups.** Groups (alt / opt / loop / par / critical / break) nest. The model keeps each group's
  `parent` (core: the step group structure in the trace), and the flow view draws nested frames inside each other
  (inset per level, the label of each frame visible) instead of flattening to the innermost one. Squeeze/fold keeps
  frames consistent.
- **#74 notes over several participants.** A note over A,B spans from the leftmost to the rightmost of its
  participants; a note over one stays under that lifeline. (Folded lifelines: span to the fold column.)
- **#75 step mark.** A first-class optional step flag `mark: "new" | "changed"` on a step (manifest step, plan,
  design edits, MCP). Drawn like the component and flow marks: a coloured band on the step arrow plus the mark icon
  (flow-marks-draw.js). `details.changed` text stays as the tooltip. "Changed only" counts marked steps (a flow with a
  marked step is "changed"). Schema and samples change together.
- **#76 labels.** A step's label is its title when it has one (0.30.0 step titles). The bindKey moves to the tooltip and
  the step panel/step bar; `tbd:` keys are never drawn as labels (the operation name shows instead). **Lead decision:**
  this is done through Step details: in design environments the Arrows default becomes "Title, falling back to API"
  (`sd` default per env kind: design → `t` with API fallback, harvested → `a`); the viewer can still choose. The URL
  keeps `sd=` omitted at the env kind's default.

## 0.32.2: Mermaid import (#71), on top of 0.32.2
- Return arrows (`-->>`) become the response label of the call they answer, not separate steps.
- Self-messages become internal steps of that participant.
- Notes become step notes; `Note over A,B` spans both (#74).
- `rect` (any colour) becomes `mark: "changed"` on the steps inside it (#75).
- `alt` / `opt` / `loop` (and `par`, `critical`, `break`) become groups, nested as written (#72).
- Per-message `%% real: <bindKey>` (on the line before or at the end of the message line) sets `details.real`.
- `%% flow: <name>` and `%% link: <label> <url>` set the flow name and links (#54 links).
- The export (core/mermaid-export.ts) writes the same constructs back, so export → import round-trips them.
- Preview, matching, undo-by-batch and all 0.27.4 behaviour stay.

## Tests and demo
Pure tests: nesting model and frame geometry, note span geometry, mark on steps (+ Changed only), label choice per env
kind, parser corpus for every #71 construct, round trip. A sample HLD flow in sase-hld (or a new `samples/mermaid/` file
imported in the demo) showing nested alt in loop, a spanning note, changed steps and titles. CHANGELOG (importer-facing:
`mark`, directives), DEMOS, versions 0.32.2 and 0.32.2.
