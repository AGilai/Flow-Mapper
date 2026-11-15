-- Accounts, ownership and sharing (0.52.0, AWS v1 part C). Spec: docs/plans/aws-v1.md section 3. Additive only.
-- envs.owner_user_id NULL = no owner: every design that exists before this migration stays visible to everyone (visibility 'published' is the column default,
-- so nothing disappears after the upgrade); only an admin edits an ownerless design until one is given an owner (PUT /api/envs/:env/access).
-- New design envs are written with visibility 'private' by the server. Sealed (harvested) envs ignore both columns: everyone signed in reads them.
-- drafts.visibility: existing drafts stay 'shared' (readable by the env's editors); new drafts start 'private' to their author.
-- Cognito identities live in user_external_ids (source 'cognito', external_id = the `sub` claim); users.email comes from the ID token.
-- api_tokens keeps the SHA-256 hash only (the token itself is shown once). sessions keeps the SHA-256 of the random session id.
-- app_secrets holds the cookie-signing key, generated once per database.

ALTER TABLE envs ADD COLUMN owner_user_id TEXT;
ALTER TABLE envs ADD COLUMN visibility TEXT NOT NULL DEFAULT 'published';

CREATE TABLE env_members (
  env     TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role    TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  PRIMARY KEY (env, user_id)
);
CREATE INDEX idx_env_members_user ON env_members (user_id);

ALTER TABLE drafts ADD COLUMN owner_user_id TEXT;
ALTER TABLE drafts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'shared';

ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email TEXT;

ALTER TABLE changelog ADD COLUMN user_id TEXT;

CREATE TABLE api_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  scope        TEXT NOT NULL DEFAULT 'user' CHECK (scope IN ('user', 'harvester')),
  hash         TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT,
  expires_at   TEXT  -- NULL = never; an expired token answers 401 TOKEN_EXPIRED
);
CREATE INDEX idx_api_tokens_user ON api_tokens (user_id);

CREATE TABLE sessions (
  id_hash      TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  csrf         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions (user_id);

CREATE TABLE app_secrets (
  name  TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
