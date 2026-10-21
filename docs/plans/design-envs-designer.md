# Designer notes: building design-env.html (rev 3) faithfully

Sources read: docs/UI-GUIDE.md, design/AUDIT.md, web/css/tokens.css, design/mockups/design-env.html (all 1226 lines),
plus web/css/{components,flow-desc,flow-lane,flow,layout,base}.css and the sequence/tab keyboard code in web/js/views.

## 0. Things the mockup's CSS gets wrong for the app (read before copying any class)
- **Dead rev-1 CSS, do not build:** `.hatch`, `#hatch` pattern, `.st.new` (hatch swatch), `.nd-new`, `.hd-new`, `.st.ext`,
  `.grp-tag`, `.emptyst`, `.proposal`, `.dbox*` (mockup copy). "New" is the spark only; hatch is gone.
- **Class collisions with the app:** `.st` is already the step-status list in flow.css:145 (global); `.who` and `.dbox`
  exist in flow.css:58 / flow-desc.css (uppercase "who", Human/AI boxes); `.kv`, `.search`, `.seg`, `.check`, `.btn.sm`,
  `.num` (table.grid td.num), `.fold`, `.halo` and `.ai` (flow-desc badge) also exist. UI-GUIDE §2: state classes are
  scoped to their component. Use the prefixed names in §1 below; never paste mockup selectors as-is.
- **Mockup `.seg span.on`** must be the app's `.seg button[aria-pressed]`; `.seg span.off` = `button:disabled` (rule
  lives in flow-tabs.css:68; move it to components.css). `.btn.sm` lives in flow-desc.css; move it to components.css.
- Mockup header comment about `--t-amqp-old` is stale: values already equal tokens.css. Do not add `--t-amqp-old`.
- Mockup dark theme sets `--warn: #e0a030; --bad: #ff6b6b`; tokens.css has no dark override for them. See §2.
- Mockup breakpoints are 1100/760; the app's panel breakpoint is 860 (layout.css). Use the app's: 860 for panel and
  two-column splits, 760 for the screenshot check.

## 1. Component inventory
Legend: T = tokens · S = states · R = reused in · X = extend existing instead of new.

1. **Status mark (badge)** `.mark.new|.chg|.rm` (mockup `.bnew/.bchg/.brm`) + glyph `<svg><use href="#i-new|#i-chg">`.
   T: new `--new`/`--new-ink`, rm `--muted`/`--surface-2`, height 19px, radius 10px, `--fs-xs` 600. S: static; no hover
   (it is not a control); `title` = "New since baseline prod, Oct 21 14:02". R: inventory rows, section titles, panel head,
   field-diff rows, discussions subject. New file `web/js/components/status-mark.js` (one fn: `mark(kind, opts)`) +
   `web/css/marks.css`. The SVG symbols `#i-new #i-chg #i-msg` go into web/js/icons.js, not a per-page `<defs>`.
2. **Spark on a node/head** (SVG `<use class="spark">`, 11-13px, top-right of the node or head). T: same symbols.
   S: twinkle once on first render of a page (not on every re-render/redraw, not when walking steps), none with reduced
   motion (base.css already kills animations globally; keep the explicit rule in marks.css too). R: system map nodes,
   subsystem boxes' component list and box title, sequence heads (flow-draw), abstract links. Changed = `#i-chg` ring;
   Removed on the canvas = `.gone` (opacity .38 + line-through text).
3. **Field diff row** `.fd tr.isnew|ischg|isrm`: 3px inset left edge (`--new`, `--new-ink`, none), "was …" in `--muted`.
   X: extend components/schema-table.js with an optional `marks` map rather than a new table; children of a new field
   are not marked.
4. **"Compared with" control**: `.seg` of two buttons "Baseline: <src>, <date>" · "<src> now". X: `.seg`. Lives in the
   page-head meta row of design envs only. S: disabled "now" when the source env was deleted (title says why).
