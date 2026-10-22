# Flow tabs: active state, click-replaces, "Tab" button, 10-tab cap

Design for the Flows page (`#/flows?env=…&tabs=…`). Files read: `web/css/flow-tabs.css`, `flow-list.css`, `sequence.css` (`.entry`), `flow-max.css`, `web/js/views/flows.js`, `flow-tabs.js`, `flow-tabs-state.js`, `flow-list-rows.js`, `flow-list.js`, `flow-index.js`, `flow-tab-view.js`. Not verified in a browser (no browser was available). Tokens only; dark mode comes free from `tokens.css` because every colour below is a token or a `color-mix` of tokens.

## Today
- `.tab.on` already exists, but it is weak: every tab, active or not, has the same coloured top bar (2px vs 3px), the same `b` label weight, and the active fill (`--paper`) is only a shade off the inactive fill (`mix(--surface 55%, --surface-2)`).
- A list row is `a.entry`; a click calls `onPick` -> `openEntry` -> `T.openTab` (new tab). The dot `.has-tab` marks rows that have a tab; `aria-current` marks the active one.
- The sub-flow "back" trail is the `.crumbs` row in `.tpad` (`head()` in `flow-tab-view.js`), drawn only when the tab key has an `@origin`. Maximize hides `.ftabs` entirely.

## 1. Active tab
Principle: the active tab is the one that is part of the page. Three non-colour cues: it joins the pane (same fill, no bottom line, 1 px taller), a full-strength top bar, a heavier label. Inactive tabs recede: bar at 40 %, label weight 500.

```css
/* replaces .tab, .tab:hover, .tab .tl b, .tab.on in flow-tabs.css */
.tab { background: color-mix(in srgb, var(--surface) 40%, var(--surface-2)); color: var(--ink-2);
  box-shadow: inset 0 2px 0 color-mix(in srgb, var(--tc, var(--t-http)) 40%, transparent); }
.tab .tl b { font-weight: 500; color: var(--ink-2); }
.tab .tl i { color: var(--muted); }
.tab:hover { background: var(--surface); color: var(--ink); box-shadow: inset 0 2px 0 var(--tc, var(--t-http)); }
.tab:hover .tl b { color: var(--ink); }
.tab:focus-visible { outline: 2px solid var(--focus); outline-offset: -3px; z-index: 1; }
.tab.on { background: var(--paper); height: 37px; margin-bottom: -1px; border-color: var(--line-strong); border-bottom: 0;
  box-shadow: inset 0 3px 0 var(--tc, var(--t-http)), 0 1px 0 var(--paper); } /* last shadow hides the strip line under the tab */
.tab.on .tl b { font-weight: 700; color: var(--ink); }
.tab.on .tn { background: var(--accent-soft); color: var(--accent); }
.tab.on .x { color: var(--ink-2); }
.tab:not(.on) .x { opacity: .7 } .tab:hover .x, .tab .x:focus-visible { opacity: 1; }
.tab.on:hover { background: var(--paper); } /* no hover change on the active tab */
```
- Contrast (checked from token values): active label `--ink` on `--paper` 14:1 light / 13:1 dark; inactive `--ink-2` on the tab fill about 7:1 light / 8:1 dark. The 3 px bar is decoration, not the only cue.
- Focus: `--focus` 2 px ring, inset so the mask fade of `.tabscroll` cannot clip it. Roving tabindex stays as built (active tab = the one tab stop; arrows move and activate).
- Back trail: `.crumbs` is the first row inside the active pane (`.tpad`, `--paper`), directly under the tab, so the tab and its trail read as one sheet. No change. Add `border-left: 3px solid var(--tc)` to `.tpad` only for sub/full tabs? Rejected: it duplicates the bar. Keep the trail as is.
- Maximize bar (`.max-bar`, `--surface`) replaces the strip; nothing to restyle. Its title already names the active flow. Exiting maximize returns to the strip with the same active tab.
- Reduced motion: no transition is added to tabs.

