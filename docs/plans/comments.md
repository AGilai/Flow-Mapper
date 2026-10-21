# Comments under each flow (0.27.0): build spec

The design is mockup frame 13 (design/mockups/design-env.html), approved by the maintainer on 2026-10-21. The
maintainer also approved the designer's three choices:
- "Yours" means the name remembered in this browser matches the comment's author.
- Only a Full copy carries comments; Blank and Components copies don't.
- Comments are a list: anyone can post any number of them under a flow.

This is the first slice of phase 4 (discussions). It is anchored with `flow:<service>/<ingress>`, so later slices can
open threads on any anchor without a migration.

## Data: `server/db/migrations/011_comments.sql` (additive)
`comments`:
- `id` INTEGER PK
- `env` TEXT NOT NULL
- `anchor` TEXT NOT NULL (today always `flow:<s>/<ingress>`)
- `step` TEXT NULL (a step key from core/description.ts, `#step:…`)
- `parent_id` INTEGER NULL (one level only: a reply to a reply is stored with the top comment's id)
- `author` TEXT NOT NULL (≤ 80 characters)
- `body` TEXT NOT NULL (sanitized HTML)
- `created_at` TEXT NOT NULL
- `edited_at` TEXT NULL
- `deleted_at` TEXT NULL (soft delete: a deleted top comment with replies shows "Comment deleted"; without
  replies it disappears)

Index `(env, anchor, created_at)`. Postgres-portable SQL only.

## Core (pure, shared with the browser)
- `core/rich-text.ts`: `sanitize(html): string` is an allowlist sanitizer written with no DOM. It tokenizes tags,
  keeps the allowed ones, escapes all text and drops all other markup.
  - Allowed: `p br b strong i em s del strike u ul ol li a table thead tbody tr th td span code pre blockquote`.
  - `a` keeps only an http(s) `href`, and output gets `rel="noopener noreferrer" target="_blank"`.
  - `span` keeps only `class` values from the palette `cc-coral cc-ochre cc-sage cc-cyan cc-sky cc-violet`.
  - `td`/`th` keep `colspan`/`rowspan` (1–20).
  - Everything else is stripped: attributes, styles, comments, script/style contents.
  - Max body length is 20 000 characters after sanitizing. Nesting depth is capped at 20, and a 50×20 table is the
    largest allowed.
- Exhaustive tests with an XSS corpus:
  - `javascript:` / `data:` / `vbscript:` URLs, entity-encoded variants, `<svg onload>`, `<img onerror>`
  - unclosed tags, `<scr<script>ipt>`, style attributes
  - Word/Confluence paste samples
- `plainText(html)` for MCP and search.

## Server
- `server/store/comments.ts`: list (a thread tree, oldest first), add, edit, soft delete. Only the author edits or
  deletes: the request's `author` must equal the stored one. This is naive identity, documented as such.
  - Validation: the flow must exist in the env (any env, or a draft read), and the step must be in the flow if given.
  - Every write sanitizes the body.
- Routes:
  - `GET /api/envs/:env/comments?anchor=flow:<s>/<i>`, which also takes `?draft=` so draft flows can be discussed.
  - `GET /api/envs/:env/comments/counts`: `{anchor: n}`, for the Flows list badge.
  - `POST /api/envs/:env/comments` `{anchor, step?, parentId?, author, body}`
  - `PATCH /api/envs/:env/comments/:id` `{author, body}`
  - `DELETE /api/envs/:env/comments/:id?author=`
  - Comments are allowed on every env kind (sealed too: they are annotations).
- Events: `comment.created` / `comment.edited` / `comment.deleted` on the SSE bus (`server/events/emitters.ts`), with
  env, anchor, id, author and the first 300 characters of `plainText`.
- A Full copy copies comments, keeping authors and times. Blank and Components copies don't.
- MCP tools (`server/mcp/tools/comments.ts`):
  - `list_comments {env, service, ingress, draft?}` returns plain text plus HTML.
  - `add_comment {env, service, ingress, step?, parentId?, author, body}`: the body may be Markdown-lite, i.e. plain
    text with `**b**`, `~~s~~` and `- ` lists, converted to the HTML subset. HTML is also accepted and sanitized.
- Preview: in-memory, like bug edits.

## UI (frame 13)
- `web/js/comments/`:
  - `thread.js`: the section, tree and empty state.
  - `comment.js`: one item with avatar initials, relative time with the full date in a tooltip, "edited", the step
    pill, and Edit/Delete for "you".
  - `composer.js`: the editor shell, "Comment as" once, Post/Cancel, Ctrl/Cmd+Enter, Esc.
  - `rte.js`: a `contenteditable` editor.
    - Commands are implemented directly, not with `execCommand` where it is unreliable. Bold, italic, strike, lists
      and links may use execCommand if it behaves in Chromium; the table and colour code is our own.
    - Paste is sanitized with the same `core/rich-text.ts`.
  - `rte-toolbar.js`: B I S, colour menu (default + 6), bulleted and numbered list, link, table 3×3; a Table group
    (+row −row +col −col) when the caret is in a table; a "⋯" overflow at ≤ 760 px.
  - `rte-table.js`
  - Every file is ≤ 250 lines.
- CSS: `web/css/comments.css`. The palette classes `cc-*` map to `--cmp-*` text tokens tuned for contrast in light and
  dark: check the 4.5:1 ratio and adjust shades in tokens.css if needed.
- Placement: the "Comments (n)" section sits under the flow description box. It collapses, and the open state is
  remembered per viewer. A step pill jumps the walk to that step; "step N (gone)" is plain text when the step no
  longer exists.
- The Flows list shows a small 💬 n count per entry point, from `/comments/counts`.
- Author name: reuse the bug dialog's remembered reporter name (`flow-mapper.reporter` in localStorage, try/catch),
  so the name is asked once for both.
- Live update: when a `comment.*` event for the open flow arrives on `/api/events` (already used by the UI? if not,
  re-fetch on focus), re-fetch the thread.

## Tests
- core sanitizer (the corpus above)
- store/routes: author-only edit/delete, one-level replies, soft delete, step validation, draft reads, counts,
  copy modes
- MCP list/add
- the migration on a copy of the live DB
- preview build

## Demo
- `samples/comments/prod.json`, seeded like descriptions: 3 comments plus a reply on `api-gateway/in.createOrder`,
  one with a table and one with colour and strikethrough.
- DEMOS row: `#/flows?env=prod&tabs=api-gateway/in.createOrder`.
- Version 0.27.0.
