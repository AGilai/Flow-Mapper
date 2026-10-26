# Flow info banner and step panel (#91) — build spec

Status: draft by the lead, 2026-10-26. Target 0.45.0, after 0.44.0 (the Simple view, which touches the same page).
Mockup: frame 25 (needs the maintainer's approval before code). Files: web/js/views/flow-head.js, flow-relations.js, flow-stepbar.js
(and CSS), core/markdown-lite.

## Header: the Info pill and banner
- The description control and the always-open Related flows block are replaced by one pill in the title row: **"Info · N related"**.
  - "Info" alone when there are no relations; "N related" alone when there is no description; no pill when there is neither.
- The pill is a button with `aria-expanded` and `aria-controls`. It opens an **inline banner** under the title row, not a popover: it
  pushes content down only while open, never covers the diagram, and works on a phone.
- **Banner, one column at every width (maintainer, 2026-10-26: related flows under the description, as frame 25h):**
  - **Description:** rendered with markdown-lite, clamped to 4 lines with "Show all". Author and date as today, plus Edit, plus the
    same A− / A+ control as the step panel (maintainer, 2026-10-26).
  - **Related flows:** one-line rows (relation phrase chip · link · note cut with an ellipsis), each with a chevron that expands its note.
    Notes stay plain text. More than six relations: the first six, then "Show N more".
- **Open or closed:** closed by default. The first time a user opens a flow that has a description, the banner opens once; after
  that the saved choice rules (`flow-mapper.flowinfo`, one global value, plus a "seen" set so the first-visit open happens only once).
  An edit doesn't close it.

## Step panel
- **Full width:** the title and "Step N of M" share the top row with prev/next. The description uses the whole width, so the half-width
  wrap and the less/more cut are gone.
- **A− / A+:** five sizes (0–4; the default is 1 = 13px), persisted in `flow-mapper.textSize`. The buttons have aria-labels and are disabled at the ends.
  It is ONE text size shared by the step description and the flow description: changing it in either place resizes both (and both controls show the same state).
- **"Hide text" / "Show text":** collapses the panel to one row of about 44px (title, count, prev/next, toggle), persisted in
  `flow-mapper.stepText`.
- **Not in this build:** the resize grip ("phase 2").

## Markdown
Step and flow descriptions are rendered with the same markdown-lite as `about`: bold, italic, bullets, line breaks and links
(http(s) only). Editing still shows the raw text.

## Storage
localStorage, wrapped in try/catch; if storage is unavailable, the defaults apply.

## Demo and tests
- Sample (env `prod`): a flow with a Markdown description, two related flows (one with a long note) and Markdown step texts. Add a DEMOS
  row and a CHANGELOG entry.
- Render tests for: the pill text variants, banner open and close plus storage, the first-visit open, note expand, Markdown in
  steps, A−/A+ bounds and persistence, and Hide text.
- QA screenshots in light, dark and at 760px, compared with frame 25.
