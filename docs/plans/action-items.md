# Action items under each flow (0.29.0): build spec

The design is mockup frame 15 (design/mockups/design-env.html, frames 15a–15g), approved by the maintainer on
2026-10-22. Action items are a section of their own in the flow's bottom pane, linked to comments, not a comment type.
Build it next to the comments feature (docs/plans/comments.md) and reuse its patterns: anchors, the draft read, SSE
events, Full copy, the preview's in-memory store and the remembered name.

## Data: `server/db/migrations/013_action_items.sql` (additive)
`action_items`:
- `id` INTEGER PK
- `env` TEXT NOT NULL
- `anchor` TEXT NOT NULL (today always `flow:<service>/<ingress>`)
- `number` INTEGER NOT NULL. Per (env, anchor), never reused: the next number is max(number)+1 over all rows,
  deleted ones included. UNIQUE (env, anchor, number).
- `owner` TEXT NOT NULL (1–80 characters, cleaned like comment authors)
- `description` TEXT NOT NULL (plain text, 1–2000 characters, trimmed)
- `status` TEXT NOT NULL: `open | progress | done | dropped`
- `due` TEXT NULL (`YYYY-MM-DD`)
- `step` TEXT NULL (a step key, validated like comments)
- `comment_id` INTEGER NULL (the comment it was made from; must be on the same anchor)
- `source` TEXT NOT NULL DEFAULT 'human' (`human | ai`; MCP writes `ai`)
- `created_by`, `updated_by` TEXT NOT NULL
- `created_at`, `updated_at` TEXT NOT NULL, `closed_at` TEXT NULL, `deleted_at` TEXT NULL (soft delete)

`action_item_events`: `id`, `item_id`, `kind` (`created | closed | reopened | dropped`), `actor`, `at`. Written by the
store on create and on a status change across the open/closed line. Index `(env, anchor, number)` on items.
No foreign key to envs or snapshots, as comments. Postgres-portable SQL only.

## Rules (lead decisions)
- Anyone can edit any field and change status; the actor name is recorded in `updated_by`. Delete is allowed only to
  the creator (`created_by` must equal the request's `actor`), like comments. Naive identity, documented as such.
- Open = `open` + `progress`. Headers read "(3 open · 5)" (open · all non-deleted). Overdue = due < today (the viewer's
  local date) and status open/progress.
- Thread events: the comment thread shows one-line events under the comment an item was made from ("Asaf G. created
  action #4 from this comment", "Dana closed #2", "… dropped #2", "… reopened #2"). Items not made from a comment
  produce no thread events. Clicking "#4" scrolls to the row and outlines it.
- Deleting the source comment keeps the item; its "from X's comment" link becomes plain text.
- A Full copy carries items, events and comment links (remapping comment ids). Blank and Components copies do not.
- Allowed on every env kind, sealed too (annotations), and on draft flows via `?draft=`.

## Server
- `server/store/action-items.ts` (+ `action-item-events.ts` if it passes 250 lines): list (with events), add, update,
  soft delete, counts, copy, and `loadActionItems` for seeding.
- Routes `server/routes/action-items.ts`:
  - `GET /api/envs/:env/action-items?anchor=&draft=` → `{items:[…], events:[…]}`
  - `GET /api/envs/:env/action-items/counts` → `{anchor: openCount}` (anchors with 0 open omitted)
  - `POST /api/envs/:env/action-items` `{anchor, owner, description, status?, due?, step?, commentId?, actor}`
  - `PATCH /api/envs/:env/action-items/:id` `{actor, owner?, description?, status?, due?(null clears), step?}`
  - `DELETE /api/envs/:env/action-items/:id?actor=`
  - Errors use the existing error shape: 400 VALIDATION, 404, 403 NOT_CREATOR.
- SSE: `action_item.created / updated / deleted` with env, anchor, id, number, status, actor.
- MCP `server/mcp/tools/action-items.ts`: `list_action_items {env, service, ingress, draft?}`,
  `add_action_item {env, service, ingress, owner, description, status?, due?, step?, commentId?, author}`,
  `update_action_item {env, id, author, owner?, description?, status?, due?, step?}`. MCP writes set `source: 'ai'`.
  Document them in docs/API.md and the MCP tool list.
- Preview: in-memory store, like comments.

## UI (frame 15)
- `web/js/action-items/`: `section.js` (the section, header counts, fold of closed rows, empty = no section),
  `row.js` (a read row: number, owner, description with "from X's comment" and step pill, due with overdue, status
  chip, Edit/Delete on hover, always visible on touch/≤760), `editor.js` (inline edit row: owner with recent-name
  suggestions, description textarea, status select, due date input, step pill, Save/Cancel, Enter saves, Shift+Enter
  newline, Esc cancels), `pure.js` (counts, overdue, plain-text prefill: strip HTML via core plainText, trim to 200
  with "…"). Each file ≤ 250 lines.
- Comments section changes: "+ Action item" button on the Comments header (shown only when the flow has no items),
  "Make action item" next to Reply on every comment (prefills description and step, outlines the comment while open),
  and thread events rendered under their comment.
- Section placement: above Comments in `.flow-bottom`; collapsible, open state remembered per viewer (try/catch
  localStorage). Cancelling the very first unsaved item removes the section. Deleting the last item removes it.
  Closing the last open item keeps it ("0 open · 1").
- Owner suggestions: names seen in this flow's comments and items plus the remembered reporter name.
- Actor = the remembered name (`flow-mapper.reporter`), asked once like comments.
- Flows list: a small open-actions badge per entry point from `/action-items/counts` (hidden at 0), next to 💬.
- "by AI" chip on rows with `source: 'ai'`.
- CSS `web/css/action-items.css`, tokens only, status colours per frame 15c, light and dark, 760 px cards (15f).
- Live update: re-fetch on `action_item.*` events for the open flow, as comments do.

## Tests
- store/routes: numbering never reused after delete, creator-only delete, anyone edits, validation (status, due
  format, lengths, step, commentId on another anchor), events on close/reopen/drop, counts, draft reads, sealed env
  allowed, Full copy remaps comment ids, Blank/Components don't copy
- MCP list/add/update and the `ai` source
- the migration on a copy of the live DB
- `npm run preview` still builds

## Demo
- `samples/action-items/prod.json`, seeded after comments: on `api-gateway/in.createOrder` 5 items (2 open, 1 in
  progress, 1 done, 1 dropped), one overdue, one from a sample comment, one with a step.
- DEMOS row `#/flows?env=prod&tabs=api-gateway/in.createOrder`; CHANGELOG entry; version 0.29.0.
