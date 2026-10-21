// `links` and `runtime` in the edit forms (0.25.1, #54, #49). A form's `links`: absent keeps what the item has, null or {} removes it,
// anything else replaces it whole (checked: http(s) URLs, label <= 120 characters, at most 20 sub links).

import type { DraftOpInput } from './draft-ops.ts';
import { EditError, type DesignEdit, type Idx } from './edit-kit.ts';
import { checkLinks, cleanLinks, RUNTIMES, type Links } from './links.ts';

/** Set (or remove) `links` on an item's data. */
export function setLinks(data: Record<string, any>, v: Links | null | undefined) {
  if (v === undefined) return;
  const bad = v === null ? null : checkLinks(v);
  if (bad) throw new EditError('INVALID', bad, 'links');
  const clean = v === null ? undefined : cleanLinks(v);
  if (clean) data.links = clean; else delete data.links;
}

/** `details.runtime` of a component: one of the k8s kinds; null or '' removes it. */
export function setRuntime(data: Record<string, any>, v: string | null | undefined) {
  if (v === undefined) return;
  if (v !== null && v !== '' && !(RUNTIMES as readonly string[]).includes(v)) throw new EditError('INVALID', `runtime must be one of ${RUNTIMES.join(', ')}`, 'runtime');
  const details = { ...(data.details ?? {}) };
  if (v === null || v === '') delete details.runtime; else details.runtime = v;
  if (Object.keys(details).length) data.details = details; else delete data.details;
}

/** The `links` of an existing function. */
export function functionOps(e: Extract<DesignEdit, { kind: 'function' }>, x: Idx): DraftOpInput[] {
  const f = x.get(e.service, 'functions', e.id);
  if (!f) throw new EditError('NO_ITEM', `function '${e.id}' of '${e.service}' does not exist in this design`, 'id');
  const data = { ...f.data };
  setLinks(data, e.links);
  return [{ op: 'upsert', anchor: `fn:${e.service}/${e.id}`, data }];
}
