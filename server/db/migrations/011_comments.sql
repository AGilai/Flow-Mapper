-- Comments under each flow (0.27.0): a discussion per anchor, rich text stored as sanitized HTML (core/rich-text.ts).
-- Additive: one new table and one index; no existing table is touched.
-- `anchor` is a core/anchors.ts anchor (today always flow:<service>/<ingress>), so later slices can open threads on any anchor.
-- `step` is a step key (core/description.ts) when the comment is about one step. `parent_id` is one level only: a reply to a reply
-- is stored with the top comment's id. A delete is soft (deleted_at, body emptied): a deleted top comment that has replies still
-- shows as "Comment deleted"; without replies it disappears.
-- No foreign key to envs or snapshots: a re-harvest must not drop a discussion, and a comment of a vanished flow is simply not read.
-- Postgres notes as 005: times are ISO TEXT; AUTOINCREMENT becomes GENERATED ... AS IDENTITY.

CREATE TABLE comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  env        TEXT NOT NULL,
  anchor     TEXT NOT NULL,
  step       TEXT,
  parent_id  INTEGER REFERENCES comments(id),
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  edited_at  TEXT,
  deleted_at TEXT
);

CREATE INDEX idx_comments_anchor ON comments (env, anchor, created_at);
