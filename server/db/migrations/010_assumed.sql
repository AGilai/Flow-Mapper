-- Assumed values on Redis key entries (0.25.2, #47): a JSON list [{what, value, basis, reason, detail?}], '[]' for none.
-- Additive: existing rows read as no assumptions.

ALTER TABLE resource_keys ADD COLUMN assumed TEXT NOT NULL DEFAULT '[]';
