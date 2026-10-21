-- Environments as first-class objects (0.21.0). Until now an environment existed only as a value in the
-- `env` column of other tables, so an empty one could not exist.
--   sealed : filled only by harvesters (ingest, DTOs, schemas, Redis keys); manual entity edits are refused.
--   design : created by copying another environment (or blank); harvesters never write to it.
-- Additive only: every environment that has map data in any table is backfilled as sealed. `bugs.env` is a free-text
-- label on a report, not map data, so an env that only bugs mention (e.g. a harvester's own label) is not listed until it ingests.

CREATE TABLE envs (
  name       TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('sealed', 'design')),
  source     TEXT,                                          -- design: the environment it was copied from
  copied_at  TEXT,                                          -- design: when (the baseline's time)
  levels     TEXT NOT NULL DEFAULT '["Subsystem","Component"]',  -- JSON, outermost first
  groups     TEXT NOT NULL DEFAULT '[]',                    -- JSON, in order: [{key, label}]
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'anonymous'
);

INSERT INTO envs (name, kind, created_at)
  SELECT env, 'sealed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM (
    SELECT env FROM snapshots UNION SELECT env FROM entities UNION SELECT env FROM changelog
    UNION SELECT env FROM health_history UNION SELECT env FROM endpoint_dtos
    UNION SELECT env FROM event_dtos UNION SELECT env FROM store_schemas UNION SELECT env FROM resource_keys_meta
    UNION SELECT env FROM resource_keys UNION SELECT env FROM descriptions
  );
UPDATE envs SET created_at = COALESCE((SELECT MIN(updated_at) FROM snapshots s WHERE s.env = envs.name), created_at);

-- The rows a design environment was copied from, frozen at copy time (the diff that reads them comes later).
--   service '' = scoped to the environment (event DTO, schema); list: header | <entity list> | dto | event_dto | schema
--   key: entity key; dto: ingress|role|status; schema: store_key|source; header: ''
CREATE TABLE baseline_items (
  env            TEXT NOT NULL,
  service        TEXT NOT NULL DEFAULT '',
  list           TEXT NOT NULL,
  key            TEXT NOT NULL,
  data           TEXT NOT NULL,
  source_env     TEXT NOT NULL,
  source_version INTEGER,
  taken_at       TEXT NOT NULL,
  PRIMARY KEY (env, service, list, key)
);
