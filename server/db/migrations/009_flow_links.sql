-- Links of a flow (0.25.1, #54): {main?: {label, url}, sub?: [{label, url}]}, next to the flow's name. Additive only: one new table,
-- no table is rebuilt. Links of components, endpoints and functions live in their item rows (`links` field), so they need no column.
-- Postgres notes as 005: JSON is TEXT, times are ISO TEXT.

CREATE TABLE flow_links (
  env        TEXT NOT NULL,
  service    TEXT NOT NULL,
  ingress    TEXT NOT NULL,
  links      TEXT NOT NULL,                       -- JSON
  author     TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (env, service, ingress)
);
