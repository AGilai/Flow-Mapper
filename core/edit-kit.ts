// What every edit form builder shares: the DesignEdit union (the UI form, REST, MCP and the preview all send it as is), the error
// the builders throw, and a small index over the rows being edited (the draft's overlay).

import type { Mode, Transport } from './types.ts';
import type { Links } from './links.ts';
import { rowId, type ItemRow } from './item-rows.ts';

export type EndpointEdit = {
  service: string; id?: string; transport: Transport; bindKey?: string; handler?: string; entryPoint?: boolean | null;
  events?: { type: string; handler?: string }[]; description?: string; links?: Links | null;
};
export type CallEdit = {
  kind: 'call'; from: { service: string; fn: string }; before?: number;          // insert before this step seq (default: last)
  to: { service: string; ingress: string } | { endpoint: EndpointEdit } | { bindKey: string; transport: Transport };   // existing | new endpoint | not designed yet
  edit?: { egress: string; seq: number };                                          // replace this existing call
  mode?: Mode; operation?: string; condition?: string; event?: string; description?: string; note?: string;   // note: the step's own text (what the trace shows as its note)
};
export type DeleteCallEdit = { kind: 'delete-call'; service: string; fn: string; seq: number };
export type DesignEdit =
  | { kind: 'component'; name: string; serviceKind: 'service' | 'gateway' | 'lambda' | 'infra' | 'client-app'; groupPath?: string; team?: string; description?: string; links?: Links | null; runtime?: 'k8s-pod' | 'k8s-deployment' | 'k8s-daemonset' | 'k8s-operator' | 'k8s-job' | null }
  | { kind: 'function'; service: string; id: string; links?: Links | null }
  | ({ kind: 'endpoint' } & EndpointEdit)
  | CallEdit
  | DeleteCallEdit
  | { kind: 'flow'; service: string; ingress: string; name?: string; description?: string; links?: Links | null; entryPoint?: boolean | null; order?: { fn: string; seqs: number[] } }
  | { kind: 'dto'; service: string; ingress: string; role: 'request' | 'response'; status?: string; content: unknown }
  | { kind: 'event-dto'; type: string; content: unknown }
  | { kind: 'delete'; anchor: string };

export class EditError extends Error {
  code: string; field?: string;
  constructor(code: string, message: string, field?: string) { super(message); this.code = code; this.field = field; }
}

export interface Idx {
  get(service: string, list: string, key?: string): ItemRow | undefined;
  list(service: string, list: string): ItemRow[];
}
export function indexRows(rows: ItemRow[]): Idx {
  const map = new Map(rows.map((r) => [rowId(r), r]));
  return { get: (service, list, key = '') => map.get(rowId({ service, list, key })), list: (service, list) => rows.filter((r) => r.service === service && r.list === list) };
}

export const slug = (s: string) => s.replace(/[{}]/g, '').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'x';
/** `base`, or `base-2`, `base-3`... when taken. */
export function unique(base: string, taken: Set<string>): string {
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}
/** A field of an edit: undefined keeps the old value, '' removes it, anything else sets it. */
export function setField(data: Record<string, any>, key: string, v: unknown) {
  if (v === undefined) return;
  if (v === '' || v === null) delete data[key]; else data[key] = v;
}
/** Steps in seq order, renumbered 1..n. */
export const renumber = (steps: any[]) => steps.map((s, i) => ({ ...s, seq: i + 1 }));
