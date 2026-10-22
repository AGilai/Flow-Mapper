-- Notes per flow (0.34.0): one rich document per (env, anchor), kept as versions, and step ranges on comments. Spec: docs/plans/notes-tabs.md.
-- Additive: one new table, one index, two ADD COLUMNs; nothing existing is rewritten.
-- `flow_notes`: every Save is a new row (`version` counts from 1 per env + anchor); the latest is current; a restore writes a new version with
-- `restored_from` set, nothing is deleted. `body` is sanitized HTML (core/rich-text.ts with notes: true: headings and step chips too).
-- `author` is the display name at the time, `author_id` the user (migration 016). `anchor` is a core/anchors.ts anchor (today flow:<service>/<ingress>).
-- No foreign key to envs or snapshots, as comments: a re-harvest must not drop the notes of a flow.
-- `comments.steps_from` / `steps_to`: a comment on a range of 2+ steps (step keys, core/description.ts); `step` stays null for such a comment.
-- Postgres notes as 011: times are ISO TEXT; the DESC index is the same SQL there.

CREATE TABLE flow_notes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  env           TEXT NOT NULL,
  anchor        TEXT NOT NULL,
  version       INTEGER NOT NULL,
  body          TEXT NOT NULL,
  author        TEXT NOT NULL,
  author_id     TEXT,
  restored_from INTEGER,
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_flow_notes_latest ON flow_notes (env, anchor, version DESC);

ALTER TABLE comments ADD COLUMN steps_from TEXT;
ALTER TABLE comments ADD COLUMN steps_to TEXT;
