# Store panel (#86): build spec

Design: `design/mockups/frames/frame-23.html` (frame 23). Status: approved ask; the lead approves the visual.
Scope: web UI only. No API, schema or manifest change. Build to the mockup; classes there are prefixed `f23-`.

## What it is
In an open flow (sequence lane), clicking a **Redis or Mongo participant head** opens a panel in the existing right-hand
pane listing only what **this flow** touches in that store. The full key list stays on the store page.

## Data source (all already in the trace)
Resource steps (`kind: 'resource'` messages of the trace, see `flow-stores-pure.js` `splitStore`, `opLabel`):

| Field | Use |
|---|---|
| `store` | `redis:<instance>` or `mongodb:<db>/<collection>`; `splitStore(m)` gives group, store name, kind, collection |
| `storeKind` | `redis` or `mongodb` (panel only for these two; other kinds keep today's behaviour: no click) |
| `access` | `read` / `write` / `read_write` (maybe missing) |
| `label` | the op name (`get`, `setex`, `findOne`); `use` means none: show `opLabel(m)` as the pane does today |
| `fields` | Mongo only: `{role: filter|projection|update|sort, path, operator?, inDdl?}`, drawn with `stepFields`' grouping and `!` for `inDdl:false` |
| `note` | `file:line` of the step (also `trace.code['step:<service>:<fn>#<seq>']`); render as the same code link the step pane uses |
| `owner` | not shown here (subsystem band only) |
| `details.keyTemplate`, `details.dbIndex`, `details.ttlSeconds` | Redis key card header; surfaced on the trace message by the same path the step pane already uses for `details` (if the trace does not carry them yet, add them additively and document in API.md) |
| `unresolved` (`what: detail`, `detail: details.keyTemplate`) | the reason shown under "Key not reported" |
| step number | `trace.messages.indexOf(m) + 1` (same as the pane's "Step") |

No new manifest field: the Loader sends `details.keyTemplate` as already documented (bug 86 triage). Do not add `keyPattern`/`keyRef`.

## The join to the keys registry
- Fetch `GET /api/envs/:env/resources/:id/keys?service=<flow service>` lazily the first time the panel opens for a Redis store
  (the instance id is the store name of `redis:<instance>`); cache per (env, instance) for the life of the tab.
- Match `keyTemplate` **exactly** (string equality, case-sensitive) against `groups[].rows[].keyTemplate`; a row also needs `dbIndex` equal
  when both sides have one. No fuzzy or prefix matching.
- Row found: show the Keys registry block (see texts). Fields: `description` (when the API row carries it; else omit the paragraph), owner (the `owner` group's service,
  or "shared" for the shared group), `ttl.seconds` (and "writers disagree" when `ttl.disagree`), `writers`/`readers` as "service (access)".
- Row missing, request 404 or no pushed list (`source: none`): the block says "Not in the keys registry". A failed request (network/5xx) shows nothing and no error: the panel is complete without it. Never block rendering on it.
- The registry TTL may differ from the step's `ttlSeconds`; the card header shows the **step's** value (what this flow does), the registry block the registry's.
- Mongo has no registry: no block.

## Grouping rules
1. Scope: all resource steps of the open trace (every service in it, not only the entry's) whose store group equals the clicked head's group. For a Mongo collection lifeline also filter to that collection; for the folded Mongo lifeline (`res:<group>`, > 5 collections) keep all and make one card per collection.
2. Card per Redis `keyTemplate` (steps without one form the single card **Key not reported**, last). Card per Mongo collection.
3. Inside a card: one op row per (access class, op name). Op names compare case-insensitively and are shown as harvested (`SETEX` stays `SETEX`).
4. Access class: `read`, `write`, `delete`, `unknown`. `delete` = access `write` (or `read_write`) and op name in the DELETE list: `del, unlink, deleteone, deletemany, remove, findoneanddelete, findonedelete, hdel, srem, zrem, lrem, xdel` (case-insensitive). `read_write` with a non-delete op shows `read/write`; no access shows "access not reported" (`u`).
5. Order: cards by their first step number ascending; op rows by first step; chips ascending.
6. Code links: one per distinct `file:line` in the op row, with the steps it serves as "step 7" / "steps 3, 4, 6". Steps with no `note` simply have no link; an op row with no links has no code list.
7. Redis header meta: `db <n>` only when known (else omit); `TTL <human> (<s> s)` when `ttlSeconds` is a number across the card's steps, `TTL not reported` when none give one, `TTL 60 s / 3600 s` listing distinct values when steps disagree.
8. Mongo fields: union over the op row's steps, grouped by role in the order filter, project, update, sort; dedupe by `path`+`operator`.
9. Chips: show the first 8 per op row, then `+N more` (a button, `aria-expanded`); expanded shows all plus `Show fewer`. Expansion state is not persisted.

## Exact texts
- Head tooltip and accessible name: tooltip "Show what this flow touches in this store"; `aria-label` "Show what this flow touches in <name>, redis|mongodb"; `aria-pressed` true while open.
- Panel title: store name (Redis instance id, or the Mongo lifeline label); kind chip `redis` / `mongodb`; sub: "Redis instance · db 0" (`db n` only if one db) or "<store> · collection <name>"; folded Mongo: "<store> · <n> collections".
- Summary: "This flow touches **N keys** in this store, in **S of T steps**." (Mongo: "**N collections**"; singular "1 key"). Add " **K key(s)** not reported." when the Key-not-reported card exists. S = distinct steps in the panel, T = steps in the trace.
- Op chips: `read`, `write`, `delete`, `read/write`, `access not reported`. Each has an icon (down, up, cross, dash) and the word.
- Chip row label "Steps"; chip `aria-label` "Go to step N"; more button "+N more" with `aria-label` "Show N more steps"; "Show fewer".
- Key-not-reported card title: "Key not reported"; body "The harvester could not read the key for these steps (<reason>). The operation, steps and code are still shown." Reason from the `key_unresolved:<why>` suffix (`computed` -> "computed at runtime"; other values verbatim); with no `unresolved` entry: "The harvester did not send the key for these steps." (no parenthesis).
- Registry block: header "Keys registry" with "owner <service>" (or "shared"); "Not in the keys registry" with body "No row for this key template. The harvester pushed none, or it is spelled differently."; dl rows `TTL` (e.g. "3600 s, all writers agree" or "writers disagree: 60 s, 3600 s"), `Used by` ("auth-svc (read, write), gateway (read)").
- Footer: Redis link "Open <instance> · all keys" to `/instances/<id>` (`instancePath`); Mongo "Open <store>" to `/stores/<key>` (`storePath`). Small text: Redis "The store page lists every key, owner and TTL (<n> templates). This panel shows only what <flow label> touches." (omit the count when the registry is unavailable); Mongo "The store page has the schema, indexes and every service that uses this collection."
- Close button `aria-label` "Close panel".

## Interaction, keyboard, a11y
- Heads: only participants with `storeKind` redis or mongodb get the button behaviour; `role="button"`, `tabindex="0"`, Enter/Space toggle, hover (border `--accent`, fill `--accent-soft`), `:focus-visible` ring 2 px `--focus` offset 2, a small list glyph at the head's right edge as the resting hint, `cursor: pointer`. A click that is a drag/selection of text is ignored.
- Open state: head `aria-pressed="true"`, accent outline; its lifeline solid; arrows of other participants dim to 42 % opacity and the store's step numbers fill with `--accent`. Closing restores all.
- The panel reuses the step pane (same container, `aria-label` "What this flow touches in <name>"); opening it moves focus to the panel title only when opened by keyboard; closing returns focus to the head.
- Esc closes the panel (when focus is in the pane or on the head). Clicking an arrow switches the pane to the step panel (store head goes back to un-pressed); clicking the pressed head again closes.
- Step chip click: scroll the diagram so the arrow is in view (centred vertically when it was off screen, `scrollIntoView({block:'nearest'})` first), flash the row for 1.5 s (`--accent-soft` fill, 1.5 px `--focus` outline), mark the chip `current` (accent fill) until another is chosen; **the panel stays open**. With `prefers-reduced-motion`, no smooth scroll; the flash is a static outline that stays until the next click or Esc.
- The step chip is a native `<button>`; the registry/code links are native links. Colour is never the only carrier: access chips have icon + word, the pressed head has outline + `aria-pressed`.
- Narrow widths (< 900 px): the pane stacks under the diagram (as the step pane does).
- Dark mode: only existing tokens (`--accent`, `--accent-soft`, `--t-http`, `--bad`, `--ok`, `--focus`, surfaces); no new variables.

## URL state
`&store=<store key>` on the flows hash (e.g. `#/flows?service=auth-svc&ingress=POST%20/login&store=redis%3Ap81-production`; Mongo `store=mongodb%3Aaccounts-db%2Faccounts`). Restores the panel after reload and makes it shareable; a `store` that no lifeline of the trace matches is ignored silently. Removing the panel removes the param. (Tabs: it is per tab like `step`; follow what the existing step selection does.)

## Empty and edge states
- A head with no resource steps cannot exist (the lifeline is built from them), but a stale `store` param can: ignore it.
- Redis step without `details`: the whole panel is the one Key-not-reported card; the summary says "0 keys ... 1 key is not reported" -> use "This flow touches this store in S of T steps, with no key reported."
- Keys registry loading: card renders at once, registry block shows a one-line skeleton ("Loading registry...") then fills.
- Frontier-folded or blocked (#85) steps are not resource steps; they are out of scope.

## Tests (for the implementer)
Pure unit tests on a new `web/js/views/store-panel-pure.js` (no DOM): grouping by template/collection, delete classification, step/code dedupe, chip cap, summary counts, registry join (exact match, dbIndex, missing), reason text. One DOM test for toggle, Esc and chip jump. Keep files ~250 lines: pure grouping, panel draw, head wiring in separate files.

## Demo (per project rules)
Add a sample case in `samples/` (env `prod`): a flow with the three Redis keys (one with no registry row, one step with no keyTemplate) and a Mongo collection with filter/update fields; a keys PUT for two of them; a row in `docs/DEMOS.md` with the `http://localhost:3000/#/...` link including `&store=`.

## Open questions, recommended decisions
1. **Chip click: jump only, or also open the step panel?** Recommend jump + flash, panel stays (the store view is the point).
2. **Per-key deep link into the store page** (`/instances/<id>?q=<template>`)? The keys GET supports `q`; check the instance page reads it. Recommend add only if it already does; otherwise the bottom link only.
3. **Delete list** is a heuristic over op names. Recommend shipping it; Loader may later send an explicit op class, which would replace it.
4. **Panel in the URL.** Recommend yes (`&store=`).
5. **Mongo: also show indexes or schema?** Recommend no; the store page has them.
6. **Collapse threshold 8.** Recommend 8; tune after real flows (a 31-step checkout is the stress case in 23d).
7. **Other store kinds** (SQL, S3, DynamoDB): out of scope; heads stay non-interactive. The panel code takes the kind from `storeKind`, so adding one later is a new card builder.

## Known limit: folded DB runs
While a run of DB operations is folded ("DB: N ops") every member shares the run's step number, so the panel's chips for those operations show that one number (and "+N more" never appears for them). The chip still jumps to the folded row; expanding the run on the diagram renumbers the steps and the panel follows. Listing the members by their own numbers would need the run expanded, which changes the numbering the arrows use; left as is.
