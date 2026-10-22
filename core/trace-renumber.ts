// Renumbering after a view dropped or folded messages (0.37.1, #82), pure. The numbers trace() stamps are positions in the full list:
// `n` (a message that starts deferred work, 1-based), `of` (the `n` of the work a message belongs to), `repeatOf` (the `n`-like 1-based
// number of the first expansion, also written in the label as "↩ seen at step N"), `group` (`m<0-based index of the publish>`),
// `delivery` ordinals and `deliveries` (#73, #43). `flow-scan.js` / `flow-lane.js` read a view like any trace, so these are
// rewritten to the kept list. Each kept message knows its canonical index `i` (0-based); a folded row stands for its first member.

import type { Message } from './trace-types.ts';

export function renumber<T extends { m: Message; i: number }>(kept: T[], canonical: Message[]): Message[] {
  const at = new Map<number, number>(); // canonical index -> new index
  kept.forEach((x, k) => { if (!at.has(x.i)) at.set(x.i, k); });
  // A hidden message that started deferred work hands its own `of` on: what ran under it now belongs to whatever it belonged to.
  const ofOf = (old: number | undefined): number | undefined => {
    for (let guard = 0; old !== undefined && guard < 50; guard++) {
      const k = at.get(old - 1);
      if (k !== undefined) return k + 1;
      old = canonical[old - 1]?.of;
    }
    return undefined;
  };
  // Delivery ordinals per group, dense again over what is kept.
  const ords = new Map<string, number[]>();
  for (const { m } of kept) if (m.group && m.delivery !== undefined) { const l = ords.get(m.group) ?? []; if (!l.includes(m.delivery)) l.push(m.delivery); ords.set(m.group, l); }
  for (const l of ords.values()) l.sort((a, b) => a - b);
  const groupId = (old: string) => { const k = at.get(Number(old.slice(1))); return k === undefined ? old : `m${k}`; };
  return kept.map(({ m }, k) => {
    const { n: _n, of: _of, repeatOf: _r, ...o } = m;
    const out: Message = { ...o };
    if (m.n !== undefined) out.n = k + 1;
    const of = ofOf(m.of);
    if (of !== undefined) out.of = of;
    if (m.repeatOf !== undefined) {
      const r = at.has(m.repeatOf - 1) ? at.get(m.repeatOf - 1)! + 1 : undefined;
      if (r !== undefined) { out.repeatOf = r; out.label = m.label.replace(/↩ seen at step \d+/, `↩ seen at step ${r}`); }
      else out.label = m.label.replace(/ ↩ seen at step \d+/, '');
    }
    if (m.group) {
      out.group = groupId(m.group);
      if (m.delivery !== undefined) out.delivery = ords.get(m.group)!.indexOf(m.delivery) + 1;
      if (m.deliveries !== undefined) out.deliveries = ords.get(m.group)?.length ?? 0;
    }
    return out;
  });
}
