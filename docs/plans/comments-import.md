# Comments: import fields and resolved state (#66, first part, 0.29.2): build spec

From bug #66 (corev5-importer, importing Confluence review comments), triaged by the QA TL. This is the decided part.
The users registry and @mention chips are a separate, undecided concept (mockup for the maintainer first) and are
out of scope here: a mention stays plain `@Name` text.

## Data: `server/db/migrations/014_comments_import.sql` (additive, ALTER TABLE ADD COLUMN only)
- `external_id` TEXT NULL, `external_source` TEXT NULL (e.g. `confluence`): unique per (env, external_source,
  external_id) when both are set (a partial unique index, Postgres-portable).
- `author_external_id` TEXT NULL (≤ 200)
- `resolved_at` TEXT NULL, `resolved_by` TEXT NULL

## API (REST and MCP `add_comment`, additive)
- `POST /api/envs/:env/comments` also takes `createdAt` (ISO 8601, kept as given, not in the future by more than 5
  minutes, else 400), `externalId` + `externalSource` (both or neither, ≤ 200 each), `authorExternalId`, `resolved`
  (bool) with optional `resolvedBy`/`resolvedAt`. `parentId` already exists (one level).
- **Re-import:** a POST whose (externalSource, externalId) already exists in the env updates that comment (body,
  author, step, resolved, createdAt) and answers 200 with `{..., updated: true}` instead of 201; it never duplicates.
  A different anchor for the same external id is 409 EXTERNAL_ID_TAKEN. `parentExternalId` may be given instead of
  `parentId` (resolved within the env and source; unknown → 400).
- `PATCH /api/envs/:env/comments/:id` takes `resolved: true|false` with `actor`: anyone may resolve or reopen (not
  author-only); body edits stay author-only. Resolving applies to a top comment and its replies (replies cannot be
  resolved alone: 400).
- Reads return `createdAt`, `externalId`, `externalSource`, `authorExternalId`, `resolved`, `resolvedBy`,
  `resolvedAt`. `GET …/comments/counts` counts unresolved top threads only.
- Events: `comment.resolved` / `comment.reopened`.
- MCP `add_comment` gains the same fields; a new `resolve_comment {env, id, author, resolved}`. MCP hash moves.
- Full copy carries the new columns.

## UI (no mockup; small, follows frame 13)
- A top comment gets "Resolve" next to Reply (and "Reopen" when resolved).
- Resolved threads are hidden by default; the Comments header shows "Show resolved (n)" as a small toggle when n > 0.
  A shown resolved thread is muted with a "Resolved by X · time" line.
- Imported comments show their given time; a small "imported" hint when `externalSource` is set (tooltip with the
  source and id).

## Tests and demo
Migration on a copy of the live DB; createdAt validation; idempotent re-import (same id twice → one comment, updated);
parentExternalId; resolve/reopen by a non-author; counts ignore resolved; MCP; Full copy. Sample: one resolved thread
and one imported comment in `samples/comments/prod.json`. CHANGELOG (importer-facing), DEMOS row, version 0.29.2.
