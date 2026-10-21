// The flow-relation edit form as ops (0.28.2): `{kind: 'flow-relation', from, to, type, note?, id?}`. `id` is the relation being edited: a changed type or end moves it
// (its old row is deleted). Deleting is `{kind: 'delete', anchor: 'rel:<id>'}`. Pure; throws EditError.

import type { DraftOpInput } from './draft-ops.ts';
import { EditError, type DesignEdit } from './edit-kit.ts';
import { checkRelation, flowOf, relationItem } from './flow-relations.ts';
import type { ItemRow } from './item-rows.ts';

type Rel = Extract<DesignEdit, { kind: 'flow-relation' }>;

export function relationOps(e: Rel, rows: ItemRow[]): DraftOpInput[] {
  if (!flowOf(e.from)) throw new EditError('NO_FLOW', 'give the flow this relation starts from ({service, ingress})', 'from');
  if (!flowOf(e.to)) throw new EditError('NO_FLOW', 'give the other flow ({service, ingress})', 'to');
  const item = relationItem(e);
  if (!item) throw new EditError('BAD_TYPE', 'type must be one of contradicts, variant-of, supersedes, same-topic', 'type');
  const issue = checkRelation(item.id, item.data, rows)[0];
  if (issue) throw new EditError(issue.code, issue.message, issue.field);
  const ops: DraftOpInput[] = [{ op: 'upsert', anchor: `rel:${item.id}`, data: item.data }];
  if (e.id && e.id !== item.id) {
    if (!rows.some((r) => r.list === 'flowrel' && r.key === e.id)) throw new EditError('NO_ITEM', `'rel:${e.id}' does not exist in this design`, 'id');
    ops.push({ op: 'delete', anchor: `rel:${e.id}` });
  }
  return ops;
}

/** Deletes of the relations that name a component (`service` only) or one endpoint's flow. */
export function dependentRelationOps(rows: ItemRow[], service: string, ingress?: string): DraftOpInput[] {
  const names = (x: unknown) => { const f = flowOf(x); return !!f && f.service === service && (ingress === undefined || f.ingress === ingress); };
  return rows.filter((r) => r.list === 'flowrel' && (names(r.data?.from) || names(r.data?.to))).map((r) => ({ op: 'delete' as const, anchor: `rel:${r.key}` }));
}
