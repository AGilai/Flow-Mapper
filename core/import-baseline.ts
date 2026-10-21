// The baseline of imported items. An import op carries its origin; until the draft is applied the baseline of what it brought
// lives on the ops (so undo, revert, a deleted service and the preview all work with no cleanup), and apply copies it into
// baseline_items. Pure: the server passes the draft's ops and the ids of the rows the draft's environment has (or would have).

import type { DraftOp } from './draft-ops.ts';
import { rowId } from './item-rows.ts';

export interface OriginRow { service: string; list: string; key: string; data: any; sourceEnv: string; sourceVersion: number | null; takenAt: string }

/**
 * Ops with an `origin`, in seq order: the last one per item wins; a `delete svc:<s>` drops the earlier entries of s. An item is
 * kept only when it is in `present` (imported, then deleted in the draft: nothing, so no Removed mark). A header's row is the
 * data without `groupPath`, as a copy writes it (the subsystem is the design's own).
 */
export function importBaseline(ops: DraftOp[], present: Set<string>): OriginRow[] {
  const out = new Map<string, OriginRow>();
  for (const o of [...ops].sort((a, b) => a.seq - b.seq)) {
    if (o.op === 'delete' && o.list === 'header') { for (const [k, r] of out) if (r.service === o.service) out.delete(k); continue; }
    if (!o.origin || o.op !== 'upsert') continue;
    const { groupPath: _g, ...bare } = (o.data ?? {}) as Record<string, unknown>;
    out.set(rowId(o), { service: o.service, list: o.list, key: o.key, data: o.list === 'header' ? bare : o.data, sourceEnv: o.origin.env, sourceVersion: o.origin.version, takenAt: o.at });
  }
  return [...out.values()].filter((r) => present.has(rowId(r)));
}
