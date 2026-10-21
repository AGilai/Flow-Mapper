// Component colours: each component of an environment gets a slot 1..8 (the UI's --cmp-1..8) the first time it is seen there and keeps it.
// No two components share a slot up to 8; past 8 the palette repeats in order. Client apps and infra holders (and external / data-store kinds) get none.

export const SLOTS = 8;
const NEUTRAL = new Set(['client-app', 'infra', 'external', 'data-store']);
export const hasColor = (kind: string | undefined) => !NEUTRAL.has(kind ?? 'service');

/** `current` plus a slot for each of `items` (in order) that has none: the lowest slot nobody has, else the palette repeats (n-th component -> n mod 8). */
export function assignColors(current: Record<string, number>, items: { name: string; kind?: string }[]): Record<string, number> {
  const out = { ...current };
  for (const { name, kind } of items) {
    if (name in out || !hasColor(kind)) continue;
    const used = new Set(Object.values(out));
    const free = Array.from({ length: SLOTS }, (_, i) => i + 1).find((s) => !used.has(s));
    out[name] = free ?? (Object.keys(out).length % SLOTS) + 1;
  }
  return out;
}

/**
 * Per-flow de-clash (0.28.1): `order` = the components of one flow in column order with their stored slot (null: neutral).
 * A slot already used earlier in the flow moves to the next free one (cyclic from slot + 1); with all 8 in use it repeats.
 * The stored assignment is never touched: the result is for drawing that flow only.
 */
export function declash(order: { name: string; slot: number | null }[]): Map<string, number> {
  const used = new Set<number>(), out = new Map<string, number>();
  for (const { name, slot } of order) {
    if (slot == null || out.has(name)) continue;
    let s = slot;
    if (used.has(s) && used.size < SLOTS) { do s = (s % SLOTS) + 1; while (used.has(s)); }
    used.add(s); out.set(name, s);
  }
  return out;
}
