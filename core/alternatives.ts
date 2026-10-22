// Either/or alternatives in the walk (0.37.0, #82), pure. Part 1 stores `alternatives` (groups with arms that name steps) and `fixes` on steps.
// This file turns them into what trace() needs: the index (group -> arms, step -> the arms it sits in), the arm path a step
// enters, the locks (`fixes`, scoped to the path below the fixing step like `bind`, #42) and the trace's `decisions`.
//
// A step id is `<service>:<function id>#<seq>`. An arm's step brings its whole subtree (callees, deliveries): the walk keeps the
// path while it runs inside the step. A group may be repeated on several steps; groups are deduped by `group_id` (first one wins,
// arms and their step ids are united).

import type { GraphIndex } from './graph-index.ts';
import type { Step } from './types.ts';
import type { Decision, Message, Trace } from './trace-types.ts';
import { altsOf, fixesOf } from './step-marks.ts';
import { stepKeys } from './description.ts';
import { decisionCounts } from './trace-counts.ts';

export interface GroupInfo { id: string; def: ReturnType<typeof altsOf>[number]; arms: string[]; hosts: string[] }
export interface AltIndex {
  groups: Map<string, GroupInfo>;
  /** step id -> the `<group>:<arm>` entries its step_ids put it in. */
  armOf: Map<string, string[]>;
  /** step id -> the groups that step carries (declares). */
  hosted: Map<string, string[]>;
}
/** The caller's literal fixing an arm for everything below it on this path. */
export interface Fixed { arm: string; at: string; source?: { file?: string; line?: number }; literal?: unknown }
/** The state the walk carries: the arm path (outermost first, `<group>:<arm>`) and the fixes in force. */
export interface ArmState { path: string[]; fixes: ReadonlyMap<string, Fixed> }
export const NO_ARMS: ArmState = { path: [], fixes: new Map() };

/** `<group>:<arm>`, split at the first ':'; an alt-made arm `b<N>` (0.38.2: its group id is `<fn>:<altGroup>`) splits at the last. */
export const splitArm = (e: string): [string, string] => { const i = /:(?:b\d+|both)$/.test(e) ? e.lastIndexOf(':') : e.indexOf(':'); return [e.slice(0, i), e.slice(i + 1)]; };

const memo = new WeakMap<GraphIndex, AltIndex | null>();
/** The alternatives of a graph, or null when no step has any (the walk then does nothing extra). Memoised per GraphIndex. */
export function altIndex(g: GraphIndex): AltIndex | null {
  if (memo.has(g)) return memo.get(g)!;
  const ix: AltIndex = { groups: new Map(), armOf: new Map(), hosted: new Map() };
  for (const f of g.fns.values()) {
    for (const st of f.steps) {
      const id = `${f.service}:${f.id}#${st.seq}`;
      for (const def of altsOf(st)) {
        if (!def?.group_id || !Array.isArray(def.arms)) continue;
        const info = ix.groups.get(def.group_id) ?? { id: def.group_id, def, arms: [], hosts: [] };
        ix.groups.set(def.group_id, info);
        info.hosts.push(id);
        ix.hosted.set(id, [...(ix.hosted.get(id) ?? []), def.group_id]);
        for (const a of def.arms) {
          if (!info.arms.includes(a.arm)) info.arms.push(a.arm);
          for (const sid of Array.isArray(a.step_ids) ? a.step_ids : []) {
            const l = ix.armOf.get(sid) ?? [];
            if (!l.includes(`${def.group_id}:${a.arm}`)) ix.armOf.set(sid, [...l, `${def.group_id}:${a.arm}`]);
          }
        }
      }
    }
  }
  const out = ix.groups.size ? ix : null;
  memo.set(g, out);
  return out;
}

/** What the decisions of a trace need while it is walked: where each group was reached, and with which fixes. */
export interface Book { places: Map<string, { fixed: (Fixed | undefined)[]; parent?: { group_id: string; arm: string } }> }
export const newBook = (): Book => ({ places: new Map() });

/**
 * Enter a step: the state it runs under (the arm path with the arms its id puts it in, the fixes it adds) and whether it is skipped
 * (an arm the path's fixes exclude). Groups the step carries go outside-in after the ones it merely belongs to; a group already on the path keeps its arm.
 */
