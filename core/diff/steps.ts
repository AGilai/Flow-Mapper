// Step alignment for functions: steps are matched by content (LCS on a signature), never by `seq`, so a step inserted in
// the middle is one added step and nothing else.

import type { Step } from '../types.ts';
import { same } from './normalise.ts';

export const stepSig = (s: Step) => [s.type, s.target ?? '', s.operation ?? '', s.event ?? '', s.mode ?? '', s.condition ?? '', s.kind ?? ''].join('|');

export function alignSteps(a: Step[], b: Step[]): { added: Step[]; removed: Step[]; changed: { was: Step; now: Step }[] } {
  const sa = a.map(stepSig), sb = b.map(stepSig);
  const n = a.length, m = b.length;
  const len: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) len[i][j] = sa[i] === sb[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
  const out = { added: [] as Step[], removed: [] as Step[], changed: [] as { was: Step; now: Step }[] };
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && sa[i] === sb[j]) {
      if (!same('step', a[i], b[j])) out.changed.push({ was: a[i], now: b[j] });
      i++; j++;
    } else if (j < m && (i === n || len[i][j + 1] >= len[i + 1][j])) out.added.push(b[j++]);
    else out.removed.push(a[i++]);
  }
  return out;
}
