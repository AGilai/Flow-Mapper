// What counts as "the same" for the diff: items are compared after dropping noise (provenance, code locations, versions,
// document references), with object keys sorted, so a re-harvest or a re-ordered JSON is no change.

import { hash53 } from '../description.ts';

/** JSON with object keys sorted at every depth (array order is kept). */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

const NOISE = new Set(['service', 'provenance', 'source']);
const HEADER_DROP = new Set(['name', 'version', 'harvestedAt', 'commit', 'groupPath', 'details']);

/** Drop `service`, `provenance`, `source` and `details.doc` at any depth (and `seq` of steps when asked). */
function strip(v: unknown, parent = '', seq = false): unknown {
  if (Array.isArray(v)) return v.map((x) => strip(x, parent, seq));
  if (!v || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (NOISE.has(k) || (k === 'doc' && parent === 'details') || (seq && k === 'seq')) continue;
    const v2 = strip(x, k, seq);
    if (k === 'details' && v2 && typeof v2 === 'object' && !Array.isArray(v2) && !Object.keys(v2).length) continue; // details that held only `doc`
    out[k] = v2;
  }
  return out;
}

/** The comparable form of one item of `list` (ItemRow list names, plus 'step'). */
export function normItem(list: string, data: any): unknown {
  switch (list) {
    case 'dto': case 'event_dto': return { content: data?.content };
    case 'schema': case 'flow': return data;
    case 'subsystem': { const { order: _o, ...rest } = data ?? {}; return rest; }   // reordering is not a design change
    case 'link': case 'flowrel': return Object.fromEntries(Object.entries(data ?? {}).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length)));
    case 'header': return strip(Object.fromEntries(Object.entries(data ?? {}).filter(([k]) => !HEADER_DROP.has(k))));
    case 'functions': case 'step': return strip(data, '', true);
    default: return strip(data);
  }
}

export const same = (list: string, a: unknown, b: unknown) => stableJson(normItem(list, a)) === stableJson(normItem(list, b));

/** Hash of an item as stored (for "has it changed since the draft touched it"): key order is irrelevant; a header's version, harvestedAt and commit are not part of it. */
export function rawHash(data: unknown, list = ''): string {
  if (list === 'header' && data && typeof data === 'object') {
    const { version: _v, harvestedAt: _h, commit: _c, ...rest } = data as any;
    return hash53(stableJson(rest));
  }
  return hash53(stableJson(data));
}
