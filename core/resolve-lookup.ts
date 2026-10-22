// Key lookup for resolve(): exact bind keys in a map, glob / amqp-topic patterns in a short list.
// Every item keeps its original array index, so a lookup returns candidates in the order a full filter would.

import type { Match } from './types.ts';
import { keyMatches } from './glob.ts';

const isPattern = (m: Match | undefined) => m === 'glob' || m === 'amqp-topic';

/** The literal parts of a glob (its text split at '*') occur in the key in order, first at the start and last at the end. */
function mayMatch(parts: string[] | null | undefined, key: string): boolean {
  if (!parts) return true;
  const last = parts.length - 1;
  if (!last) return key === parts[0];
  if (!key.startsWith(parts[0]) || !key.endsWith(parts[last]) || key.length < parts[0].length + parts[last].length) return false;
  let at = parts[0].length;
  for (let j = 1; j < last; j++) {
    at = key.indexOf(parts[j], at);
    if (at < 0) return false;
    at += parts[j].length;
  }
  return at <= key.length - parts[last].length;
}

/** `pattern(x)` is the bind key (or `from`) of x, `match(x)` its match mode. The lookup returns the items for which keyMatches(pattern, match, key), in array order. */
export function keyLookup<T>(items: T[], pattern: (x: T) => string, match: (x: T) => Match | undefined): (key: string) => T[] {
  const exact = new Map<string, number[]>();
  const patterns: number[] = [];
  items.forEach((x, i) => {
    if (isPattern(match(x))) { patterns.push(i); return; }
    const k = pattern(x);
    const list = exact.get(k);
    if (list) list.push(i); else exact.set(k, [i]);
  });
  // a glob can only match a key that holds its literal parts in order (cheap test before the regex); amqp-topic patterns are always tried
  const parts = new Map(patterns.map((i) => [i, match(items[i]) === 'glob' ? pattern(items[i]).split('*') : null]));
  if (!patterns.length) return (key) => (exact.get(key) ?? []).map((i) => items[i]);
  const memo = new Map<string, T[]>(); // many egress share a key; the pattern scan runs once per distinct key
  return (key) => {
    const done = memo.get(key);
    if (done) return done;
    const hit = exact.get(key);
    const pats = patterns.filter((i) => mayMatch(parts.get(i), key) && keyMatches(pattern(items[i]), match(items[i]), key));
    const all = hit && pats.length ? [...hit, ...pats].sort((a, b) => a - b) : hit && !pats.length ? hit : pats;
    const out = all.map((i) => items[i]);
    memo.set(key, out);
    return out;
  };
}

/** Every binding source and every prefix of it cut at a '/': `set.has(key)` is "some source is `key` or starts with `key/`". */
export function prefixSet(froms: string[]): Set<string> {
  const s = new Set<string>();
  for (const f of froms) {
    s.add(f);
    for (let i = f.indexOf('/'); i >= 0; i = f.indexOf('/', i + 1)) s.add(f.slice(0, i));
  }
  return s;
}
