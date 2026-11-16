// Whole-environment transfer: which tables travel, and how their ids are re-keyed on import.
// Every table of the schema has a decision here (tests/env-transfer.test.ts checks that no table with an `env` column is missing).
//
// EXPORTED (direct, `env` column):
//   snapshots entities health_history endpoint_dtos event_dtos store_schemas descriptions resource_keys_meta resource_keys baseline_items
//   flow_names flow_links abstract_links flow_relations   natural keys only, copied as they are
//   changelog      history of edits; autoincrement id is re-keyed; draft_id follows the drafts map; user_id is dropped (instance-local)
//   drafts         autoincrement id re-keyed; owner_user_id becomes the importer
//   comments       id re-keyed, parent_id follows the map; author_id mapped by user name
//   action_items   id re-keyed, comment_id follows the comments map; owner_id / created_by_id mapped by user name
//   flow_notes     id re-keyed, restored_from follows the map; author_id mapped by user name
// EXPORTED (child tables, reached through a parent):
//   draft_ops (draft_id -> drafts), action_item_events (item_id -> action_items), comment_mentions (comment_id -> comments, user_id mapped; dropped when the user is unknown)
// SKIPPED:
//   bugs bug_links bug_attachments bug_comments  tracker data of the instance, not design (bugs.env is a free label)
//   env_members          people of the source instance; the importer owns the copy
//   events event_state   push-event stream, pruned, instance-local
//   mention_seen         per-user read state of the source instance
//   users user_external_ids user_aliases api_tokens sessions app_secrets schema_migrations   accounts and instance state

export interface TableSpec {
  table: string;
  /** Child tables name the parent column and table they hang on (direct tables hold `env`). */
  parent?: { col: string; table: string };
  /** Table has an INTEGER AUTOINCREMENT `id` that is re-keyed (old id -> new id map). */
  auto?: boolean;
  /** column -> table whose id map rewrites it (may be the table itself: fixed after the inserts). */
  refs?: Record<string, string>;
  /** Columns holding a user id: mapped by name to a user of the target, else null. */
  users?: string[];
  /** Columns set to null (ids that mean nothing on another instance). */
  nulls?: string[];
  /** Columns set to the importing user. */
  owner?: string[];
}

// Order matters: a table comes after every table its refs point to (self refs are fixed after the inserts).
export const SPECS: TableSpec[] = [
  { table: 'snapshots' }, { table: 'entities' }, { table: 'health_history' }, { table: 'endpoint_dtos' }, { table: 'event_dtos' }, { table: 'store_schemas' },
  { table: 'descriptions' }, { table: 'resource_keys_meta' }, { table: 'resource_keys' }, { table: 'baseline_items' },
  { table: 'flow_names' }, { table: 'flow_links' }, { table: 'abstract_links' }, { table: 'flow_relations' },
  { table: 'drafts', auto: true, owner: ['owner_user_id'] },
  { table: 'draft_ops', parent: { col: 'draft_id', table: 'drafts' } },
  { table: 'changelog', auto: true, refs: { draft_id: 'drafts' }, nulls: ['user_id'] },
  { table: 'comments', auto: true, refs: { parent_id: 'comments' }, users: ['author_id'] },
  { table: 'comment_mentions', parent: { col: 'comment_id', table: 'comments' }, users: ['user_id'] },
  { table: 'action_items', auto: true, refs: { comment_id: 'comments' }, users: ['owner_id', 'created_by_id'] },
  { table: 'action_item_events', auto: true, parent: { col: 'item_id', table: 'action_items' } },
  { table: 'flow_notes', auto: true, refs: { restored_from: 'flow_notes' }, users: ['author_id'] },
];

/** Tables with an `env` column that are skipped on purpose (see above). */
export const SKIPPED_WITH_ENV = ['bugs', 'env_members', 'events'];
