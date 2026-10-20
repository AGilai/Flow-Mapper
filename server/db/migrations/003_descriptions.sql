-- Flow descriptions (0.14.0). Two records per key, one per source: 'human' (written through REST / the UI) and
-- 'ai' (written only by the MCP tool set_description). Key: env + service + ingress (the whole flow, callee = '')
-- plus callee (a service, or "service:handler" for one delivery) for a sub-flow. The AI record keeps the model
-- and the hash of the trace it was written from, so the UI can flag it outdated when the trace has changed.
-- No foreign key to snapshots: a re-harvest must not drop a note; a description of a vanished flow is simply not read.

CREATE TABLE descriptions (
  env        TEXT NOT NULL,
  service    TEXT NOT NULL,
  ingress    TEXT NOT NULL,
  callee     TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL CHECK (source IN ('human', 'ai')),
  text       TEXT NOT NULL,
  author     TEXT,            -- human: who edited
  model      TEXT,            -- ai: model name
  trace_hash TEXT,            -- ai: hash of the trace it was generated from
  updated_at TEXT NOT NULL,
  PRIMARY KEY (env, service, ingress, callee, source)
);
