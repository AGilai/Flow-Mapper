// Simple keeps its either/or arms as alt frames (#126, #115), pure. The canonical trace says which arms a message sits in (`arms`: `<group>:<arm>`, outermost first)
// and the trace's `decisions` name them; this turns that into the `alt` chain the lane and the Mermaid export already draw (`alt <cond>` / `else <cond>`).
// Only choices are frames (an `alt` group or an `alternatives` group), never loops or opts; a locked decision is one arm (no frame), and a frame with only one arm
// left in the view is dropped (the message's own `onlyWhen` / `condition` says it).

import type { Alt } from './alt.ts';
import type { Decision, Message } from './trace-types.ts';
import { splitArm } from './alternatives.ts';

/** The condition an arm's section is labelled with: the first arm of an `alternatives` group carries the guard's text, the others their label. */
function condOf(d: Decision, arm: string): string {
  const k = d.arms.findIndex((a) => a.arm === arm), a = d.arms[k];
  return (d.from !== 'alt' && k === 0 && d.guard?.text) || a?.guard_text || a?.label || arm;
}

/** `messages` with `alt` (the frames of the arms each sits in) and without `arms` / `alternatives`. */
export function armFrames(messages: Message[], decisions: Decision[]): Message[] {
  const by = new Map(decisions.filter((d) => !d.lock && d.arms.length > 1).map((d) => [d.group_id, d]));
  const path = (m: Message) => (m.arms ?? []).map(splitArm).filter(([g]) => by.has(g));
  const seen = new Map<string, Set<string>>();
  for (const m of messages) for (const [g, a] of path(m)) seen.set(g, (seen.get(g) ?? new Set()).add(a));
  const open: { group: string; depth: number }[] = []; // frames in force: a message below a frame's own messages (its subtree) is covered by it and carries no `alt` of its own
  return messages.map((m0) => {
    const { arms: _a, alt: _l, alternatives: _s, ...m } = m0, mine = path(m0);
    for (let k = open.length - 1; k >= 0; k--) { const f = open[k]; if (m0.depth > f.depth) continue; if (!(m0.depth === f.depth && mine.some(([g]) => g === f.group))) open.splice(k, 1); }
    let alt: Alt | undefined;
    for (const [g, a] of mine) {
      if ((seen.get(g)?.size ?? 0) < 2) continue;
      const f = open.find((x) => x.group === g);
      if (f && m0.depth > f.depth) continue;
      if (!f) open.push({ group: g, depth: m0.depth });
      const d = by.get(g)!;
      alt = { group: g, branch: Math.max(0, d.arms.findIndex((x) => x.arm === a)) + 1, of: d.arms.length, condition: condOf(d, a), ...(alt ? { parent: alt } : {}) };
    }
    return (alt ? { ...m, alt } : m) as Message;
  });
}
