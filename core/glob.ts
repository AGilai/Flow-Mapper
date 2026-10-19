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

/** Higher sorts first: exact beats glob; then fewer wildcards; then longer literal prefix. */
export function specificity(pattern: string, match: Match | undefined): [number, number, number] {
  if (match !== 'glob') return [1, 0, pattern.length];
  const wildcards = (pattern.match(/\*+/g) ?? []).length;
  return [0, -wildcards, pattern.split('*')[0].length];
}

export function compareSpecificity(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
