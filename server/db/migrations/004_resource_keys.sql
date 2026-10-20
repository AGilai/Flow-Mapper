-- Key templates per Redis instance (0.16.0, #29). A harvester pushes the whole list of one instance
-- (PUT /api/envs/:env/resources/:id/keys); it replaces the previous one and bumps `version`.
-- One row per service that uses a template in a db. `summary` is the key summary (counts, problems)
-- computed at push time, so the Inventory can show it without reading every key.
-- No foreign key to snapshots: a re-harvest of a service must not drop the keys pushed for an instance.

CREATE TABLE resource_keys_meta (
  env       TEXT NOT NULL,
  instance  TEXT NOT NULL,          -- instance key, e.g. redis:cache-main
  version   INTEGER NOT NULL,
  pushed_at TEXT NOT NULL,
  producer  TEXT,
  summary   TEXT NOT NULL,          -- JSON, core/keys.ts KeySummary
  PRIMARY KEY (env, instance)
);

CREATE TABLE resource_keys (
  env          TEXT NOT NULL,
  instance     TEXT NOT NULL,
  db_index     INTEGER NOT NULL,
  key_template TEXT NOT NULL,
  service      TEXT NOT NULL,
  access       TEXT NOT NULL CHECK (access IN ('read', 'write', 'read_write')),
  commands     TEXT NOT NULL,       -- JSON array of command names
  ops_per_hour REAL,
  ttl_seconds  INTEGER,
  PRIMARY KEY (env, instance, db_index, key_template, service)
);
CREATE INDEX resource_keys_db ON resource_keys (env, instance, db_index);
