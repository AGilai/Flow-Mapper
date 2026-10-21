// diffEnv(base, cur): the marks (new / changed / removed per anchor) of `cur` against `base`, both lists of ItemRows.
// The caller decides what the sides are: baseline vs the environment (+ draft), or the source's current rows vs the design.

import type { ItemRow } from '../item-rows.ts';
import type { EnvRefs } from '../references.ts';
import { rawMarks } from './entities.ts';
import { counts, prune, rollUp } from './propagate.ts';
import { sideOf } from './side.ts';
import { subsystemMarks } from './subsystems.ts';

export type Mark = 'new' | 'changed' | 'removed';
export interface MarkInfo { mark: Mark; what?: string; was?: string }
export interface DiffOpts {
  against: 'baseline' | 'source';
  /** The service a call of `service` (egress id) reaches, for the phrase `+1 call: <callee>`. */
  calleeOf?: (service: string, egressId: string) => string | undefined;
  /** Filled into the result as is. */
  draft?: string | null; source?: string | null; baselineAt?: string | null;
  /** against = source: components the design copied that the source no longer has (marked new, "no longer in <source>"). */
  vanished?: Set<string>;
  /** With a draft: each component's groupPath in the environment as stored (a move is read against it; the baseline never stores one). */
  prior?: Map<string, string>;
}
export interface EnvMarks {
  against: 'baseline' | 'source'; draft: string | null; source: string | null; baselineAt: string | null;
  marks: Record<string, MarkInfo>;
  ghosts: Record<string, { label: string; service?: string; type?: string }>;
  counts: Record<'components' | 'endpoints' | 'calls' | 'channels' | 'messages' | 'fields' | 'subsystems' | 'links' | 'relations', { new: number; changed: number; removed: number; unchanged?: number }>;
  /** References of the environment (as read with the draft, if any). Set by the server and the preview, not by `diffEnv`. */
  refs?: EnvRefs;
}

export function diffEnv(base: ItemRow[], cur: ItemRow[], opts: DiffOpts): EnvMarks {
  const sb = sideOf(base), sc = sideOf(cur);
  const raw = rawMarks(sb, sc, opts);
  const { marks: pruned, dropped } = prune(raw.marks, sb, sc);
  const final = rollUp(pruned, sb, sc, opts);
  subsystemMarks(sb, sc, final, opts.prior);
  for (const s of opts.vanished ?? []) if (final.get(`svc:${s}`)?.mark === 'new') final.set(`svc:${s}`, { mark: 'new', what: `no longer in ${opts.source ?? 'the source'}` });
  const ghosts = Object.fromEntries(Object.entries(raw.ghosts).filter(([a]) => !dropped.has(a)).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    against: opts.against, draft: opts.draft ?? null, source: opts.source ?? null, baselineAt: opts.baselineAt ?? null,
    marks: Object.fromEntries([...final].sort(([a], [b]) => (a < b ? -1 : 1))), ghosts, counts: counts(final, sc),
  };
}
