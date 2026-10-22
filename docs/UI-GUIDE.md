# UI guide

Rules for anyone changing `web/`. The reader is an engineer asking "who talks to whom, with what,
and what's broken". A page succeeds when they get that answer in a few seconds, without putting
separate boxes together in their head. Reference mockup: `design/mockups/channel-sns.html`.
Page-by-page problems: `design/AUDIT.md`.

## 1. Information hierarchy

Every detail page has the same four layers, in this order:

1. **Identity** (page head): name, kind chip in its transport colour, bind key in mono, and
   provenance on one meta line ("Defined by infra in order-events.tf:4 · Live AWS matches code").
2. **Verdict**: one plain sentence that answers the page's question, plus at most one callout per
   problem that links to the row it is about. Write it from the data
   ("orders-svc publishes 2 event types; the topic fans out to 3 queues").
3. **The flow or the main table**: the main thing on the page, full width.
4. **Reference**: payload/schema JSON, raw details and source links, below the main content or
   collapsed.

- Do: put provenance in the head's meta line.
  Don't: leave it as a floating "Declared by infra at … · match" line under the right column.
- Do: keep a figure only if it answers a question and links to its rows.
  Don't: open every page with five equal tiles ("1 Publishers, 4 Subscriptions, 0 Consumers…") that
  repeat the counts in the box titles below.

## 2. Show the flow, left to right

Anything with a direction is drawn as **lanes**: upstream on the left, downstream on the right,
with one column per hop and a header over each column.

| Page | Lanes |
|---|---|
| SNS topic / EventBridge bus | publisher → topic → subscription filter / rule → queue → consumer · handler |
| SQS / AMQP queue | source (topic or bus) → subscription filter → **this queue** → consumer · handler. Several sources join in a merge bracket, with one arrow into the queue |
| Event type | producer → channel(s) → queue → consumer · handler |
| Data store | caller function → operation (read/write) → store |
| Service | ingress (callers) → service → egress (targets) |

- A bar is tinted by its component, not by the call that reaches it; the connector still carries the transport.
- Connectors use the transport colour of the hop (`--t-sns` publish/fan-out, `--t-sqs`
  deliver/poll, `--t-http`…). Draw a dashed connector when the hop is uncertain (declarations
  disagree, unresolved). Use `--t-broken` only for a link that is known to be broken.
- One row per path. A shared upstream node (publisher, topic) spans all its rows, with a fan-out
  bracket.
- The filter or rule belongs **on the connector** between topic and queue, not in a separate list.
- The consumer node shows the endpoint, "calls" and the handler (`in.events calls ingest_event`),
  then what it handles; beyond 3 event types it shows "+N more".
- A filter that lets everything through is a small "all events" label on the connector, not a box.
  Boxes are for real filters and for disagreements.
- Beyond 4 rows the shared nodes (publisher, topic, queue, consumer) stay in view while you scroll
  the lanes. Beyond 8 rows the lanes collapse, with "Show all N" directly under the last row. Where
  rows hang off a fan (the event page: queues of a topic), the "Show all N" stub sits inside that fan,
  as its last branch, and only Handled rows collapse: problem and possible rows always stay visible.
- A service that several rows reach (one consumer reading two queues, or one producer with several
  call sites) is one node, with a merge bracket in front of it. The outcome for the page's subject sits
  inside the node (Handled / Arrives, no handler / Possible), not in a separate grid.
- A route that a subscription filters out is not drawn on a page about the event type: as far as that
  page goes the queue is not subscribed. The API still returns it (`outcome: filtered`).
- When the lanes are wider than the page they scroll inside their card, with a fade on the right
  edge and a hint that says what is off-screen.
- Identifiers break after `-`, `.` and `_` (use `<wbr>`), never in the middle of a word.
- Do: one "How events flow" lane block.
  Don't: separate "Published by", "Subscriptions" and "Consumed by" boxes stacked vertically.

- Counts come from the same drawn set: the number on a topic node, in the verdict and on a "Show all N"
  control agree, and none of them includes rows the page does not draw.
- A dashed edge always has a matching "Possible" chip on its source node, and the verdict says the same.
  Dashed grey (no colour) means "target not resolved", and the legend says so.