## 2. Click replaces the active tab; "Tab" opens a new one
Semantics (all in `flows.js` / `flow-tabs-state.js`):
- **Plain click on a row** (`onPick`): `T.replaceActive(S, key)`. No tabs open -> opens the first tab. Same key as the active one -> nothing. Key already open in another tab -> switch to that tab (never two identical tabs, never replace). The replaced tab keeps its position and stays active; the old key goes onto the closed stack so Alt+Shift+T brings it back. The tab's own state (zoom, squeeze, step, panel selection) is reset: it is a new flow.
- **"Tab" button**: `T.openTab` as today (new tab, activated). Already open -> switch to it (button tooltip says so). At 10 tabs -> blocked (section 3).
- Cmd/Ctrl/Shift-click and middle click keep their native browser behaviour (new browser tab).
- A replaced **sub-flow or full-flow tab** (it has a `@origin` crumb): the new key is an entry key, so the crumb row disappears by itself. Recommendation: say nothing, no confirm. Tabs opened *from* the replaced tab keep their crumb; its link re-opens the origin (counts against the cap, see section 3).
- Row marker: keep the `.has-tab` dot; add `aria-current` on the active row (exists). Rows whose flow is open show the "Tab" button in its accent state (below).

### The button
Markup: wrap the row so the button is not inside the `<a>` (a button in a link is invalid): `div.entry-r > a.entry + button.entry-tab`. `.entry-r` takes the `.entry` hover/current background (move `:hover` and `[aria-current]` to `.entry-r`). Focus order per row: row link, then Tab button (DOM order). Group headings (`.fg-head`, `tgrp`) get no button.

- Label exactly `Tab` (with a tiny "+" glyph before it, `aria-hidden`). `title` = `Open in a new tab`; `aria-label` = `Open <flow name or key> in a new tab`.
- Always visible, never hover-only (touch, keyboard, <=760 px). Quiet ghost style so 100 rows do not shout.
- Placement: top-right of the row, aligned with the first line (name or transport chip). The badges (`💬`, action counts, `@ n new`, relations) sit on the key line below, so they never collide; the first line gets `padding-right` for the button.
- States: rest, hover, focus, open (the flow already has a tab: accent border/text, `title` = `Already open: go to its tab`), capped (section 3).

```css
.entry-r { position: relative; border-radius: var(--r-sm); }
.entry-r:hover { background: var(--surface-2); }
.entry-r:has(> a.entry[aria-current='true']) { background: var(--accent-soft); }
.entry-r > a.entry { background: none; padding-right: 54px; } /* room for the button on the first line only: see next rule */
.entry-r > a.entry > .key, .entry-r > a.entry > .fl-sum { margin-right: -46px; } /* lines below reclaim the width */
.entry-tab { position: absolute; top: 5px; right: var(--s2); display: inline-flex; align-items: center; gap: 3px; height: 22px; padding: 0 8px;
  font: 500 var(--fs-xs) var(--font); color: var(--ink-2); background: var(--surface); border: 1px solid var(--line); border-radius: 11px; cursor: pointer; }
.entry-tab:hover { color: var(--accent); border-color: var(--accent); }
.entry-tab:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
.entry-tab.is-open { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.entry-tab[aria-disabled='true'] { color: var(--muted); border-style: dashed; background: none; cursor: not-allowed; }
@media (pointer: coarse), (max-width: 760px) { .entry-tab { height: 28px; padding: 0 12px; top: 4px; } .entry-r > a.entry { padding-right: 64px; } }
```
- "All endpoints" rows are the same `entryRow`, so they get the same button and click behaviour. The "All endpoints (N)" checkbox row and the filter groups are not rows and get none.
- The empty state copy changes to: `Pick a flow in the list. Click opens it here; "Tab" opens it next to the others.`

