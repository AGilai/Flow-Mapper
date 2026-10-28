# "About this flow" region (#95) — build spec

Status: approved by the maintainer, 2026-10-28. Target 0.46.0. Replaces the 0.45.0 Info pill and banner (docs/plans/flow-info-stepbar.md, header part only;
the step panel is unchanged). Mockup: frame 26 (design/mockups/frames/frame-26.html), approved. Files: web/js/views/flow-head.js, flow-desc.js,
flow-desc-dialog.js, flow-relations.js, flow-tab-view.js (wiring) and their CSS.

## Why (the maintainer's five points)
1. The Info toggle was detached from its content (doc link / Export / pencil between them).
2. The "No AI description yet / Generate" row always showed.
3. The description was half width and clipped (fade on line 2, a "Click to edit" tooltip over the text).
4. Show all / Show less sat at the bottom.
5. Wanted: one compact collapsible region, remembered per user, with a font-size control.

## The region
- One full-width region directly under the flow title row. Title-row actions (doc link, Export, detail switch) stay in the title row; the Info pill is removed.
- **Header row = the toggle.** A button (`aria-expanded`, `aria-controls`) holding a chevron, "About this flow", and, when collapsed, a one-line
  plain-text preview of the description (`stripMarkdown`, ellipsis) and a "N related" chip (no chip at 0). The whole row is clickable.
- **Open:** the same header row carries, right-aligned and outside the toggle button: Show all / Show less, A− / A+ (the shared `flow-mapper.textSize`,
  same as the step panel; disabled at the ends), Edit (an explicit button), and a `⋯` menu button. Collapsed shows none of these controls.
  At narrow widths the controls wrap under the toggle; no horizontal scroll at 760px.
- **Description:** full width, markdown-lite rendered, clamped to 4 lines with a clean cut (line-clamp, no fade, no hover tooltip, no click-to-edit).
  Show all is hidden (or disabled) when the text is not clamped. Show all state is not remembered: each flow starts clamped.
  Author/date line and the AI badge / "outdated" mark as today, under the text. Human text wins over AI as today.
- **Sticky header:** while open and expanded, the region header is `position: sticky` under the flow title row, so Show less stays reachable.
- **Related flows:** under the description inside the region, the 0.45.0 one-line rows (chip · link · note, chevron to expand, "Show N more" after six).
- **Empty state (no description):** one quiet line in the region: "No description yet · Write one" (Write one = Edit). Show all and A−/A+ are hidden;
  Edit and `⋯` stay. With no description and no relations the region still shows, collapsed, preview "No description yet".
- **`⋯` menu:** one item, "Generate AI description…", with a second line "Copies a prompt for your AI tool; its usage is billed to you". It opens the
  existing Generate dialog (flow-desc-dialog.js), which is the confirm step; add the same cost note at the top of that dialog. No standing Generate row
  anywhere in the flow header. (Flow-Mapper calls no AI itself, so do not say "a few cents".) Menu: keyboard accessible, Esc closes, click outside closes.
- **State:** open/closed in `flow-mapper.flowinfo` as today (one global value; keep the 0.45.0 first-visit rule: closed by default, opens once on a flow's
  first visit while no choice is saved). localStorage in try/catch.

## Not changed
The step panel, the sub-flow `descLine` and the per-service `descBlock` in the lane bars keep their current look, except that none of them shows a standing
"Generate" row either: their Generate moves behind a small `⋯`/link the same way if they have one (keep it minimal).

## Demo and tests
- Demos: http://localhost:3000/#/flows?env=sase-hld&draft=info-demo&tabs=sase-agent/in.tunnel.open (description + relations) and a prod flow with no
  description (empty state). Add a DEMOS row and a CHANGELOG `## Unreleased` entry.
- Render tests: header toggle and aria, preview text plain, related chip, controls only when open, Show all hidden when unclamped, A−/A+ shared with the
  step panel, empty state, `⋯` menu opens Generate, no Generate row, state persistence and first-visit open. Update the 0.45.0 tests that assert the pill.
- QA screenshots light, dark and 760px compared with frame 26.