- A consumer line names only a handler that handles this page's subject. Without one it says
  "<ingress> has no handler for this type", never the ingress's entry function.
- The legend lists only what is drawn.
- Subsystem bands (0.28.1) group lifeline heads: a band is grey (`--surface-2`, a line icon from the six in `--ink-2`), never a component colour, and only a New subsystem carries a spark. The store bands sit under them, same row height.
- Every empty state has one sentence that says what is hidden and why ("Outcome lines are hidden:
  nothing is delivered").
- When the page is too narrow, producer and topic shrink first and the outcome column clips last;
  the lanes scroll with the hint and fade.
- State classes (`.maybe`, `.warn`, `.st.*`) are scoped to their component, never global.

## 3. One row per real-world thing

The harvested data is the truth, but different harvesters can describe the same thing. Group
declarations by identity (for example a `from`+`to` subscription, or a channel key) and render
**one** row.

- When the declarations agree, show the row once and list the sources in its "declared by" text.
- When they disagree, keep one row and put the disagreement inside it: one line per source, with
  the differing value highlighted (`--warn` tint) and the source link next to it. Name the field
  that differs ("disagree on the filter"), not a bare badge.
- Do: `⚠ 2 declarations disagree on the filter: infra tf:22 → OrderPlaced only · shipping-svc → all events`.
  Don't: two `sqs:shipping-order-events` rows, each with "conflict"/"drift" badges that don't say
  what differs. Don't: "fed by sns:order-events" listed twice.
- Provenance words need a plain-language gloss: `drift` → "live AWS differs from this code",
  `match` → "live AWS matches code", `code-only` → "not checked against live".

## 4. Status sits next to the thing it describes

- A status chip goes in the same row and cell as its subject, directly after the name, never in
  another column or box.
- Use a matrix when a status depends on two things (event type × destination): rows are event
  types, columns are destinations, and the cell says "handled · onOrderPlaced", "filtered out" or
  "arrives, no handler".
- Status words are fixed: **Handled**, **Arrives, no handler**, **Filtered out**, **No reader**
  and **Possible** (muted: the publisher could only say the event is one of several candidates;
  never counted as a problem).
- A callout about a row ends with a "Show the row" link that scrolls to the row and flashes it
  (and expands the list if the row is collapsed).
- When everything in a grid is Handled, collapse it to one sentence ("All 11 event types are
  handled by analytics-svc in `ingest_event`") with "Show all event types".
- Every warning says **why** and **what follows**: "arrives, no handler, if shipping-svc's
  'all events' is right".
- Do: tint the problem cell. Don't: a red `unhandled` pill at the far end of a truncated
  "orders-svc → analytics…" string in the right column.
- The page-level callout repeats the problem in one sentence and links (`#anchor`) to that row.

## 5. Empty and zero states explain

A zero is only alarming when something is expected to be there. Before you print `0`, check
whether the zero is normal for this kind of object.

- Explain structural zeros: an SNS topic has no direct consumers, so say "Delivered through 3 queue
  subscriptions" instead of "Consumers 0". A queue has no subscriptions, so hide that box.
- Hide sections that cannot apply to the kind (subscriptions on a queue, "Other keys in X: None").
- Name the next step for real gaps, left-aligned: "No harvested service reads this queue. Its
  consumer's harvester may be missing."
- Use `--bad` red only for a non-zero problem count. A zero is `--muted`, not green and not red.
- Do: "No problems". Don't: a "0 Problems" tile with the same weight as real counts.

## 6. Density and truncation

- Never truncate the thing the row is about: a key, service name, event type or handler. Wrap it
  (`overflow-wrap: anywhere` on mono keys) or give it the space. Truncate secondary text only, and
  always put the full text in `title`.
- Never truncate a list of names with an ellipsis ("analytics-svc, shipping-svc,…"). Show the
  first 3 and a "+N more" link, or use lanes.
- Don't wrap service names in table cells ("payments-\nsvc"): use `white-space: nowrap` on name
  columns and drop or abbreviate the others.
- Content has a max width of about 1240px. Don't leave a two-column layout with a short main
  column and a blank half: use one full-width block when the content is a flow.
- JSON viewers stay inside their card (`overflow:auto`), and their toolbar is never clipped.
- Row rhythm: 8–10px vertical padding in tables, `--s3` between lanes, `--s5` between sections.

## 7. Typography

- `--font` for prose and labels. `--mono` for anything copied into code: bind keys, egress and
  ingress ids, handlers, event types, operations.
- One weight step per level: the page title `--fs-lg`/600, section titles `--fs-md`/600, body
  `--fs-sm`/400, meta `--fs-xs` in `--muted`. Don't use `<h2>` at `--fs-lg` for every box: that
  turns six boxes into six equal headlines.
- Column headers over lanes are `--fs-xs`, sentence case, 600, in `--muted`. Never uppercase
  anything: identifiers (service, queue, event name) keep their spelling.
- Show counts in the box title as plain `--muted` text ("Subscriptions 3"), not as a second number
  tile.

## 8. Colour

- Transport tokens (`--t-*`) mean a transport everywhere: lines, the kind chip, a node's left
  border. Never use one for anything else (`.pill.write` currently borrows `--t-sns`).
- Status tokens: `--ok`, `--warn`, `--bad`. Tint backgrounds with
  `color-mix(in srgb, var(--warn) 7–12%, var(--surface))`. Use full-strength colour only for text,
  icons and 2–3px borders.
- Vendor logos (AWS SNS, SQS and EventBridge are all magenta) are identity, not meaning. Never let
  them be the only cue: pair them with the transport-coloured kind chip. On the system map,
  colour the node by its transport token, not by the logo, and make the legend match what is drawn.
- Use `--accent` for links and the current navigation item only.
- Component colours (`--cmp-1..8`) mean a component, never a transport or a status. They colour the head stripe and tint and the activation bars of that component (28% fill, nested bars 42%), the Squeeze fold of one component, the step-bar dots and the map node's ring, nowhere else. The slot comes from `GET /api/envs/meta` `colors` (kept per environment; past 8 the palette repeats). Client apps and infra stay neutral; lines, arrowheads and chips keep their transport token.
- Inside one flow two components never share a colour: `declash` (core/colors.ts) gives the later one the next free slot for that flow only; the stored colour of the environment is not touched.
- Test both themes: every colour comes from a token, so dark mode must work without extra rules.

## 9. Cards, tables or lanes

| Use | When | Example |
|---|---|---|
| **Lanes** | there is a direction (calls, publish, deliver, read/write) | channel, queue, event type, service connections, store access |
| **Table** | many comparable items with the same fields, to sort or scan | inventory, link health lists, the event × destination matrix |
| **Card** (`.box`) | a self-contained reference object | JSON payload, schema, details, one bug |
| **Figure tiles** | at most 4 headline numbers, each clickable to filter | link health top line |

- Don't put a list of 1–3 items in a card with its own header and border. Inline it or use a lane.
- Don't nest cards inside cards. A section has one border, and its rows are separated by
  `--line` rules.
- Tabs are for peer views of the same data. If the tab labels don't fit the width, use a
  segmented filter or a select instead. Don't clip "Subscriptions to nothing (0".
- A details or info panel squeezes the page: it takes its own column on the right and the page
  narrows to make room. It never overlays the content (maintainer rule, 2026-10-20). Below
  860px the panel may take the full width instead.
- Data stores in a flow (0.27.1, frame 12): one neutral head per collection (store icon, collection, `<store> · <kind>`, the `--t-res` stripe, never a
  component colour) under a grey band "<kind>: <store>". More than 5 collections of one store in a flow fold into one stacked head. A read is a thin
  line with a dashed return, a write a heavier line with no return and a shorter bar: weight, never colour, says which. Labels are the harvester's operation.

## 10. Design environments and status marks

- A design environment says so above every page (the `design` chip, "from <source>, <date>"); sealed (harvested) environments never show Edit, the draft bar or marks.
- Marks are New (a spark: a 4-point star), Changed (a ring with a dot, with what changed in words: "+1 endpoint", "was string") and Removed (muted, struck through).
  Mark the highest new level only; the children of a new item carry no mark. A parent of a marked child shows Changed.
- Marks compare with the baseline (the source as it was when the environment was copied) by default; "Compared with" switches to the source now, same kinds of marks.
  Comparing with the source now, an item only the source has reads "only in <source>", never "Removed".
- Imported items are unchanged against their own source: no spark.
- A draft's edits are drawn in place with the draft's marks; "in draft" (accent chip) means "your pending change", the one sanctioned non-link use of `--accent`. What a draft removed is listed under the diagram ("N calls removed in this draft"), not drawn.
- A missing item in a design is a neutral notice, not a warning: a call to a target that is not in the design yet is drawn dashed in `--ink-2` with no cross, its lifeline head reads "not designed yet" in a neutral dashed box, and on the map the ring is `--ink-2` ("Target not in this design"); sealed environments keep the red. A call whose transport is not decided is a neutral grey solid line with a "transport not decided" chip. Tracing a copied endpoint (Components copy) says where its behaviour lives ("Open in <source>") instead of failing: the trace API answers 409 NO_HANDLER.
- Where marks go: the system map (spark on a new node, ring on a changed one, the words under it), Inventory (the All / New / Changed / Unchanged filter and a "What changed" column), the service page (badge by the name and on section titles and rows), flow heads and arrows (an arrow takes the mark of its call, else of a new endpoint it reaches), the DTO / message / schema field tables (a 3px edge, "was ...", removed fields struck).
- Tokens: `--new` / `--new-ink` only on a mark (shape first: the glyph is mandatory in every New and Changed badge, never colour alone); `--warn` never on a mark; Removed is `--muted` plus strike-through, never `--bad`. One short twinkle on load; none with reduced motion. `--flow-2` (async dots) is also yellow and stays that way: it is never a star.
- Checklist line: no `--warn` glyph, no `--new` on a problem, every mark has its glyph.

- **The subsystem level (0.28.1)** (`level=subsystems`): a box per subsystem with its icon, label, member count and the components as a list (prod ones muted, a New box carries one spark and no per-component sparks). A rolled-up line is in the transport colour, thicker with more calls, dashed when async, labelled "2 calls · http"; more than 6 lines between two boxes collapse into "N calls · M transports". An abstract link is dashed ink with open ends and a chip with its state (abstract, partial, ready, broken): never colour alone. A refined one disappears into its roll-up line ("includes: <name>"). "Not set" is a box only when its members take part in calls. With more than 8 boxes there is one merged line per pair (all transports and directions), drawn only for the hovered or selected box unless "All lines" is on. Boxes, lines and links are focusable (Tab, Enter). At component level a region round each subsystem's components replaces the team districts; its head opens Inventory.

### References, import, forms and the Flows list (0.26.0)

- A **reference** (lock) is neutral: a copied endpoint whose behaviour is in its source. The lock is an SVG symbol (`i-lock`), never the emoji, and never `--warn`. It sits on the end of an arrow into the reference ("behaviour in prod" and "Import into design" in Edit with a draft, "Open in prod" in View), on a lifeline head only when every call of this flow into that component reaches a reference (D6), after the name in the Flows list, and on the service page ("N reference endpoints", a Behaviour line per endpoint: reference / imported from prod, Oct 21 / from prod / in this design).
- **Import into design** copies one level. It never fires directly: it opens the preview in the side panel (counts are the preview's `total`; "Already here", "Stays a reference" with an Import each). What a callee in another component needs stays a reference. A **partial flow** says which steps continue into references (neutral line under the step bar, step numbers are the walk's). Editing a call into a reference asks every time ("Import users-svc's flow first" / "Edit the call only").
- **Edit forms** (Edit mode with a draft only; View keeps today's panels): a head opens the component form, an arrow the call form (the entry arrow the endpoint form), "+ call" under a bar and "+ component" (flow toolbar, Inventory subsystem rows) open new ones, "Edit flow" the flow form. They live in the side panel, use `.fgrid`, show errors under the field (`EditError.field`), save with one call ("Saved to draft <name>") and delete only after a confirm. A flow's name is the page title with a pencil (Enter saves, Esc cancels; Edit with a draft: a draft op, else written at once).
- **Flows list**: the Subsystem then Component checkbox groups (a header button with `aria-expanded` and the applied summary, "Select all · Deselect all", a fieldset with a legend) filter above the text box; "Changed only" (and removed) in a design; `subsystems=`, `components=`, `changed=` in the URL, left out when everything is selected. A collapsed list shows the active flow and the filter summary. Each row: the name over the entry key and summary, the lock, the New / Changed mark (tooltip: what changed), an ↗ when the flow has a main link.
- **Links** (`links.main` as a link next to the title, `sub` as small ↗ chips; http(s) only, new tab, `rel=noopener`) and the **runtime** mark (a heptagon outline for k8s kinds, tooltip: the runtime) appear on the service page, the flow header, the lifeline head and the map node.
- **Chips under an arrow** ("in draft", "transport not decided"): when they do not fit beside the step tile they stack one per line, never over the return label.

### Rich text and comments (0.27.0)

- **Rich text is a sanitized HTML subset, never a free-for-all.** Stored and shown as the allowlist of `core/rich-text.ts` (`p br b strong i em s del strike u ul ol li a table thead tbody tr th td span code pre blockquote`). Anything a page shows from it is set as `innerHTML` only after `sanitize()` has run over it in the browser (the server's pass is not trusted for that); nothing else in the UI sets HTML from data. A new rich-text spot reuses `comments/rte.js` and its sanitizer; it does not write another filter.
- **Colour is a palette class, not a value.** Text colour is one of six `cc-*` classes (coral, ochre, sage, cyan, sky, violet) that map through `--cc-*` to the component tones (`--cmp-*`), with a shade nudged where 4.5:1 on the surface needed it. A comment written in one theme reads in the other. Never store hex.
- **The editor is a toolbar over a `contenteditable`:** B I S, text colour (default + six, an anchored menu of tinted tiles with the letter "A"), bulleted and numbered list, link (a small popover, http(s) only), table 3×3 and, with the caret inside one, a Table group (+ row, − row, + col, − col). At 760 px and below Link, Table and the Table group move into a "…" menu; nothing wraps to a second row. Buttons never take focus from the text (mousedown is prevented), arrow keys move along the bar, Esc closes a menu first and cancels second, Ctrl/Cmd+Enter submits.
- **Paste keeps only what the sanitizer keeps:** bold, lists, links and tables from Word, Confluence or a page come across; fonts, sizes, backgrounds and hex colours do not. Drops insert plain text.
- **A thread is a list in date order** with the composer at the end: avatar initials, name, a "you" tag (the name remembered on this browser equals the author, the same naive rule as drafts), relative time with the full date as the tooltip, "edited", a step pill that jumps the walk (plain "step (gone)" when the step no longer exists). One level of replies, indented with a rule. Delete asks in the line itself, never in a browser dialog. The section collapses like the description and remembers it per viewer.
- **Attach to a step only when the viewer chose one.** Step 1 is always "current"; the toggle is offered once the viewer has moved or clicked a step, and is on then.

### Zoom of the flow diagram (0.30.3)

- One compact control, "- [100%] + Fit Reset", in the flow toolbar after Step details, and in the top bar of a maximized flow. The % is a text box (25 to 400, Enter applies, a bad entry goes back). Fit shows pressed while it holds. Zoom scales the SVG (viewBox), never a raster, so text stays crisp; the lifeline heads scale with the body.
- Zoom is per tab and in the URL (`zoom=`, `fit` allowed, 100 left out). Ctrl/Cmd + wheel and pinch zoom around the pointer.

### Transport hints (0.30.4)

- An undecided transport on an arrow is a small hollow diamond (the size of the New / Changed mark, `--ink-2`, shape first, never colour alone). Its words, "transport not decided", are its tooltip and a line in the step bar. Decided transports keep their compact label.
- The toolbar toggle "Transport hints" (`th=0|1`, left out at the default) shows the full text label. Default: off in a design environment, on elsewhere.

## Floating bug button and env dropdown (0.24.2)

`components/bug-dialog.js` mounts one round "Report a bug" button on every screen (hidden on `#/bugs/new`). It opens `components/bug-form.js`, the same form as the page, in a modal dialog so the page underneath is untouched; it moves left of an open right-hand panel. Keep the bottom-right corner of the viewport free of controls that matter. The rail's environment picker is a dropdown of the active environment (`components/env-picker.js`).

## Checklist before merge

- [ ] Screenshot at 1440px and at 760px, in light and dark. Can you state the page's answer in
      5 seconds?
- [ ] There are no duplicate rows for one real-world thing, and every status sits in its subject's row.
- [ ] No zero alarms, nothing truncated that the row is about, and no half-empty column.
