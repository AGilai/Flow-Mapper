# Maximize a flow (0.29.1): build spec

Maintainer request (2026-10-22): "a maximize button per flow … renders the flow and its comments/action items, all
the tab on all the screen, and a floating button saying exit full screen … for clarity and focus". The design is frame
16 in design/mockups/design-env.html; the maintainer said "design and implement", so it is built without a separate
approval and overridden by a bug.

## Behaviour
- An icon button (four corners out, `icon('maximize')`) at the right end of every flow header, after Export, with
  tooltip and aria-label "Maximize (F)". The key F toggles it when focus is not in an input, textarea,
  contenteditable or select, and no dialog is open.
- Maximized: `document.body.classList.add('is-max')` plus `data-max` on the flow tab. CSS hides the app top bar, the
  left rail, the Flows list and the tab strip, and makes the active `.flow-tab` a single scrolling column filling the
  viewport: the flow header (sticky, step controls included), the diagram at full width and its natural height, the
  description, Related flows, Action items and Comments, all open, with no 40vh cap on `.flow-bottom`. Text sections
  max-width 1100px, centred.
- The page also calls `document.documentElement.requestFullscreen()` (guarded, ignore rejections). Leaving the browser
  full screen (`fullscreenchange` with no element) exits maximize too. Exiting maximize exits browser full screen if
  it is on.
- "Exit full screen" pill (fixed, top right, z-index above the content, below dialogs): icon + label + `Esc` kbd. It
  fades to 0.55 opacity after 2 s without pointer movement and returns on movement or focus. At ≤ 760 px only the icon
  and Esc show. Keyboard reachable, aria-label "Exit full screen".
- Esc exits unless the focus is in an editor/input or a dialog is open (they handle Esc first).
- The floating bug button stays visible.
- URL: `max=1` (setQuery) while maximized, so a reload or a link opens maximized (window-filling only). Opening a link
  with `max=1` and several tabs maximizes the active tab.
- After entering or leaving, dispatch `fm:layout` so the diagram re-measures.
- Works in every env kind and in the static preview.

## Files
`web/js/views/flow-max.js` (state, keys, fullscreen, pill), CSS in `web/css/flow-max.css` (tokens only, light and
dark), the icon in `web/js/icons.js`, the button in the flow header. Files ≤ 250 lines. No dependencies.

## Tests and demo
- A pure test for the key guard (which targets ignore F/Esc) and the URL state.
- Screenshots: normal header with the button, maximized light, maximized dark at 760 px; compare to frame 16.
- DEMOS row `#/flows?env=prod&tabs=api-gateway/in.createOrder&max=1`; CHANGELOG one UI line; version 0.29.1.