5. **Draft bar** `.draftbar`: tinted `--accent` 6% on `--surface`, border `--accent` 25% mix; name 600, "by X and N others ·
   N discussions" `--muted --fs-xs`; delta `+1 −2 ~1` in `--mono` 600; buttons Review changes · Discard · Apply to <env>
   (primary). S: Apply disabled with 0 ops ("Nothing to apply"); Apply busy (label "Applying…", all three disabled);
   conflict state (bar turns `--warn` callout, see §3). Sticky under the toolbar. R: every design-env page in Edit.
6. **View · Edit toggle**: `.seg` with aria-pressed. Hidden (not disabled) in harvested envs. Edit with no draft open
   opens a small picker (ctx-menu style, X: components/context-menu.js): "New draft…" + open drafts by name.
7. **Level control** Subsystems · Components · Domains: `.seg`; Domains `disabled` + italic + title "Later".
   Hidden when the env has no groups. URL `level=`.
8. **"In draft" chips on canvas** `.chip-b.draft` (accent 10% fill, `--accent` stroke/text) and `.chip-b` neutral
   ("removed in draft", "abstract"); "in draft: was "tbd"" names the old value. X: same SVG chip helper as rpcChip in
   flow-draw.js (generalise to `svgChip(text, x, y, variant)`), not a third chip implementation.
9. **Subsystem bands** on flows: `.band` (`--surface-2` fill, `--line` stroke) 22px, title `--fs-xs`-ish 600 `--ink-2`,
   count `--muted`; dotted dividers `--line-strong` 1 3. Toggle "Group by subsystem" (`.check`). Edit: `⊕` at band end.
   R: flow page; same order as env groups.
10. **Map regions** `.rg` (surface-2 70% on paper, `--line-strong`, r12), title 13/600, split line `--muted`
    ("9 components: 3 new, 6 from prod (2 changed)"). Prod nodes `--muted` stroke 1.3; prod-prod edges `--line-strong` 1px.
    Click region → Inventory filtered. Client node = rounded device rect + base line. X: system.js layout, not new view.
11. **Roll-up line** `.ru.<transport>`: width 2 (http 3 at count≥2; scale 2→4 by count, cap 4), async dashed 5 4,
    label "N calls · http" 10.5/600 `--ink-2`, arrowhead `context-stroke`. Hover = halo; click = list in panel.
12. **Abstract link + ends** `.abs` (`--ink-2` 1.8, dash 6 4) with open-circle ends `.abs-end` (r5, `--surface` fill),
    "abstract" chip, name label, spark if new, bubble count. Selected = `.halo.ink`. Note: dashed grey also means
    "unresolved" in the guide; the open-circle ends + "abstract" chip are the disambiguator and must always be drawn.
13. **Fold column** (squeeze): head `.fold` (surface-2, dashed `--line-strong` 3 3, "⋯ 3 folded", "click to open"),
    body `.fold-col`; arrows stop at the fold with `⋯` and target name in `--mono` `--muted` (`.fto`). Name it
    `.sq-fold` to avoid the existing middleware `.fold`/`data-mwfold`. Keyboard focusable, Enter opens.
14. **Step walker** `.stepbar`: ‹ [Step 3 of 7] › (30×28 buttons, `--line-strong`, hover `--accent-soft`), label in
    mono + ends `--muted`. Step tile on each arrow start: 16px rect r4, `--surface`/`--line-strong`, text 10.5/600
    `--font`; current = solid `--ink` with `--surface` text + transport halo. Distinct from `.numtile` (async flow
    jump tiles at arrow ends, mono 700): keep both, never same place. Name `.steptile`.
15. **Description boxes**: flow description under the title (`details.flowhead`, text `--fs-md` 1.55, max 110ch) and
    step description (`details.stepdesc`, `--fs-sm`). X: reuse flow-desc.js / flow-desc.css (Human/AI `.dbox` with
    green/accent left edges, outdated `--warn`, empty dashed) inside these `<details>`; the mockup's contenteditable
    div is a stand-in. Open/closed per viewer in localStorage (try/catch). Per-call description in the edit form = same.
