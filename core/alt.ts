// Alternatives (#41): steps of one function that exclude each other, drawn as an alt frame.
//
// A group is either explicit (steps of the function that share `altGroup`) or inferred: consecutive
// steps with the same `source` file:line that each carry a `condition`. One branch per distinct
// condition (a step without a condition is a branch of its own); a group needs two branches.

import type { Step } from './types.ts';

export interface Alt { group: string; branch: number; of: number }

/** `alt` of every step of a function that belongs to a group, by seq. `steps` are in seq order. */
export function altGroups(steps: Step[], fn = ""): Map<number, Alt> {
  const id = (g: string) => (fn ? `${fn}:${g}` : g);
  const out = new Map<number, Alt>();
  const emit = (group: string, members: Step[]) => {
    const keys: string[] = [];
    for (const s of members) { const k = s.condition ?? `\0${s.seq}`; if (!keys.includes(k)) keys.push(k); }
    if (keys.length < 2) return;
    for (const s of members) out.set(s.seq, { group, branch: keys.indexOf(s.condition ?? `\0${s.seq}`) + 1, of: keys.length });
  };
  const named = new Map<string, Step[]>();
  for (const s of steps) if (s.altGroup) named.set(s.altGroup, [...(named.get(s.altGroup) ?? []), s]);
  for (const [g, members] of named) emit(id(g), members);
  let run: Step[] = [];
  const at = (s: Step) => (s.source ? `${s.source.file}:${s.source.line}` : '');
  const flush = () => { if (run.length > 1) emit(id(`${at(run[0])}@${run[0].seq}`), run); run = []; };
  for (const s of steps) {
    if (s.altGroup || !s.condition || !at(s)) { flush(); continue; }
    if (run.length && at(run[0]) !== at(s)) flush();
    run.push(s);
  }
  flush();
  return out;
}
