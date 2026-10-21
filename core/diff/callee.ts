// The callee of a new call, for the phrase `+1 call: <callee>`. Shared by the server's marks and the static preview.

import type { ItemRow } from '../item-rows.ts';
import type { DiffOpts } from './index.ts';

/** The target of a call, for the phrase `+1 call: <callee>`: the one component whose endpoint has the call's bind key (exact keys; the graph resolves patterns and channels, marks do not need it). */
export function calleeIndex(rows: ItemRow[]): DiffOpts['calleeOf'] {
  let byKey: Map<string, Set<string>> | undefined, egress: Map<string, string> | undefined;
  return (service, id) => {
    if (!byKey) {
      byKey = new Map(); egress = new Map();
      for (const r of rows) {
        if (r.list === 'ingress' && r.data?.bindKey && (!r.data.match || r.data.match === 'exact')) byKey.set(r.data.bindKey, (byKey.get(r.data.bindKey) ?? new Set()).add(r.service));
        else if (r.list === 'egress' && r.data?.bindKey) egress.set(`${r.service}\u0000${r.key}`, r.data.bindKey);
      }
    }
    const to = byKey.get(egress!.get(`${service}\u0000${id}`) ?? '');
    return to && to.size === 1 ? [...to][0] : undefined;
  };
}
