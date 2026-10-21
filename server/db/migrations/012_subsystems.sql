-- 0.28.0 phase 3. Additive: two tables, one column; nothing is rebuilt. JSON is TEXT, times ISO TEXT (as 005).
--   envs.groups (unchanged column) keeps the subsystem settings: [{key, label, icon?}] in display order.
--   envs.baseline_groups: the subsystems a design started with (its baseline for grp: marks), frozen at copy time.
--     Existing designs take their current groups (they were chosen at creation and never edited before 0.28).
ALTER TABLE envs ADD COLUMN baseline_groups TEXT;
UPDATE envs SET baseline_groups = groups WHERE kind = 'design';

-- Links drawn at subsystem level (anchor link:<id>), written by an applied draft. Ends are anchors (grp:, svc:, egr:, ing:).
CREATE TABLE abstract_links (
  env         TEXT NOT NULL,
  id          TEXT NOT NULL,
  name        TEXT NOT NULL,
  from_ref    TEXT NOT NULL,
  to_ref      TEXT NOT NULL,
  mode        TEXT CHECK (mode IS NULL OR mode IN ('sync', 'async')),
  transport   TEXT,                                   -- NULL = not decided
  description TEXT,
  doc         TEXT,                                   -- JSON provenance from a plan
  refined_by  TEXT NOT NULL DEFAULT '[]',             -- JSON [{service, egress}]
  author      TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (env, id)
);

-- Typed links between two flows of one environment (anchor rel:<id>; used from 0.28.2, #50).
CREATE TABLE flow_relations (
  env          TEXT NOT NULL,
  id           TEXT NOT NULL,                         -- 'r' + hash of from|to|type (core/flow-relations.ts)
  from_service TEXT NOT NULL, from_ingress TEXT NOT NULL,
  to_service   TEXT NOT NULL, to_ingress   TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('contradicts', 'variant-of', 'supersedes', 'same-topic')),
  note         TEXT,
  author       TEXT,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (env, id)
);
CREATE INDEX flow_relations_from ON flow_relations (env, from_service, from_ingress);
CREATE INDEX flow_relations_to   ON flow_relations (env, to_service, to_ingress);
