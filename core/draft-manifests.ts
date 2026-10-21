// Net ops -> harvester manifests. Per touched service: a full manifest (version 1) for a new one, a delta (version +1, base =
// the current version) for an existing one, a full manifest at version +1 for one the draft deleted and created again.
// DTO / event DTO / schema / flow ops are not part of manifests: they go to `side`. A service delete goes to `deletes`.

import { ENTITY_LISTS, rowId, type ItemRow } from './item-rows.ts';
import type { NetOp } from './draft-ops.ts';
import { stableJson } from './diff/normalise.ts';

const SIDE = new Set(['dto', 'event_dto', 'schema', 'flow']);
const VOLATILE = ['version', 'harvestedAt', 'commit'];
const header = (name: string, data: any) => ({ name, ...Object.fromEntries(Object.entries(data ?? {}).filter(([k]) => !VOLATILE.includes(k))) });

export interface DraftManifests { manifests: any[]; replaceHeader: Set<string>; deletes: string[]; side: NetOp[] }

export function draftManifests(net: NetOp[], envRows: ItemRow[], at: string, env: string): DraftManifests {
  const envMap = new Map(envRows.map((r) => [rowId(r), r]));
  const out: DraftManifests = { manifests: [], replaceHeader: new Set(), deletes: [], side: [] };
  const byService = new Map<string, NetOp[]>();
  for (const o of net) {
    if (SIDE.has(o.list)) { const e = envMap.get(rowId(o)); if (o.op === 'delete' ? e : !e || stableJson(e.data) !== stableJson(o.data)) out.side.push(o); continue; }
    byService.set(o.service, [...(byService.get(o.service) ?? []), o]);
  }
  for (const [service, ops] of byService) {
    const envHeader = envMap.get(rowId({ service, list: 'header', key: '' }));
    const del = ops.find((o) => o.list === 'header' && o.op === 'delete');
    const head = [...ops].reverse().find((o) => o.list === 'header' && o.op === 'upsert');
    const upserts = ops.filter((o) => o.op === 'upsert' && (ENTITY_LISTS as readonly string[]).includes(o.list));
    const base = { schemaVersion: '1.0', env, harvestedAt: at };
    if (del && !head) { if (envHeader) out.deletes.push(service); continue; }
    const lists = (xs: NetOp[]) => Object.fromEntries(ENTITY_LISTS.map((l) => [l, xs.filter((o) => o.list === l).map((o) => o.data)]).filter(([, v]) => (v as any[]).length));
    if (!envHeader || del) {
      if (!head) continue;
      out.manifests.push({ ...base, kind: 'full', version: (envHeader?.data?.version ?? 0) + 1, service: header(service, head.data), ...lists(upserts) });
      continue;
    }
    const changed = (o: NetOp) => { const e = envMap.get(rowId(o)); return o.op === 'delete' ? !!e : !e || stableJson(e.data) !== stableJson(o.data); };
    const ups = upserts.filter(changed), dels = ops.filter((o) => o.op === 'delete' && o.list !== 'header' && changed(o));
    const headChanged = head && stableJson(header(service, head.data)) !== stableJson(header(service, envHeader.data));
    if (!ups.length && !dels.length && !headChanged) continue;
    if (headChanged) out.replaceHeader.add(service);
    const delete_ = Object.fromEntries(ENTITY_LISTS.map((l) => [l, dels.filter((o) => o.list === l).map((o) => o.key)]).filter(([, v]) => (v as any[]).length));
    out.manifests.push({ ...base, kind: 'delta', baseVersion: envHeader.data.version, version: envHeader.data.version + 1, service: header(service, headChanged ? head!.data : envHeader.data),
      ...(ups.length ? { upsert: lists(ups) } : {}), ...(dels.length ? { delete: delete_ } : {}) });
  }
  return out;
}
