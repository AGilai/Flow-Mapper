-- 019: indexes for the read paths measured in docs/plans/perf-review.md (1,000 services x 10 envs, 55k comments).
-- Plain CREATE INDEX statements only (partial indexes are valid PostgreSQL too); no table rebuild, no data change.

-- Env counts (envs.ts countsOf: "SELECT list, count(*) FROM entities WHERE env = ? GROUP BY list"): a small covering index
-- instead of walking the wide (env, service, list, key) primary key with a temp b-tree.
CREATE INDEX idx_entities_env_list ON entities (env, list);

-- ensureColors: "SELECT service, kind FROM snapshots WHERE env = ? ORDER BY rowid" (SQLite orders a one-column index by rowid,
-- so this drops the temp b-tree; on PostgreSQL it is a plain env index).
CREATE INDEX idx_snapshots_env ON snapshots (env);

-- Changelog page without a service: "WHERE env = ? ORDER BY id DESC LIMIT ?" (today: every row of the env, then a sort).
CREATE INDEX idx_changelog_env_id ON changelog (env, id);

-- Flows list counts: open top comments and open action items per anchor (covering, only the rows that count).
CREATE INDEX idx_comments_open_top ON comments (env, anchor) WHERE parent_id IS NULL AND deleted_at IS NULL AND resolved_at IS NULL;
CREATE INDEX idx_action_items_open ON action_items (env, anchor) WHERE deleted_at IS NULL AND status IN ('open', 'progress');

-- Users page counts (users.ts userCounts): GROUP BY author / owner without a full scan and temp b-tree.
CREATE INDEX idx_comments_author ON comments (author_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_action_items_owner ON action_items (owner_id) WHERE deleted_at IS NULL;

-- Bugs of a service (service view): "bug_links WHERE service = ? OR (type = 'service' AND ref_id = ?)" scans bug_links today.
CREATE INDEX idx_bug_links_service ON bug_links (service);
CREATE INDEX idx_bug_links_ref ON bug_links (type, ref_id);
