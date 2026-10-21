// The "what changed" phrases shown next to a mark: `+1 endpoint`, `−2 calls`, `~1 endpoint`, `+1 call: auth-svc`,
// `header: team, description`, `message UserUpdated: 1 new field`. Joined by " · ", at most 3 and then `+N more`.

import type { Mark } from './index.ts';

const NOUN: Record<string, string> = {
  ingress: 'endpoint', egress: 'call', functions: 'function', resources: 'store', channels: 'channel', bindings: 'subscription',
  dto: 'message', event_dto: 'message', schema: 'schema',
};
const ORDER = ['endpoint', 'call', 'function', 'store', 'channel', 'subscription', 'message', 'schema'];
const SIGN: Record<Mark, string> = { new: '+', removed: '\u2212', changed: '~' };

/** One changed item that rolls up into its component or endpoint. `callee` is set for a new call whose target is known. */
export interface Contrib { list: string; mark: Mark; callee?: string }

export function entityPhrases(cs: Contrib[]): string[] {
  const out: string[] = [];
  for (const mark of ['new', 'removed', 'changed'] as Mark[]) {
    for (const noun of ORDER) {
      const group = cs.filter((c) => c.mark === mark && NOUN[c.list] === noun);
      const n = group.length;
      if (!n) continue;
      out.push(n === 1 && mark === 'new' && group[0].callee ? `+1 call: ${group[0].callee}` : `${SIGN[mark]}${n} ${noun}${n === 1 ? '' : 's'}`);
    }
  }
  return out;
}

/** "1 new field, 2 changed fields" */
export function fieldCounts(marks: { mark: Mark }[]): string {
  const part = (m: Mark, word: string) => { const n = marks.filter((x) => x.mark === m).length; return n ? `${n} ${word} field${n === 1 ? '' : 's'}` : ''; };
  return [part('new', 'new'), part('changed', 'changed'), part('removed', 'removed')].filter(Boolean).join(', ');
}

export function joinWhat(phrases: string[]): string | undefined {
  const p = phrases.filter(Boolean);
  if (!p.length) return undefined;
  return p.length <= 3 ? p.join(' · ') : `${p.slice(0, 3).join(' · ')} · +${p.length - 3} more`;
}