16. **Discussion bubble** `#i-msg` 14×13 + count 10.5/600 `--ink-2`. On tab, head, arrow, abstract link, panel h4.
    Hover: title "2 messages, open"; click opens panel thread. Zero = no bubble. Thread `.thread .msg` (AI msg on
    `--surface-2`), "open" status chip `--warn` outline (rename `.tstate.open`, resolved = `--muted`), reply box.
17. **Edit forms (panel)** `.fgrid` 92px label column `--muted --fs-xs`; controls 28px. X: use components.css `.input`,
    `.select`, `.textarea` (focus outline exists) — the mockup's `.fsel` spans are drawings of selects. Hint `.fhint`
    under the control. Footer: Delete (`.btn.sm` + `--bad` text, left) · Done (right). Endpoint select ends with
    "+ New endpoint". R: call, component, endpoint, abstract-link refine (From/Via/To), flow name.
18. **Assistant / info notices** `.asst` card and `.info` neutral notice (`--line-strong` border, no tint: a missing
    item in a design is not a problem). Buttons right-aligned, wrap below on narrow.
19. **Import table**: X: `.section` + `table.t` with env group rows (`tr.fold`, rename `tr.grouprow`) and checkboxes;
    columns Item (mono, nowrap) · Kind · Comes along · Here; footer count + primary "Import N into draft".
    Search uses existing `.search` (icon + `.input`).
20. **Environment picker rows** (rail): `.envopt` name in mono 600 12.5px + small line "harvested · 55 components" /
    "design · from prod, Oct 21". Selected = `--accent-soft` + accent 30% border. "+ New environment" accent link row.
    X: replace the `<select>` in components/sidebar.js with a `role=listbox` list; collapsed rail keeps `.env-chip`.
21. **New-environment page** `#/envs/new`: Name `.input` (mono) + help; Source select (shows kind · count);
    Copy mode cards `.mode` as a real `role=radiogroup` (radio inputs, card = label; `.on` accent ring; Linked disabled
    with "Later"); Subsystem chips `.gchip` (mono key + label + remove ×, "+ Add subsystem" dashed, drag/arrow to reorder);
    Levels strip; pick table (X: `table.t`) with `tr.sub` divider "Suggested neighbours" and muted unticked rows with
    "why" text; summary bar (one sentence + Cancel/Create). Same page for "Duplicate" (source preset, Full copy).
22. **Inventory status filter** `.seg` All/New/Changed/Unchanged with `--muted` counts; flow list `.ep2` name 600,
    key mono, description `--muted`. X: inventory.js + flow-list.js.

## 2. Tokens (add to web/css/tokens.css, light / dark in both dark blocks)
| token | light | dark | use |
|---|---|---|---|
| `--new` | `#f6c431` | `#f7cf55` | spark fill, New badge tint (24% mix), new-field left edge |
| `--new-ink` | `#8f6a00` | `#f7cf55` | spark outline, New/Changed text, changed ring and edge |
| `--draft` | `var(--accent)` | same | alias so "in draft" styling can move off accent later without a hunt |

- **Yellow spark vs `--warn` amber:** the mockup resolves it by shape, not hue: New = star glyph, Changed = ring glyph,
  `--warn` = tinted cell/pill and the callout dot, never a glyph. Rule for the guide: `--new*` never on a problem,
  `--warn` never on a status mark. Risk: dark `--new-ink #f7cf55` vs mockup dark `--warn #e0a030` are close; keep the
  glyph mandatory in every New/Changed badge (never text-only).
