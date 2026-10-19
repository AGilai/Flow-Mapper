// Bind-key matching. See docs/DESIGN.md §3.
//   '*'  matches any run of characters except '/'
//   '**' matches anything, including '/'

import type { Match } from './types.ts';

const cache = new Map<string, RegExp>();

export function globToRegExp(pattern: string): RegExp {
  let re = cache.get(pattern);
  if (!re) {
    const body = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\u0000')
      .replace(/\*/g, '[^/]*')
      .replace(/\u0000/g, '.*');
    re = new RegExp('^' + body + '$');
    cache.set(pattern, re);
  }
  return re;
}

export function keyMatches(pattern: string, match: Match | undefined, key: string): boolean {
  return match === 'glob' ? globToRegExp(pattern).test(key) : pattern === key;
}

/** Event-type match: '*' and globs (`Order*`) match by pattern, anything else by name. */
export function eventMatches(pattern: string, type: string): boolean {
  return pattern.includes('*') ? globToRegExp(pattern).test(type) : pattern === type;
}

/**
 * Whether a subscription's event filter lets a type through. Entries starting with '!' exclude (name or glob).
 * With positive entries the type must match one and no exclusion; with only exclusions everything else passes.
 */
export function filterAllows(entries: string[], type: string): boolean {
  const pos = entries.filter((p) => !p.startsWith('!'));
  const neg = entries.filter((p) => p.startsWith('!') && p.length > 1);
  if (neg.some((p) => eventMatches(p.slice(1), type))) return false;
  return !pos.length && neg.length ? true : pos.some((p) => eventMatches(p, type));
}

export type FilterEvents = '*' | string[];

/** A subscription filter as words: "all events", "OrderPlaced only", "all except X". */
export function filterLabel(events: FilterEvents): string {
  if (events === '*') return 'all events';
  const pos = events.filter((e) => !e.startsWith('!'));
  const neg = events.filter((e) => e.startsWith('!') && e.length > 1).map((e) => e.slice(1));
  if (!pos.length) return neg.length ? `all except ${neg.join(', ')}` : 'no events';
  return `${pos.join(', ')}${neg.length ? ` except ${neg.join(', ')}` : ' only'}`;
}

/** Higher sorts first: exact beats glob; then fewer wildcards; then longer literal prefix. */
export function specificity(pattern: string, match: Match | undefined): [number, number, number] {
  if (match !== 'glob') return [1, 0, pattern.length];
  const wildcards = (pattern.match(/\*+/g) ?? []).length;
  return [0, -wildcards, pattern.split('*')[0].length];
}

export function compareSpecificity(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
