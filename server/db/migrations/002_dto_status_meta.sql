-- migrate: foreign_keys=off
-- DTOs for non-success responses (bug #23): `status` joins the primary key of endpoint_dtos
-- ('' = the success response; otherwise '404', '4xx', 'default', ...). Provenance: `meta` (JSON
-- {source: {repo, ref, file, line}, provenance, incomplete}) on endpoint and event DTOs.
-- SQLite cannot change a primary key in place, so endpoint_dtos is rebuilt.

CREATE TABLE endpoint_dtos_new (
  env        TEXT NOT NULL,
  service    TEXT NOT NULL,
  ingress    TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('request', 'response')),
  status     TEXT NOT NULL DEFAULT '',        -- response status; '' = the success response
  content    TEXT NOT NULL,
  meta       TEXT,                            -- JSON: {source, provenance, incomplete}
  updated_at TEXT NOT NULL,
  PRIMARY KEY (env, service, ingress, role, status),
  FOREIGN KEY (env, service) REFERENCES snapshots (env, service) ON DELETE CASCADE
);
INSERT INTO endpoint_dtos_new (env, service, ingress, role, content, updated_at)
  SELECT env, service, ingress, role, content, updated_at FROM endpoint_dtos;
DROP TABLE endpoint_dtos;
ALTER TABLE endpoint_dtos_new RENAME TO endpoint_dtos;

ALTER TABLE event_dtos ADD COLUMN meta TEXT;