- **`--flow-2` (#a68a00 / #e2c23a) is also yellow**, contradicting "the only yellow in the app". It appears only as
  async sub-flow dots/bands, never as a star. Acceptable; say so in the guide (or retune, Q3).
- **Red / Removed:** Removed is `--muted` + strike-through, never `--bad` (a removal in a design is intent, not a
  problem). `--bad`/`--t-broken` keep meaning "broken".
- **Dark `--warn`/`--bad`:** the mockup's dark values (`#e0a030`, `#ff6b6b`) are not in tokens.css. Add them only as a
  separate, app-wide change with its own screenshot pass; this feature must not depend on them (Q4).
- No new transport token; "transport not decided" = `--ink-2` solid line + `kind tbd` chip (surface-2).

**Proposed UI-GUIDE.md §10 "Design environments and status marks"** (draft text):
- A design env says so in the page head (`design` chip, "from <source>, <date>"); harvested envs never show Edit.
- Marks are New (spark), Changed (ring, with what changed in words: "+1 endpoint", "was …"), Removed (muted, struck).
  Mark the highest new level only; children of a new item are unmarked. A parent of a marked child shows Changed.
- Marks compare with the baseline by default; "Compared with" switches to the source now, same marks.
- Imported items are unchanged against their own source: no spark; the meta line says "imported <date>".
- Draft edits are drawn in place: added = "in draft" accent chip, removed = faded + "removed in draft". Accent here means
  "your pending change", the one sanctioned non-link use of `--accent`.
- A missing item in a design is a neutral notice, not a warning. Abstract links: dashed `--ink-2` + open-circle ends
  + "abstract" chip (the ends distinguish it from an unresolved edge).
- Step walk: steps are numbered calls (returns are not steps); Squeeze keeps both ends of the current step on screen.
- Checklist line: "No `--warn` glyph, no `--new` on a problem, every mark has its glyph."

## 3. Interaction details the mockup leaves open (recommendation each)
1. **Step walk keys:** ← → (and the ‹ › buttons) only while focus is inside the flow diagram/stepbar; Home/End = first/
   last step. Never in inputs/contenteditable (reuse `keyAction`'s guard from flow-tabs-state.js). `[` `]` 1-9 stay
   tab keys. The current step is reflected in the URL (`step=3`) so links land on it.
2. **Step change feedback:** `aria-live="polite"` on "Step 3 of 7 · <label>"; the current arrow scrolls into view
   (`block: nearest`, no smooth scroll under reduced motion). At step 1/last, the button is `disabled`, no wrap.
3. **Clicking an arrow** jumps the walk and opens the panel; clicking a step tile only jumps the walk.
4. **Squeeze:** default on, remembered per viewer; recompute on resize (debounced) and on step change; opening a fold
   by click pins it open until the next step change. Fold transition: none (instant) with reduced motion; otherwise
   ≤150ms width transition.
5. **Focus order (flow page):** toolbar → draft bar → tabs → flow description summary → stepbar ‹ › → step description
   → diagram (heads, then arrows in step order, then ⊕) → panel. Panel open moves focus to its heading; Esc closes the
   panel and returns focus to the arrow (as context-menu/desc-dialog already do).
6. **Editing by keyboard:** every canvas action has a form equivalent: Enter on a focused arrow/head opens its form; "Add
   call" and "Add component" buttons exist in the panel/band (`⊕` is a button), so drag is never the only way. Form:
   Enter in a single-line field = Done; Cmd/Ctrl+Enter in textarea = Done; Esc = cancel the field edit (not the draft).
7. **Saving edits:** each Done writes one draft op immediately (shared drafts, no local unsaved state); the delta in the
   draft bar updates. Toast "Saved to draft use-token-grant". Undo = delete the last op from Review changes.
8. **Apply:** opens Review changes as a confirm step (list of ops grouped by component, with marks) → "Apply N changes
   to sase-hld". Success: draft bar disappears, page reloads in View, toast "Applied as revision N · Open changelog".
   Conflict: stop, bar becomes a `--warn` callout "2 items changed in sase-hld since this draft opened" with "Show"
   (rows link to items); nothing is applied (pending Q1). Network error: inline `.error-box` in the bar, draft intact.
9. **Discard:** confirm dialog naming the count and the other authors ("Discard 4 changes by you and Reviewer? Their
   discussions stay, marked 'draft discarded'"). After: View mode, toast.
10. **Empty states (one sentence each, UI-GUIDE §5):** Blank env map: "Nothing here yet. Switch to Edit to add a
    component, or import one." Subsystem level with no groups: hide the level control. Field diff with no marks:
    "No field changed since the baseline." Import search with no hits: "Nothing named 'x' in any environment. Add it
    as new." Discussions none: no bubble, panel h4 "Discussion" + "Start a discussion" link. Draft with 0 ops: bar
    reads "No changes yet". Flow with no description: existing `.dbox.empty` copy.
11. **Errors:** env name taken / invalid → inline under the field, Create disabled; copy failure → page-level
    `.error-box`, no half env (server is one transaction). Deleted source env → "Compared with: source now" disabled.
12. **Narrow (≤860px):** panel takes full width (existing rule); stepbar wraps label under the buttons; draft bar
    wraps buttons to a second row right-aligned; mode cards 2 cols at ≤1100, 1 col at ≤760; map/flow SVG scroll with
    the existing fade+hint; Squeeze matters most here and stays on. Rail collapses to env-chip (existing).
13. **Reduced motion:** no twinkle, no fold/disclosure transitions, instant scroll. Spark still drawn (static).
14. **Spark twinkle frequency:** once per page load per item set; not on step walk, draft updates or polling refresh.

## 4. Screenshot acceptance checklist (1440 and 760, light and dark; compare with the mockup frame)
**F1 New environment** □ picker rows show kind line; prod has no delete □ 4 mode cards, Linked disabled "Later", one
selected with accent ring □ subsystem chips in order + dashed add □ levels strip shows Domain as later □ pick table:
neighbours unticked, muted, each with a "why" □ summary is one sentence with counts and says functions/flows stay.
**F2 Map, components** □ level seg, Domains disabled □ one column per subsystem in env order □ region head = name +
split, no tiles □ sparks top-right on new nodes only □ changed prod nodes say what changed □ prod-prod edges thin grey
□ verdict sentence + one callout per gap □ legend lists only what's drawn □ client drawn as device.
**F3 Subsystem level** □ one roll-up per direction+transport with "N calls · t" □ abstract links: dashed, open ends,
"abstract" chip □ box lists components with marks, prod muted □ selected link has halo; panel squeezes (no overlay)
with Refine From/Via/To + suggestion + thread.
**F4 Edit flow in draft** □ View·Edit seg, Edit pressed □ draft bar: name, authors, delta, 3 buttons □ bands with ⊕ □
removed call faded+struck+"removed in draft" □ added call "in draft" chip + bubble □ "was tbd" chip □ sparks on new heads
only, not on their calls □ panel form uses real inputs, Delete left in `--bad`, Done right.
**F5 Field diff** □ Compared-with seg □ new/changed/removed rows with left edge, "was …", strike □ child of new field
unmarked □ section title shows Changed + count sentence.
**F6 Import** □ assistant card asks once, with 3 kinds of answer □ neutral notice (not warn) with Import/Add □ results
grouped by env with kind; "Here" column; footer count + primary □ imported items show no spark afterwards.
**F7 Inventory + flows** □ New/Changed/Unchanged seg with counts □ grouped by subsystem □ Changed rows say what
changed, linked □ flows by name, key mono under, description, "Name a flow" for unnamed.
**F8 Discussions (phase 4)** □ subject = level chip + name □ open/resolved and where filters □ removed anchors listed.
**F9 Flow page** □ flow description full width under title, collapsible, Human/AI per 0.14.0 □ stepbar ‹ n of N › +
label □ step description box □ step tiles at arrow starts, current solid + halo □ fold column "⋯ N folded", arrows stop
with ⋯ + target name □ both ends of current step visible at 760 □ harvested env flow shows all of this but no Edit.
**All frames** □ no yellow except spark/New tint (and `--flow-2` dots) □ no `--warn` glyphs □ nothing truncated that a
row is about □ tab focus visible on every control □ reduced-motion screenshot identical minus twinkle.

## 5. Open UX questions for the maintainer
1. Apply conflict: stop and list (mockup spec) or newer edit wins? (I recommend stop and list.)
2. Changed mark: yellow ring (shown) or pencil glyph? Ring is fine in light; in dark it sits near amber `--warn`.
3. `--flow-2` is yellow too: accept (async dots only) or retune it so the spark is truly the only yellow?
4. Add dark-mode `--warn #e0a030` / `--bad #ff6b6b` app-wide (mockup assumes them), as a separate change?
5. Environment picker: replace the rail `<select>` with the listed rows (mockup) for all users now, or only once a
   design env exists?
