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

## Checklist before merge

- [ ] Screenshot at 1440px and at 760px, in light and dark. Can you state the page's answer in
      5 seconds?
- [ ] There are no duplicate rows for one real-world thing, and every status sits in its subject's row.
- [ ] No zero alarms, nothing truncated that the row is about, and no half-empty column.
