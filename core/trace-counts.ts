// Counts of a trace with either/or decisions (0.37.0, #82), pure. Alternatives exclude each other, so an undecided decision adds
// its smallest and its largest arm (never the sum of its arms): the count is a range, and min === max when every decision is on one arm.

import type { Decision, Message } from './trace-types.ts';

export interface Range { min: number; max: number }
/** group id -> the arm in force, or 'both'. A group that is absent counts as 'both'. */
export type Chosen = ReadonlyMap<string, string>;

const armsOf = (m: Message) => m.arms ?? [];
const has = (m: Message, group: string, arm?: string) => armsOf(m).some((e) => (arm === undefined ? e.startsWith(`${group}:`) : e === `${group}:${arm}`));

/** The range of `msgs`: the messages outside every decision that sits directly under `parent` (or at the top), plus the min-max over each such decision's arms (recursively). */
export function rangeOf(msgs: Message[], decisions: Decision[], chosen: Chosen, parent?: { group_id: string; arm: string }): Range {
  const ids = new Set(decisions.map((d) => d.group_id));
  const here = decisions.filter((d) => (d.parent && ids.has(d.parent.group_id) ? d.parent.group_id === parent?.group_id && d.parent.arm === parent.arm : !parent));
  let min = msgs.filter((m) => !here.some((d) => has(m, d.group_id))).length, max = min;
  for (const d of here) {
    const pick = d.lock?.arm ?? chosen.get(d.group_id);
    const arms = d.arms.map((a) => a.arm).filter((a) => !pick || pick === 'both' || a === pick);
    const rs = arms.map((a) => rangeOf(msgs.filter((m) => has(m, d.group_id, a)), decisions, chosen, { group_id: d.group_id, arm: a }));
    if (rs.length) { min += Math.min(...rs.map((r) => r.min)); max += Math.max(...rs.map((r) => r.max)); }
  }
  return { min, max };
}

/** The messages of one arm of one decision, as a range (locks apply, everything else is both unless `chosen` says). */
export const decisionCounts = (msgs: Message[], decisions: Decision[], group: string, arm: string, chosen: Chosen = new Map()): Range =>
  rangeOf(msgs.filter((m) => has(m, group, arm)), decisions, chosen, { group_id: group, arm });
