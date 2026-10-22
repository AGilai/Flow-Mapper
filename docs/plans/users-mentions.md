# Users and @mentions (#66 part 2, 0.31.0): build spec

Design: Frame 18 in design/mockups/design-env.html (18a–18g), approved by the maintainer on 2026-10-22 with the
lead's proposals: a global Mentions page in the left menu; avatars later (initials + colour now); mentions in every env
kind (harvested too); the MCP assistant is a user named "Assistant"; anyone may merge users (no sign-in; the DB is
backed up before migrations and the merge is logged); no @everyone.

## Data: `server/db/migrations/016_users.sql` (additive)
- `users`: `id` (TEXT, short stable id), `name` (≤ 80, unique case/space-insensitive among live users), `color`
  (slot derived from id, stable across renames), `created_at`, `last_seen_at`, `merged_into` (NULL or a user id).
- `user_external_ids`: `user_id`, `source` (e.g. `confluence`), `external_id`; UNIQUE (source, external_id).
- `user_aliases`: `user_id`, `alias` (old names kept by merge; rename keeps one only when asked).
- `mention_seen`: `user_id`, `comment_id`, `seen_at` (unread = mentioned and not seen). Survives merges (re-pointed).
- `comments.author_id`, `action_items.owner_id` (ADD COLUMN, NULL for old rows). The free-text `author`/`owner` stays
  as the display fallback; old rows are back-filled lazily (match by name, never invent ids for ambiguous names).

## Matching (one pure module, core/users-match.ts)
External id first → exact name / alias (case- and space-insensitive) → create a new user. Used by comment POST,
action items, imports (`authorExternalId` + `externalSource`), MCP ("Assistant" for MCP writes without an author).

## Mentions
- Stored in the comment body as `@[userId]` tokens (the sanitizer keeps them as text; render turns them into chips
  with the current name; unknown ids → dashed "@unknown user"). Plain "@Name" text in old comments stays text.
- The rich-text editor's "@" picker (recent first, fuzzy, "+ New user") and an "@ Mention" toolbar button.
- MCP `add_comment` accepts `@[userId]` and also `@{Display Name}` (resolved via matching).
- Read: `GET /api/mentions?user=&unread=1` (all envs), `POST /api/mentions/seen {user, commentIds}`; opening a flow's
  comments marks its mentions seen. MCP `list_mentions {user, unread?}`.

## Users API and page
- `GET /api/users`, `POST /api/users {name, externalIds?}`, `PATCH /api/users/:id {name, keepAlias?}`,
  `POST /api/users/:id/merge {into}` (re-points comments, items, mention_seen, external ids; keeps an alias; logs who
  merged). No delete. MCP `list_users`.
- UI: Settings › Users page (18d) with rename inline and the merge dialog; "Who are you?" picker (18e) replaces the
  free-text name prompt for comments, action items and the bug dialog (stores the user id in localStorage; migrates the
  old `flow-mapper.reporter` name by matching); "Mentions (n)" rail entry and page (18c); "@ n new" badge on Flows
  rows; "Mentioned me" filter in a flow's Comments header; action-item owner as a user chip (18b cont.).

## Tests and demo
Migration on a copy of the live DB; matching cases; mention token round trip and sanitizer; unread/seen incl. merge;
rename updates chips; merge re-points everything; MCP; Full copy keeps author_id/owner_id (users are global, not per
env). Samples: 3 users, one with a Confluence id, two mentions in prod comments. CHANGELOG (importer: authorExternalId
now creates/links users; mention token format), DEMOS rows, version 0.31.0.
