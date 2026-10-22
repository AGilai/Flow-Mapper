-- Comment import fields and resolved state (0.29.2, bug #66): an importer (Confluence review comments) keeps its own id per comment so a
-- re-import updates instead of duplicating, and a comment thread can be resolved. Additive: ADD COLUMN only, plus one partial unique index.
-- `external_id` + `external_source` (e.g. 'confluence') are both set or both NULL; they are unique per env when set. `author_external_id` is the
-- author's id in that system. `resolved_at` / `resolved_by` live on the top comment of a thread only; its replies follow it.
-- Postgres notes as 011: ALTER TABLE ... ADD COLUMN and a partial unique index are the same SQL there; times are ISO TEXT.

ALTER TABLE comments ADD COLUMN external_id TEXT;
ALTER TABLE comments ADD COLUMN external_source TEXT;
ALTER TABLE comments ADD COLUMN author_external_id TEXT;
ALTER TABLE comments ADD COLUMN resolved_at TEXT;
ALTER TABLE comments ADD COLUMN resolved_by TEXT;

CREATE UNIQUE INDEX idx_comments_external ON comments (env, external_source, external_id) WHERE external_id IS NOT NULL AND external_source IS NOT NULL;
