-- 0.25.0: an op that imports an item from another environment records where it came from. Until the draft is applied the
-- import's baseline lives here (marks read it from the ops); apply copies it into baseline_items. NULL for every other op.
ALTER TABLE draft_ops ADD COLUMN origin TEXT;   -- JSON {"env": "<source env>", "version": <source snapshot version> | null}
