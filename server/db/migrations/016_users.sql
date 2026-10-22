-- Users registry (0.31.0, bug #66 part 2): who writes comments and owns action items, and who can be @mentioned. Spec: docs/plans/users-mentions.md.
-- Additive: new tables plus ADD COLUMN; the free-text `author` / `owner` / `created_by` stay as the display fallback.
-- `users.id` is a short stable id ('u_' + 8 hex). `color` is a slot 0-7 derived from the id (core/users-match.ts colorSlot), stable across renames.
-- `name` is unique (case-insensitive) among live users; a merged user keeps its row with `merged_into` set and leaves the unique index.
-- `user_aliases` keeps old names after a merge so a REST client that still sends the old name matches the right user.
-- `comment_mentions` lists the users an `@[userId]` token in a comment body points at (kept in step by the comment writes; a merge re-points it).
-- `mention_seen`: a mention is unread for a user until a row exists here.
-- Existing authors and owners become users here (names that differ only in case or spacing are one user), so the sign-in picker is not empty.
-- Postgres notes as 011: the expression index and the partial unique index are the same SQL there; times are ISO TEXT.

CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  color        INTEGER NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT,
  merged_into  TEXT
);
CREATE UNIQUE INDEX idx_users_name ON users (lower(name)) WHERE merged_into IS NULL;

CREATE TABLE user_external_ids (
  user_id     TEXT NOT NULL,
  source      TEXT NOT NULL,
  external_id TEXT NOT NULL,
  UNIQUE (source, external_id)
);

CREATE TABLE user_aliases (
  user_id TEXT NOT NULL,
  alias   TEXT NOT NULL
);
CREATE INDEX idx_user_aliases_user ON user_aliases (user_id);

CREATE TABLE comment_mentions (
  comment_id INTEGER NOT NULL,
  user_id    TEXT NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX idx_comment_mentions_user ON comment_mentions (user_id);

CREATE TABLE mention_seen (
  user_id    TEXT NOT NULL,
  comment_id INTEGER NOT NULL,
  seen_at    TEXT NOT NULL,
  PRIMARY KEY (user_id, comment_id)
);

ALTER TABLE comments ADD COLUMN author_id TEXT;
ALTER TABLE action_items ADD COLUMN owner_id TEXT;
ALTER TABLE action_items ADD COLUMN created_by_id TEXT;

-- Back-fill: one user per distinct name (case- and space-insensitive) across comment authors, action item owners and creators.
-- The slot is the last hex digit of the id modulo 8 (the same rule as colorSlot).
CREATE TEMP TABLE _names AS
  SELECT lower(trim(author)) AS k, min(author) AS name FROM comments WHERE trim(author) <> '' GROUP BY lower(trim(author))
  UNION SELECT lower(trim(owner)), min(owner) FROM action_items WHERE trim(owner) <> '' GROUP BY lower(trim(owner))
  UNION SELECT lower(trim(created_by)), min(created_by) FROM action_items WHERE trim(created_by) <> '' GROUP BY lower(trim(created_by));
INSERT INTO users (id, name, color, created_at)
  SELECT 'u_' || lower(hex(randomblob(4))), min(name), 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM _names GROUP BY k;
UPDATE users SET color = (instr('0123456789abcdef', substr(id, -1)) - 1) % 8;
DROP TABLE _names;
UPDATE comments SET author_id = (SELECT id FROM users u WHERE lower(u.name) = lower(trim(comments.author)) AND u.merged_into IS NULL);
UPDATE action_items SET owner_id = (SELECT id FROM users u WHERE lower(u.name) = lower(trim(action_items.owner)) AND u.merged_into IS NULL),
                        created_by_id = (SELECT id FROM users u WHERE lower(u.name) = lower(trim(action_items.created_by)) AND u.merged_into IS NULL);
