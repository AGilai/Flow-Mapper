-- One row per service per environment: the header of the latest manifest.
CREATE TABLE snapshots (
  env          TEXT NOT NULL,
  service      TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'service',
  meta         TEXT NOT NULL DEFAULT '{}',   -- team, repo, language, description, tags
  version      INTEGER NOT NULL,
  harvested_at TEXT NOT NULL,
  commit_sha   TEXT,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (env, service)
);

-- All harvested entities, one table. `list` is functions | ingress | egress | resources | channels | bindings.
-- `key` is the stable ID (bindKey for channels). `data` is the manifest object as JSON.
CREATE TABLE entities (
  env     TEXT NOT NULL,
  service TEXT NOT NULL,
  list    TEXT NOT NULL,
  key     TEXT NOT NULL,
  data    TEXT NOT NULL,
  PRIMARY KEY (env, service, list, key),
  FOREIGN KEY (env, service) REFERENCES snapshots (env, service) ON DELETE CASCADE
);

CREATE TABLE changelog (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  env          TEXT NOT NULL,
  service      TEXT NOT NULL,
  from_version INTEGER,
  to_version   INTEGER,
  kind         TEXT NOT NULL,                -- full | delta | crud | delete-service
  source       TEXT NOT NULL DEFAULT 'api',  -- api | ui | mcp | seed
  at           TEXT NOT NULL,
  changes      TEXT NOT NULL                 -- {added:{list:[key]}, changed:{…}, removed:{…}}
);
CREATE INDEX changelog_service ON changelog (env, service, id);

CREATE TABLE health_history (
  env      TEXT NOT NULL,
  service  TEXT NOT NULL,
  version  INTEGER NOT NULL,
  at       TEXT NOT NULL,
  egress   INTEGER NOT NULL,
  dangling INTEGER NOT NULL,
  orphans  INTEGER NOT NULL,
  unbound  INTEGER NOT NULL,
  PRIMARY KEY (env, service, version)
);

CREATE TABLE bugs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  steps             TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'open',
  severity          TEXT NOT NULL DEFAULT 'S3',
  priority          TEXT NOT NULL,
  priority_override INTEGER NOT NULL DEFAULT 0,
  impact            INTEGER NOT NULL DEFAULT 0,
  app_version       TEXT NOT NULL,
  fixed_in_version  TEXT,
  env               TEXT NOT NULL DEFAULT 'default',
  reporter          TEXT NOT NULL DEFAULT 'anonymous',
  assignee          TEXT,
  channel           TEXT NOT NULL DEFAULT 'api',   -- api | web | mcp
  resolution        TEXT,                          -- JSON {type: code|map-data|config|none, ref, note}
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX bugs_status ON bugs (status, priority);

CREATE TABLE bug_links (
  bug_id  INTEGER NOT NULL REFERENCES bugs (id) ON DELETE CASCADE,
  type    TEXT NOT NULL,
  service TEXT,
  ref_id  TEXT NOT NULL,
  PRIMARY KEY (bug_id, type, service, ref_id)
);

CREATE TABLE bug_attachments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bug_id       INTEGER NOT NULL REFERENCES bugs (id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  path         TEXT NOT NULL,
  suggestions  TEXT NOT NULL DEFAULT '[]',
  uploaded_at  TEXT NOT NULL
);

CREATE TABLE bug_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  bug_id     INTEGER NOT NULL REFERENCES bugs (id) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