## 3. Cap of 10 open tabs
Rule: `T.TAB_CAP = 10`; `T.canOpen(S, key)` is true when the key is already open or `S.keys.length < 10`. All openers go through it (Tab button, "Open in tab", "Full flow ▸", crumb link that reopens an origin, "Open all distinct", Alt+Shift+T reopen, URL decode). Plain click never hits it (replace or first tab).

- **Message** (toast, the existing `.toast` from `dom.js`, bottom centre, ~4 s; also `aria-live="polite"` so it is announced): `You have 10 tabs open. Close some tabs to open another.`
  Inline text near the strip was rejected: the click happens in the list, far from the strip, and a toast is already the app's pattern.
- **Buttons at 10**: not `disabled` (a disabled button cannot be focused or explain itself). Use `aria-disabled="true"` + the dashed style above; the click shows the toast. Tooltip becomes `10 tabs open: close one to open another`. Buttons for flows that are already open stay normal (they switch).
- **Counter**: the strip's `▾ N` button shows the count already. From 8 up it reads `▾ 8/10`; at 10 it gets `border-bottom: 2px solid var(--warn)` and `font-weight: 700`, label stays `--ink` (the amber alone is under 3:1 on `--surface-2`). Title: `10 of 10 tabs open. All open flows`. Below 8 it stays `▾ N`.
```css
.tabmenu.near b { color: var(--ink); } .tabmenu.full { box-shadow: inset 0 -2px 0 var(--warn); }
```
- **Open all distinct (N)**: opens as many as fit, the first of them is activated. Toast: `Opened 3 of 5. 10 tabs is the limit, 2 skipped.` With no free slot: the full message above, nothing opens. Its tooltip, when N exceeds the free slots: `Opens the first 3 (10 tabs is the limit)`. Order = list order (existing `distinctRows`).
- **URL with more than 10 tabs**: keep the first 10 keys in URL order, but if `tab=` points past the 10th, it replaces the 10th so the shared link still shows the flow it points at. `persist()` rewrites the URL. Toast on load: `The link had 14 tabs. Opened 10: the limit.`
- **Crumb link / reopen at the cap**: blocked with the same toast. Alt+Shift+T at the cap: same toast.

## Edge cases
- Closing the active tab: unchanged. The tab it was opened from if open, else the left neighbour, else (it was first) the new first tab. Closing frees a slot at once; the counter and button states update in the same render.
- Closing the last tab: empty state, the next plain click opens the first tab.
- Replace while maximized: n/a (list hidden). Replace while a draft/edit form or the info pane is open: the pane closes with the old flow (`clearMessage`), as when switching tabs.
- Click on the row of the active flow: no-op (no flicker, no history entry).
- Two rows with the same flow (e.g. All endpoints off/on): same key, same behaviour.

## Files a coder will touch
- `web/js/views/flow-tabs-state.js`: `TAB_CAP`, `canOpen`, `replaceActive` (+ closed-stack push), cap in `openTab`/`decodeUrl`; tests in `tests/` for state (cap, replace, URL trim).
- `web/js/views/flows.js`: `onPick` -> replace, new `onPickTab`, guards + toasts in `openEntry`/`host.openTab/openSub/openFull/openMany` and reopen, counter class, empty-state copy.
- `web/js/views/flow-list-rows.js` (+ `flow-list.js` for `onPickTab`, open-state refresh near line 81): wrapper + `button.entry-tab`, `is-open` / `aria-disabled` sync.
- `web/js/views/flow-tabs.js`: counter text and `.near`/`.full` classes.
- `web/js/views/flow-index.js`: "Open all distinct" partial open + tooltip; "Open in tab" guard.
- `web/css/flow-tabs.css` (active/hover/focus, counter), `web/css/flow-list.css` (`.entry-r`, `.entry-tab`), `web/css/sequence.css` (move `.entry:hover` / `[aria-current]` to the wrapper).
- `docs/API.md` not affected; `docs/DEMOS.md` row: a demo env with 12 flows so the cap can be hit. Bump `version` (user-visible).
