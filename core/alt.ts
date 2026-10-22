// Alternatives (#41): steps of one function that exclude each other, drawn as an alt frame.
//
// A group is either explicit (steps of the function that share `altGroup`) or inferred: consecutive
// steps with the same `source` file:line that each carry a `condition`. One branch per distinct
// condition (a step without a condition is a branch of its own); a group needs two branches.

import type { GroupKind, Step } from './types.ts';

/** `kind` only when not `alt`; `condition` only on a step with `groups` (the branch it names); `parent`: the enclosing frame (0.32.2, #72). */
export interface Alt { group: string; branch: number; of: number; kind?: GroupKind; condition?: string; parent?: Alt }

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
  // Nested frames (#72): a step with `groups` lists its frames outermost first; the branch of each is its entry's condition ('' = the only one).
  const branches = new Map<string, string[]>();
  for (const s of steps) for (const e of s.groups ?? []) { const l = branches.get(id(e.id)) ?? []; if (!l.includes(e.condition ?? '')) l.push(e.condition ?? ''); branches.set(id(e.id), l); }
  for (const s of steps) {
    let parent: Alt | undefined;
    for (const e of s.groups ?? []) {
      const l = branches.get(id(e.id))!;
      parent = { group: id(e.id), branch: l.indexOf(e.condition ?? '') + 1, of: l.length, ...(e.kind && e.kind !== 'alt' ? { kind: e.kind } : {}), ...(e.condition ? { condition: e.condition } : {}), ...(parent ? { parent } : {}) };
    }
    if (parent) out.set(s.seq, parent);
  }
  steps = steps.filter((s) => !s.groups?.length);
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

/** The tally of one frame: messages per branch, the largest branch counting toward the enclosing branch (#41). */
export interface AltCtx { counts: number[]; max: number; branch: number; parent?: AltCtx }

/** The tally of `a` in `ctxs` (by group), made on first use; a nested frame counts toward its parent's branch (#72), a top frame toward `outer`. Sets the branch of every frame up the chain. */
export function altCtxOf(ctxs: Map<string, AltCtx>, a: Alt, outer?: AltCtx): AltCtx {
  let c = ctxs.get(a.group);
  if (!c) ctxs.set(a.group, (c = { counts: Array(a.of).fill(0), max: 0, branch: 0, parent: a.parent ? altCtxOf(ctxs, a.parent, outer) : outer }));
  c.branch = a.branch - 1;
  if (a.parent) altCtxOf(ctxs, a.parent, outer);
  return c;
}
