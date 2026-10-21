// One side of a comparison (a baseline, a source's current rows, an environment with or without a draft) indexed for the diff.

import { rowId, type ItemRow } from '../item-rows.ts';

export interface Side {
  rows: Map<string, ItemRow>;                    // rowId -> row
  services: Set<string>;                         // services with a header row
  ownerOfChannel: Map<string, string>;           // channel bindKey -> service that declares it
  producers: Map<string, string[]>;              // event type -> services whose egress lists it in `events`
  storeUsers: Map<string, string[]>;             // store bind key -> services with a resource on it
}

const push = (m: Map<string, string[]>, k: string, v: string) => { const a = m.get(k); if (!a) m.set(k, [v]); else if (!a.includes(v)) a.push(v); };

export function sideOf(rows: ItemRow[]): Side {
  const s: Side = { rows: new Map(), services: new Set(), ownerOfChannel: new Map(), producers: new Map(), storeUsers: new Map() };
  for (const r of rows) {
    s.rows.set(rowId(r), r);
    if (r.list === 'header') s.services.add(r.service);
    else if (r.list === 'channels' && !s.ownerOfChannel.has(r.key)) s.ownerOfChannel.set(r.key, r.service);
    else if (r.list === 'egress') for (const t of r.data?.events ?? []) push(s.producers, String(t), r.service);
    else if (r.list === 'resources' && r.data?.bindKey) push(s.storeUsers, r.data.bindKey, r.service);
  }
  return s;
}
