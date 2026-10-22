// Step-range comments in a Mermaid export (0.34.0, frame 20): a comment on steps 4-9 is written as a `rect` around those messages with a `Note over` that
// carries the first line of the comment. Plain comments and Notes are not exported. Pure; the one function mermaid-export.ts calls.
//
//   rect rgb(253, 241, 184)
//     Note over orders-svc,inventory-svc: Retry 3x with backoff
//     orders-svc->>inventory-svc: PUT /reservations/{sku}
//   end
//
// Mermaid blocks nest, they never cross: of two ranges that overlap without one holding the other, the one that starts first is written and the other is left out.

export interface RangeNote { from: string; to: string; text: string }
export interface KeptMessage { index: number; a: string; b: string } // index: the message's position among all the trace's messages; a / b: the participant ids it joins

export const RECT = 'rect rgb(253, 241, 184)';

/**
 * rangeBlocks(all, kept, order, ranges) -> { before: Map<kept position, lines>, after: Map<kept position, lines> }
 * all: the step key of every message of the trace, in order; kept: the messages the export writes; order: the participant ids left to right; ranges: the comments (`text` already escaped).
 * A range runs from the first written message at or after its `from` step to the last written one at or before its `to` step; with none inside it is left out.
 */
export function rangeBlocks(all: string[], kept: KeptMessage[], order: string[], ranges: RangeNote[]) {
  const before = new Map<number, string[]>(), after = new Map<number, string[]>();
  const found: { lo: number; hi: number; text: string }[] = [];
  for (const r of ranges) {
    const f = all.indexOf(r.from), t = all.indexOf(r.to);
    if (f < 0 || t < 0 || !r.text) continue;
    const lo = kept.findIndex((k) => k.index >= f), hi = kept.reduce((h, k, i) => (k.index <= t ? i : h), -1);
    if (lo >= 0 && hi >= lo) found.push({ lo, hi, text: r.text });
  }
  found.sort((x, y) => x.lo - y.lo || y.hi - x.hi);
  const open: number[] = [];
  for (const r of found) {
    while (open.length && open[open.length - 1] < r.lo) open.pop();
    if (open.length && r.hi > open[open.length - 1]) continue; // crosses the range that is open
    open.push(r.hi);
    const places = kept.slice(r.lo, r.hi + 1).flatMap((k) => [order.indexOf(k.a), order.indexOf(k.b)]).filter((i) => i >= 0);
    const l = order[Math.min(...places)], rr = order[Math.max(...places)];
    (before.get(r.lo) ?? before.set(r.lo, []).get(r.lo)!).push(RECT, `  Note over ${l === rr ? l : `${l},${rr}`}: ${r.text}`);
    (after.get(r.hi) ?? after.set(r.hi, []).get(r.hi)!).push('end');
  }
  return { before, after };
}