export function enterStep(ix: AltIndex, book: Book, st: Step, id: string, state: ArmState): { state: ArmState; skip: boolean } {
  const fixes = fixesOf(st);
  let fx = state.fixes;
  if (fixes.length) {
    const m = new Map(fx);
    for (const x of fixes) if (ix.groups.has(x.group_id) && x.arm) m.set(x.group_id, { arm: x.arm, at: id, ...(x.source ? { source: x.source } : {}), ...(x.literal !== undefined ? { literal: x.literal } : {}) });
    fx = m;
  }
  const hosted = ix.hosted.get(id) ?? [], own = ix.armOf.get(id) ?? [];
  const path = [...state.path];
  const mine = [...own.filter((e) => !hosted.includes(splitArm(e)[0])), ...own.filter((e) => hosted.includes(splitArm(e)[0]))];
  let skip = false;
  for (const e of mine) {
    const [grp, arm] = splitArm(e);
    if (path.some((p) => splitArm(p)[0] === grp)) continue;
    const fixed = fx.get(grp);
    if (fixed && fixed.arm !== arm) skip = true;
    path.push(e);
  }
  for (const grp of new Set([...hosted, ...own.map((e) => splitArm(e)[0])])) {
    const at = path.findIndex((p) => splitArm(p)[0] === grp);
    const before = at < 0 ? path[path.length - 1] : path[at - 1];
    const rec = book.places.get(grp) ?? { fixed: [] };
    rec.fixed.push(fx.get(grp));
    if (!rec.parent && before) { const [pg, pa] = splitArm(before); rec.parent = { group_id: pg, arm: pa }; }
    book.places.set(grp, rec);
  }
  return { state: { path, fixes: fx }, skip };
}

/** A later visit of a delivery may reuse an earlier expansion (#43) only if the earlier one's arms are all on this path too (then it is visible whenever this one is). */
export const covers = (earlier: string[], now: string[]) => earlier.every((e) => now.includes(e));

/** The `Alt` chain of a path, for the maxMessages tally: only the largest arm of a group counts (#41). */
export function armChain(ix: AltIndex, path: string[]) {
  let alt: { group: string; branch: number; of: number; parent?: any } | undefined;
  for (const e of path) {
    const [group, arm] = splitArm(e), info = ix.groups.get(group)!;
    alt = { group, branch: Math.max(0, info.arms.indexOf(arm)) + 1, of: info.arms.length, ...(alt ? { parent: alt } : {}) };
  }
  return alt;
}

/** The trace with its decisions and stable keys (stamped once, over the canonical, all-arm message list). */
export function withDecisions(ix: AltIndex, book: Book, t: Trace): Trace {
  const decisions: Decision[] = [];
  for (const [id, rec] of book.places) {
    const { def, arms } = ix.groups.get(id)!;
    const labels = new Map(def.arms.map((a) => [a.arm, a]));
    const fixed = rec.fixed.filter((x): x is Fixed => !!x);
    const first = fixed[0];
    const locked = first && fixed.length === rec.fixed.length && fixed.every((x) => x.arm === first.arm);
    decisions.push({
      group_id: id, name: (def.llm_name || def.name) ?? undefined, template_name: def.name, llm_name: def.llm_name ?? null, depends_on: def.depends_on, guard: def.guard,
      ...(rec.parent ? { parent: rec.parent } : {}),
      ...(locked ? { lock: { arm: first.arm, at: first.at, ...(first.source ? { source: first.source } : {}), ...(first.literal !== undefined ? { literal: first.literal } : {}) } } : fixed.length ? { lock_places: { fixed: fixed.length, of: rec.fixed.length } } : {}),
      arms: arms.map((a) => ({ arm: a, label: labels.get(a)?.label, guard_text: labels.get(a)?.guard_text, steps: { min: 0, max: 0 } })),
    });
  }
  for (const d of decisions) for (const a of d.arms) a.steps = decisionCounts(t.messages, decisions, d.group_id, a.arm);
  const keys = stepKeys(t.messages);
  t.messages.forEach((m: Message, i) => { m.key = keys[i]; });
  return { ...t, decisions };
}
