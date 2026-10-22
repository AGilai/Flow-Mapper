# Small release 0.32.5: Flows list grouping (#79) and the current-step highlight (maintainer)

## #79 (corev5-importer; QA TL decision)
- A "Group by: Component | None" control on the Flows list (next to the existing filters).
- None = one flat list in natural name order (`ARL_2` before `ARL_10`; numeric runs compared as numbers); entries with no
  flow name come after, by their label.
- Default: None in design environments, Component in harvested ones. Kept in the URL as `group=` (omitted at the env
  kind's default) and remembered per env (try/catch localStorage). The Component (and Subsystem) filter still applies
  in both modes.

## Current-step highlight (maintainer, 2026-10-22)
"In the steps I would add a toggle for whether I want the highlight rectangle on the flow or not; leave the selected
black dot that comes with it. When highlight is on, a light yellow rectangle, not the rectangle with borders, which
interrupts the fine viewing."
- The current step's numbered black dot always shows.
- A "Highlight current step" checkbox in the "Step details ▾" panel (its own row under the two sections). Default on;
  remembered per viewer; URL `hl=0` when off.
- When on: a soft filled band behind the step row, light yellow from a new token pair (light and dark tuned for
  contrast, e.g. `--step-hl` / `--step-hl-dark`), no border, no outline, behind the arrows and text. It must stay
  readable with on-arrow details (sd=tad), nested group frames, mark bands (#75) and in maximize/zoom.
- Keyboard focus outlines elsewhere are unchanged.

Tests: natural sort, grouping defaults per env kind and URL; highlight URL parse. CHANGELOG lines, DEMOS rows,
version 0.32.5.
