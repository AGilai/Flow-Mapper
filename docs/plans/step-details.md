# Step details: the step bar carries the step (0.30.0): build spec

Design: Frame 17 in design/mockups/design-env.html (17g is the default). Maintainer review on 2026-10-22: the three
parts (title, API, description) appear on the "Step x of y" bar, which today shows only the route; the diagram stays
lean; stepping shows the step being discussed; the on-arrow text of the mockup is a configurable option; a step can be
edited from the step or from the bar. Lead decisions: title is edit-only (no manifest field); Step details also applies
to the Inside-the-service view; Mermaid export uses the title as the message text when set, with the API in a note.

## Data: `server/db/migrations/015_step_titles.sql` (additive; 014 is #66)
`ALTER TABLE descriptions ADD COLUMN title TEXT` (≤ 80 characters, trimmed; NULL = none). It applies to step keys
(`callee` starting `#step:`) and is ignored elsewhere. Same human-wins rule as `text`: the human title, else the AI
title. A record may carry a title with empty text, and vice versa.

## API
- The existing description write (REST human write, MCP `set_description` for AI) takes optional `title`. Reads return
  `title` with the record. Draft reads unchanged otherwise.
- MCP hash moves; CHANGELOG notes the new field for agents.

## UI
- **Step bar (default view):** ‹ Step n of m › then a compact block of up to 3 lines: Title (bold), API + route (mono,
  `PUT /reservations  orders-svc → inventory-svc`), Description (human, else AI with the AI tag; 2 lines then "…"
  and "more" expands inline). Empty parts collapse; no description shows a muted "Add a description" link. "Edit
  step" button on the right. Stepping updates the block. At ≤ 760 px it wraps per frame 17g.
- The separate "Step description" section under the bar is removed (its content now lives in the bar and the editor).
- **Editor popover** (frame 17c): Title (optional) and Description with Human | AI tabs, Save/Cancel, Enter saves in
  Title, Ctrl/Cmd+Enter in Description, Esc cancels (asks if dirty). Opened from: the bar's "Edit step" (anchored
  under the bar), the step's pencil on hover/selection (always visible on touch), right-click "Edit step description…",
  double-click on the step's title/description line, key E with a step selected.
- **Step details toggle** (toolbar, frame 17d): "Step details ▾" with checkboxes Title / API / Description and presets;
  default API only (today's arrows). Remembered per viewer (try/catch localStorage) and in the URL `sd=` (letters
  t,a,d; omitted at the default). At least one stays on. Row height comes from the row model (layout and squeeze must
  not assume a constant). A step with none of the enabled fields falls back to its API line.
- Applies to the Full flow and the Inside-the-service view, in the static preview too, and in maximize (0.29.1).
- Mermaid export: the step title, when set, is the message text and the API goes into a `Note`.

## Tests and demo
Migration on a copy of the live DB; title validation and the human-wins rule; MCP set_description with title;
row-height model per option; URL `sd=` parse/encode; Mermaid export with a title. Sample titles on 3 steps of
`api-gateway/in.createOrder` (samples/descriptions). DEMOS rows: the bar `#/flows?env=prod&tabs=api-gateway/in.createOrder`
and the arrows `…&sd=tad`. CHANGELOG, version 0.30.0.

## Lead decisions after the 17g revision (2026-10-22)
- The bar may show 4 text lines (title, API, 2 description lines); "… more" expands inline and "less" folds it.
  Scroll-into-view uses the bar's real height from the DOM.
- Double-click on the bar's detail block also opens the editor.
- No "AI draft available" strip in this release.

## Maintainer amendment (2026-10-22): two sections in the panel
"Step details ▾" holds two sections, each with Title / API / Description checkboxes: **Step bar** (default all three)
and **Arrows** (default API only). The viewer chooses what shows where. Remembered per viewer and in the URL: `sb=`
(bar) and `sd=` (arrows), letters t,a,d, each omitted at its default; `sb=-` means nothing in the bar but the stepper.
Arrows keep at least one field (falls back to API). The button label summarises both, e.g. "Step details: bar 3 ·
arrows API".
