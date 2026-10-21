-- Drafts (0.23.0): a design environment is edited through a draft, a list of whole-item ops that read as an overlay on
-- the environment and are applied as one delta per touched service. Additive only: no table is rebuilt.
--   drafts       one per named piece of design work; status open -> applied | discarded
--   draft_ops    append-only: the last op per item wins; seq is MAX(seq)+1 inside the append transaction
--   flow_names   names of flows (written by an applied draft; the naming UI comes later)
--   changelog.draft_id   the draft whose apply wrote the row (NULL for everything else)
-- Postgres notes as 005: JSON is TEXT, times are ISO TEXT, no SQLite-only types.

CREATE TABLE drafts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  env        TEXT NOT NULL REFERENCES envs (name) ON DELETE CASCADE,
  slug       TEXT NOT NULL,                       -- in URLs and MCP: ?draft=<slug>
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'applied', 'discarded')),
  plan       TEXT,                                -- import plan (JSON) kept for review: mapping, questions, links
  report     TEXT,                                -- apply report (JSON): results, replaced, warnings
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  closed_at  TEXT, closed_by TEXT,
  UNIQUE (env, slug)
);

CREATE TABLE draft_ops (
  draft_id  INTEGER NOT NULL REFERENCES drafts (id) ON DELETE CASCADE,
  seq       INTEGER NOT NULL,                     -- MAX(seq)+1 inside the append transaction
  op        TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  anchor    TEXT NOT NULL,
  service   TEXT NOT NULL DEFAULT '', list TEXT NOT NULL, key TEXT NOT NULL,
  data      TEXT,                                 -- JSON, whole item (upsert only)
  base_hash TEXT,                                 -- hash of the env item when the draft first touched it; NULL = absent
  author    TEXT NOT NULL, by_ai INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL,
  PRIMARY KEY (draft_id, seq)
);
CREATE INDEX draft_ops_item ON draft_ops (draft_id, service, list, key);

CREATE TABLE flow_names (
  env        TEXT NOT NULL,
  service    TEXT NOT NULL,
  ingress    TEXT NOT NULL,
  name       TEXT NOT NULL,
  author     TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (env, service, ingress)
);

ALTER TABLE changelog ADD COLUMN draft_id INTEGER;
