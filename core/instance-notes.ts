// Small readers of the resources of one Redis instance: details, what the infra harvester could not read (`unresolved`
// what=detail) and what it filled by a rule (`assumed`, #47). Pure; used by instances.ts.

import { assumedFor } from './assumed.ts';
import type { Resource } from './types.ts';

export const asNum = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
export const det = (xs: Resource[], k: string) => xs.map((r) => (r.details as any)?.[k]).find((v) => v != null);
/** Entries of `unresolved` what=detail on these resources whose detail path starts with `prefix`; `field` is the path after a trailing-dot prefix. */
export const unknownOf = (rs: Resource[], prefix: string) => rs.flatMap((r) => (r.unresolved ?? []).filter((u) => u.what === 'detail' && u.detail?.trim().startsWith(prefix)).map((u) => ({ field: u.detail!.trim().slice(prefix.endsWith('.') ? prefix.length : 0), reason: u.reason })));
/** The first assumed entry for a field path on these resources. */
export const assumedAt = (rs: Resource[], path: string) => rs.map((r) => assumedFor(r.assumed, path)).find(Boolean);
export const nameOf = (key: string) => key.slice(key.indexOf(':') + 1);
