-- Push event stream (E1). Persisted so a client can resume with Last-Event-ID after a server restart.
-- Pruned on insert (7 days / 5000 rows). AUTOINCREMENT keeps ids increasing even after pruning.
-- (006 is reserved for design-env drafts.)
CREATE TABLE events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  type     TEXT NOT NULL,
  at       TEXT NOT NULL,
  env      TEXT,
  bug_id   INTEGER,
  reporter TEXT,
  summary  TEXT NOT NULL,
  data     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_events_at ON events (at);

CREATE TABLE event_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
