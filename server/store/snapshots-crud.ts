// Removing a service. Since 0.25.0 nothing edits a service or an entity by hand (harvesters ingest; a design is edited through a draft),
// so the only writer left here is the one a draft's apply uses.

import type { DB } from '../db/connection.ts';
import { notFound } from '../errors.ts';
import { getSnapshotRow, type Source } from './snapshots-read.ts';
import { writeChangelog } from './snapshots-write.ts';

/** Remove a service and (by foreign key cascade) its entities and DTOs. Unguarded: the caller is a draft's apply (which is the guard). */
export function deleteServiceIn(db: DB, env: string, name: string, source: Source = 'api', draftId?: number) {
  const cur = getSnapshotRow(db, env, name);
  if (!cur) throw notFound(`service '${name}' in env '${env}'`);
  db.prepare('DELETE FROM snapshots WHERE env = ? AND service = ?').run(env, name);
  writeChangelog(db, env, name, cur.version, null, 'delete-service', source, {}, draftId);
  return { deleted: name };
}
