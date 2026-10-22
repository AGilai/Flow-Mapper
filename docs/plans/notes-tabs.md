# Notes per flow, tabbed bottom pane, comment brackets (0.34.0): build spec

Design: Frame 20 (design/mockups/frames/frame-20.html, 20a–20h), approved by the maintainer on 2026-10-22, with:
default tab = Notes when the flow has notes, else Comments (URL `pane=` and the viewer's last choice win); Notes allowed
in harvested envs too (annotations); @mentions in Notes count on the Mentions page; a comment with a single step pill
does NOT draw a bracket (only ranges of 2+ steps do).

## Bottom pane tabs
`Notes · Comments (n) · Action items (open · all)` replace the two stacked sections (frames 13/15). Active tab remembered
per viewer and in the URL (`pane=notes|comments|actions`). Cross-links switch tabs and outline the target. The tab-row
button: "✎ Edit" on Notes, "+ Add comment" / "+ Add action item" elsewhere; ▾ always offers Comment / Action item.
≤ ~600 px the tabs collapse into a select. Maximize shows the pane too.

## Notes (one rich document per flow)
- Storage: new table (migration 017) `flow_notes(env, anchor, version, body, author_id, created_at)` — every Save is a
  new version row; the latest is current; History lists the latest 30; Restore writes a new version (nothing deleted).
  Index (env, anchor, version DESC). Full copy carries notes (all versions or latest — latest + history).
- Body: the comments' rich-text subset plus `h2`/`h3` and a step chip `<span data-step="4">` (sanitizer allowlist extended
  narrowly; step chips jump to the step); @mention tokens as in comments (counted on the Mentions page as "in Notes").
- Read mode with an outline of headings at ≥ 1280 px (frame decision; adjust to 1360 if the rail is open); Edit mode with
  the comment editor + Heading menu + step-chip button; empty state with the template (Purpose / How it works /
  Decisions / Open questions). Stale save: "Keep mine / Open theirs".
- API: `GET/PUT /api/envs/:env/notes?anchor=flow:<s>/<i>[&draft=]`, `GET …/notes/history`, `POST …/notes/restore`.
  MCP `get_notes` / `set_notes`. Events `notes.updated`.

## Comment brackets (step ranges)
- A comment may carry `steps: {from, to}` (step keys; 2+ steps). Created by shift-click on step numbers or dragging the
  left gutter → "Comment on steps 4–9". Its pill reads "steps 4–9"; clamps if steps vanish ("steps 4–7 (was 4–9)").
- Diagram: a thin bracket in a left gutter (60 px; 44 px at 760) with 💬 n; up to 3 columns (2 at 760) then "+n"; hover
  or click → the light-yellow band (`--step-hl`, 0.32.5) over the range and the Comments tab with the comment outlined.
  Resolved comments hide their bracket. Layer toggle "Comment brackets" in Step details (on in design, off in harvested).
- Mermaid export writes a range as `rect` + `Note`; import (#71) reads it back.

Tests, demo (notes + a range comment on api-gateway/in.createOrder), CHANGELOG, DEMOS, version 0.34.0.

## Maintainer additions (2026-10-22)
- **The pane's header never scrolls away.** Today, with long content (long comments, or a long flow description above),
  the section header slides under the pane's top border, and you must scroll to the top to collapse it. In 0.34.0 the
  tab row (`Notes · Comments · Action items` with "+ Add ▾" and the collapse control) is sticky at the top of the pane at
  all times; inside Notes the document scrolls under it; the outline stays sticky too. QA must test with long Notes,
  20+ comments and many action items, in normal and maximized views and at 760 px.
- **The diagram / pane border is a drag handle.** A horizontal splitter between the diagram and the bottom pane: drag up
  and down (min: pane collapsed to the tab row; max: diagram keeps ~120 px), keyboard-resizable (focus + ↑/↓), double-
  click resets to the default, height remembered per viewer (try/catch localStorage). The diagram re-lays out on drag end
  (`fm:layout`). Maximize (frame 16) stays the full-page reading view. Also check the flow description box at the top
  (Human/AI): when long, its header must stay reachable (sticky summary or capped height with its own scroll).
