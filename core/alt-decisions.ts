// The older either/or mechanism as scenario decisions (0.38.2, #82): every `alt` group of a trace (altGroup, an implicit file:line group, or a design
// `groups` frame of kind alt) is a decision in `decisions`, with `arms` on the messages like the ones that come from `alternatives`. Pure.
//   group_id = alt.group (`<fn>:<altGroup>`), arms `b1..bN` labelled with the branch's condition. opt, loop, par, critical and break are not choices.
//   A group whose own steps host `alternatives` is skipped (it is already a decision). A flow without an alt group is returned as it is.
// Membership follows the alt frame (sequence-alt.js altFrames): a message belongs to the branch its own `alt` names, and so does everything
// deeper than the frame's messages (the subtree) until the call tree comes back to the frame's depth.

import type { Alt } from './alt.ts';
import type { Decision, Message, Trace } from './trace-types.ts';
import { decisionCounts } from './trace-counts.ts';
import { stepKeys } from './description.ts';

const chainOf = (a?: Alt): Alt[] => { const out: Alt[] = []; for (let x = a; x; x = x.parent) out.unshift(x); return out; };
const isChoice = (a: Alt) => !a.kind || a.kind === 'alt';
interface Frame { group: string; depth: number; branch: number; choice: boolean }
interface Info { of: number; conds: Map<number, string>; parent?: { group_id: string; arm: string }; first: Message; hosted: boolean }

/** The condition's left-hand side when every branch has one and it is the same (`nextPriority == 10` -> `nextPriority`). */
const lhsOf = (conds: (string | undefined)[]): string | undefined => {
  const l = conds.map((c) => /^\s*(.+?)\s*(?:===?|!==?|<=|>=|<|>|\bin\b|\bis\b)\s+\S/.exec(c ?? '')?.[1]);
  return l.length > 1 && l.every((x) => x && x === l[0]) ? l[0] : undefined;
};

export function withAltDecisions(t: Trace, countsOnly = false): Trace {
  if (!t.messages.some((m) => m.alt)) return t;
  const open: Frame[] = [], armsOf = new Map<Message, string[]>(), info = new Map<string, Info>();
  for (const m of t.messages) {
    const chain = chainOf(m.alt);
    for (let k = open.length - 1; k >= 0; k--) {
      const f = open[k];
      if (m.depth > f.depth) continue;
      if (!(m.depth === f.depth && chain.some((a) => a.group === f.group))) open.splice(k, 1);
    }
    chain.forEach((a, ci) => {
      let f = open.find((x) => x.group === a.group && x.depth === m.depth);
      if (!f) { f = { group: a.group, depth: m.depth, branch: 0, choice: isChoice(a) }; open.push(f); }
      f.branch = a.branch;
      if (!f.choice) return;
      let i = info.get(a.group);
      if (!i) {
        const above = open.slice(0, open.indexOf(f)).filter((x) => x.choice).pop();
        info.set(a.group, (i = { of: a.of, conds: new Map(), first: m, hosted: false, ...(above ? { parent: { group_id: above.group, arm: `b${above.branch}` } } : {}) }));
      }
      i.of = Math.max(i.of, a.of);
      const c = a.condition ?? (ci === chain.length - 1 ? m.condition : undefined);
      if (c && !i.conds.has(a.branch)) i.conds.set(a.branch, c);
      if (m.alternatives?.length) i.hosted = true;
    });
    const arms = open.filter((f) => f.choice).map((f) => `${f.group}:b${f.branch}`);
    if (arms.length) armsOf.set(m, arms);
  }
  const skip = new Set([...info].filter(([, i]) => i.hosted).map(([g]) => g));
  for (const i of info.values()) if (i.parent && skip.has(i.parent.group_id)) delete i.parent;
  const groups = [...info].filter(([g]) => !skip.has(g));
  if (!groups.length) return t;
  const decisions: Decision[] = groups.map(([g, i]) => {
    const src = i.first.service && i.first.fn ? t.code[`step:${i.first.service}:${i.first.fn}#${i.first.seq}`] : null, tail = g.slice(g.indexOf(':') + 1);
    const name = lhsOf([...i.conds.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])) ?? (tail.includes('@') ? i.first.fn ?? tail : tail.replace(/[-_]+/g, ' '));
    return {
      group_id: g, name, template_name: tail, llm_name: null, from: 'alt', ...(src?.file ? { guard: { file: src.file, ...(src.line ? { line: src.line } : {}) } } : {}), ...(i.parent ? { parent: i.parent } : {}),
      arms: Array.from({ length: i.of }, (_, k) => ({ arm: `b${k + 1}`, label: i.conds.get(k + 1) ?? `branch ${k + 1}`, steps: { min: 0, max: 0 } })),
    };
  });
  const ids = new Set(decisions.map((d) => d.group_id));
  const messages = t.messages.map((m) => {
    const mine = (armsOf.get(m) ?? []).filter((e) => ids.has(e.slice(0, e.lastIndexOf(':'))));
    return mine.length ? { ...m, arms: [...(m.arms ?? []), ...mine] } : m;
  });
  const all = [...(t.decisions ?? []), ...decisions];
  if (countsOnly) return { ...t, messages, decisions: all }; // no per-arm steps, no keys (see TraceOptions.countsOnly)
  for (const d of decisions) for (const a of d.arms) a.steps = decisionCounts(messages, all, d.group_id, a.arm);
  const keys = messages.every((m) => m.key) ? null : stepKeys(messages);
  return { ...t, messages: keys ? messages.map((m, i) => ({ ...m, key: keys[i] })) : messages, decisions: all };
}

/** `alt` without the frames of the groups in `off` (a decision on one arm draws no frame: the dropdown says which branch it is). The rest of the chain is re-linked. */
export function dropFrames(alt: Alt | undefined, off: ReadonlySet<string>): Alt | undefined {
  if (!alt || !chainOf(alt).some((a) => off.has(a.group))) return alt;
  let out: Alt | undefined;
  for (const a of chainOf(alt)) if (!off.has(a.group)) { const { parent: _p, ...rest } = a; out = { ...rest, ...(out ? { parent: out } : {}) }; }
  return out;
}
