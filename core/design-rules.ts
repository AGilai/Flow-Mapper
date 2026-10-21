// Rules a design's ops must satisfy beyond the item schemas, checked after a whole request is laid over the rows (like the schema check):
//   NO_TARGET  a step with a `target` in a function the request upserts must name a function / egress / resource of that service
//   NO_GROUP   a component header's groupPath must be '' or one of the environment's subsystems
//   BAD_KIND   (checked per op) a component kind must be one of SERVICE_KINDS

import { rowId, type ItemRow } from './item-rows.ts';

export const SERVICE_KINDS = ['service', 'gateway', 'lambda', 'infra', 'client-app'] as const;
const WHAT: Record<string, string> = { call: 'functions', egress: 'egress', resource: 'resources' };

export interface Issue { index: number; code: string; message: string }

/** `after`: the rows with the whole request applied; `touched`: the request's upserts (index in the request, item name). */
export function designIssues(after: Map<string, ItemRow>, touched: { index: number; service: string; list: string; key: string }[], groups: string[] | undefined): Issue[] {
  const out: Issue[] = [];
  for (const t of touched) {
    const row = after.get(rowId(t));
    if (!row) continue;
    if (t.list === 'functions') {
      for (const st of row.data?.steps ?? []) {
        const list = WHAT[st.type];
        if (st.target && list && !after.has(rowId({ service: t.service, list, key: st.target }))) {
          out.push({ index: t.index, code: 'NO_TARGET', message: `step ${st.seq} of ${t.service}/${t.key} targets '${st.target}', which is not ${list === 'egress' ? 'an egress' : list === 'functions' ? 'a function' : 'a resource'} of ${t.service}` });
        }
      }
    } else if (t.list === 'header' && groups) {
      const g = row.data?.groupPath;
      if (g !== undefined && g !== '' && !groups.includes(g)) out.push({ index: t.index, code: 'NO_GROUP', message: `groupPath '${g}' of ${t.service} is not one of the environment's subsystems (${groups.join(', ') || 'none'})` });
    }
  }
  return out;
}
