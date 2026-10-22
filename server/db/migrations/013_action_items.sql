-- Action items under each flow (0.29.0): a small table of owner / description / status / due per anchor, linked to comments, not a comment type.
-- Additive: two new tables and two indexes; no existing table is touched.
-- `anchor` is a core/anchors.ts anchor (today always flow:<service>/<ingress>). `number` is per (env, anchor) and never reused: the next one is
-- max(number)+1 over every row, soft-deleted ones included. `step` is a step key (core/description.ts). `comment_id` is the comment the item was
-- made from (same anchor); no foreign key, so deleting that comment keeps the item. `source` is 'human' or 'ai' (MCP writes 'ai').
-- A delete is soft (deleted_at). `action_item_events` is what the comment thread shows under the source comment: created, closed, reopened, dropped.
-- No foreign key to envs or snapshots: a re-harvest must not drop an item. Postgres notes as 005: times are ISO TEXT; AUTOINCREMENT becomes GENERATED ... AS IDENTITY.

CREATE TABLE action_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  env         TEXT NOT NULL,
  anchor      TEXT NOT NULL,
  number      INTEGER NOT NULL,
  owner       TEXT NOT NULL,
  description TEXT NOT NULL,
  status      TEXT NOT NULL,
  due         TEXT,
  step        TEXT,
  comment_id  INTEGER,
  source      TEXT NOT NULL DEFAULT 'human',
  created_by  TEXT NOT NULL,
  updated_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  closed_at   TEXT,
  deleted_at  TEXT,
  UNIQUE (env, anchor, number)
);

CREATE INDEX idx_action_items_anchor ON action_items (env, anchor, number);

CREATE TABLE action_item_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  kind    TEXT NOT NULL,
  actor   TEXT NOT NULL,
  at      TEXT NOT NULL
);

CREATE INDEX idx_action_item_events_item ON action_item_events (item_id);
