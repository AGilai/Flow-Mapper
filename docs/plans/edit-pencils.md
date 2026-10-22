# Edit where you read: pencils on every editable item (0.31.1): build spec

Design: Frame 19i, 19i-2 and 19j (design/mockups/frames/frame-19.html), approved by the maintainer on 2026-10-22, who asked
"where do I edit the items under the components — missing an edit/pencil button?". Today editing is only reachable
by switching View → Edit (top right) with a draft and clicking a lifeline head or arrow in a flow.

## Behaviour
- A small pencil (on hover; always visible on touch and keyboard focus; aria-label "Edit <thing>") on every editable
  item, opening the existing forms (web/js/design/forms/*: component, endpoint, call, dto, flow, relation, subsystem,
  about-field):
  - service (component) page: name/header (component form), Docs links, About (whole + per `##` section), each endpoint
    row (endpoint form), each flow row (flow form);
  - Inventory rows (component form) and subsystem group headers (subsystem form);
  - the existing side panels (map component panel, subsystem panel, flow-view head panel).
- **View mode:** clicking a pencil switches to Edit and opens the form. With exactly one open draft it uses it without
  asking (maintainer); with several, a small popover picks the draft; with none it offers "Start draft 'my edits'".
- **Harvested envs (prod):** only annotation pencils (flow and step descriptions/notes); header, about and endpoint
  pencils are absent, with one muted "Harvested — edit at the source" hint per page. No "propose a change" (declined).
- One shared helper (`web/js/design/pencil.js`) renders the pencil and does the View→Edit/draft step, so every place
  behaves the same.

## Tests and demo
Pure tests for the draft choice (0 / 1 / many drafts) and which items get pencils per env kind. Screenshots vs 19i/19j
light/dark/760. DEMOS row on sase-hld, CHANGELOG one UI line, version 0.31.1.
