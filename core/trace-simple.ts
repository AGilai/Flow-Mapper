// The Simple view (0.44.0, #90), pure: a post-pass over the canonical trace that answers "what does this flow touch, and in what order".
//   1 kept     what External keeps, minus internal calls, frontier steps and markers; problems (gap, broken, unhandled, blocked) always stay.
//   2 arms     every arm is in (the caller drops `arms` / `alt` / decisions; `flattened` says how many).
//   3 counted  the first (caller service, target, op, key) is drawn, later ones go and ride on it as `occurrences`; the label gets `*N `.
//              Calls of one caller to one store with different ops merge into one #88 row (`*3 get, set`), even when not adjacent.
//   4 repeats  a call or delivery to a (callee service, ingress, event) already expanded is one arrow `↩ seen at step N` (`repeatOf`), its subtree dropped.
//   5 hidden   per service: the internal calls and frontier steps rules 1-4 removed (duplicates folded into a count are not in it).
//   3b merge   (`merge`, #109, the HLD view) one arrow per (caller, target) within one activation of the caller (the call that enters it up to its return), whatever lies between
//              the calls: store calls (blocked ones too, as a "! N" badge) and calls into a target that opens no activation of its own (a leaf: nothing nested) merge; a call that does keep its place.
//   6 budget   the view is cut at `maxMessages` items (`cut`).
// Numbers are rewritten by the caller (trace-renumber.ts); `repeatOf` is a canonical step number until then.

import type { Message, Occurrence } from './trace-types.ts';
import { foldRun } from './trace-db-group.ts';

export type Item = { m: Message; i: number };
export interface Simple { items: Item[]; hidden: Map<string, number>; cut: boolean }
interface Entry { x: Item; occ: Occurrence[]; res: boolean; act?: number; leaf?: Message[] }

const KEEP = new Set(['entry', 'egress', 'deliver', 'resource']);
const AT = / ↩ seen at step \d+/;
const problem = (m: Message) => !!m.gap || !!m.broken || !!m.unhandled || !!m.blocked;
const kept = (m: Message) => problem(m) || (KEEP.has(m.kind) && m.origin !== 'frontier');
const occOf = (m: Message): Occurrence => ({ service: m.service, fn: m.fn, seq: m.seq, key: m.key });

const problemKeep = (m: Message) => !!m.blocked && !m.gap && !m.broken && !m.unhandled; // a blocked store call whose store is known still goes into its merge
const MS = /^[a-z0-9-]+:(\w+) [^/\s]+(\/\S*)?$/i;
/** `POST /ap/token` for `http:POST ext/ap/token`; anything else as it is. */
export const shortOp = (label: string) => { const r = MS.exec(label.replace(AT, '')); return r ? `${r[1]}${r[2] ? ` ${r[2]}` : ''}` : label; };
/** The activation of each message: the index of the nearest enclosing message that opens a bar of its own (not an internal call), or -1. Messages of one lifeline bar share it. */
function activations(all: Item[]): number[] {
  const out: number[] = [], stack: { d: number; k: number }[] = [];
  all.forEach((x, k) => {
    while (stack.length && stack[stack.length - 1].d >= x.m.depth) stack.pop();
    let a = -1; for (let j = stack.length - 1; j >= 0; j--) if (all[stack[j].k].m.kind !== 'call' && all[stack[j].k].m.kind !== 'frontier') { a = stack[j].k; break; }
    out.push(a); stack.push({ d: x.m.depth, k });
  });
  return out;
}

export function simplify(all: Item[], maxMessages?: number, merge = false): Simple {
  const hidden = new Map<string, number>(), seen = new Map<string, Entry>(), calleeSeen = new Map<string, Item>(), dead = new Set<number>(), entries: Entry[] = [];
  let cutDepth = -1;
  const hide = (m: Message) => {
    const n = m.kind === 'call' && m.internal ? 1 : m.kind === 'frontier' ? m.frontierSteps ?? 1 : m.origin === 'frontier' ? 1 : 0;
    if (n && m.service) hidden.set(m.service, (hidden.get(m.service) ?? 0) + n);
  };
  const drop = (x: Item, subtree = true) => { hide(x.m); if (x.m.n !== undefined) dead.add(x.i + 1); if (subtree && !x.m.repeatOf) cutDepth = x.m.depth; };
  const act = merge ? activations(all) : [], leafSeen = new Map<string, Entry>();
  for (const [at, x] of all.entries()) {
    let m = x.m;
    if (m.of !== undefined && dead.has(m.of)) { drop(x, false); continue; } // work an async callee / consumer of a dropped step started
    if (cutDepth >= 0) { if (m.depth > cutDepth) { drop(x, false); continue; } cutDepth = -1; }
    if (!kept(m)) { hide(m); continue; }
    if (m.kind === 'resource' && (!problem(m) || (merge && problemKeep(m)))) {
      const k = `r|${merge ? `${act[at]}|` : ''}${m.service}|${m.store ?? m.to}|${m.label}|${m.keyTemplate ?? ''}`, e = seen.get(k);
      if (e) { e.occ.push(occOf(m)); continue; }
      const n: Entry = { x, occ: [occOf(m)], res: true, act: act[at] }; seen.set(k, n); entries.push(n);
      continue;
    }
    if ((m.kind === 'egress' || m.kind === 'deliver') && m.target && !problem(m)) {
      const lk = `l|${act[at]}|${m.from}|${m.to}`, nested = all[at + 1] && all[at + 1].m.depth > m.depth, canLeaf = merge && m.kind === 'egress' && !nested && m.n === undefined && !m.cycle;
      const le = canLeaf ? leafSeen.get(lk) : undefined;
      if (le) { le.leaf!.push(m); le.occ.push(occOf(m)); drop(x); continue; } // #109: another call of the same caller to a target that opens nothing: it rides on the first
      const label = m.label.replace(AT, ''), k = `c|${m.kind}|${m.from}|${m.to}|${m.target.service}|${m.target.ingress}|${label}`, e = seen.get(k);
      if (e) { e.occ.push(occOf(m)); drop(x); continue; } // the same caller makes it a count: this one goes with whatever it expanded
      const tk = `${m.target.service}|${m.target.ingress}|${m.event ?? ''}|${(m.matched ?? []).join(',')}`, first = calleeSeen.get(tk);
      if (first && !m.repeatOf) { // another caller (or another arm) reaches it again: a marker, nothing below it
        m = { ...m, repeatOf: first.i + 1, label: `${label} ↩ seen at step ${first.i + 1}` };
        if (x.m.n !== undefined) dead.add(x.i + 1);
        cutDepth = m.depth;
      } else if (!first && !m.repeatOf && !m.cycle) calleeSeen.set(tk, x);
      const n: Entry = { x: { ...x, m }, occ: [occOf(m)], res: false, ...(canLeaf ? { leaf: [m] } : {}) }; seen.set(k, n); entries.push(n);
      if (n.leaf) leafSeen.set(lk, n);
      continue;
    }
    entries.push({ x, occ: [occOf(m)], res: false });
  }
  // Same caller, same store, other ops: one row at the first one's place (the #88 shape), count = the most often repeated call
  const byStore = new Map<string, Entry[]>();
  const gk = (e: Entry) => `${e.x.m.service}|${e.x.m.store ?? e.x.m.to}${merge ? `|${e.act}` : ''}`;
  for (const e of entries) if (e.res) { const k = gk(e); byStore.set(k, [...(byStore.get(k) ?? []), e]); }
  const items: Item[] = [];
  for (const e of entries) {
    const group = e.res ? byStore.get(gk(e))! : [e];
    if (group[0] !== e) continue;
    if (e.leaf && e.leaf.length > 1) { // #109: calls of one caller to one leaf target: `*3 POST /a, GET /b`
      const ops = [...new Set(e.leaf.map((l) => shortOp(l.label)))].join(', ');
      const { repeatOf: _r, cycle: _c, onlyWhen: _w, ...base } = e.x.m, gs = [...new Set(e.leaf.flatMap((l) => (l.onlyWhen ? [l.onlyWhen.guard] : [])))]; // the arrow is conditional only when every call it stands for is // a repeat marker that merged with its caller's other calls is one arrow like the rest
      items.push({ ...e.x, m: { ...base, ...(e.leaf.every((l) => l.onlyWhen) && e.x.m.onlyWhen ? { onlyWhen: { ...e.x.m.onlyWhen, guard: gs.join('; ') } } : {}), label: `*${e.leaf.length} ${ops}`, mergedCalls: e.leaf.length, occurrences: e.occ } });
      continue;
    }
    const most = group.reduce((a, b) => (b.occ.length > a.occ.length ? b : a)), n = Math.max(most.occ.length, group.length);
    const row = group.length > 1 ? foldRun(e.x, group.map((g) => g.x.m), n, merge) : e.x;
    const m = group.length > 1 || n < 2 ? row.m : { ...row.m, label: `*${n} ${row.m.label}` };
    items.push({ ...row, m: n > 1 ? { ...m, occurrences: most.occ } : m });
  }
  const cut = maxMessages !== undefined && items.length > maxMessages;
  return { items: cut ? items.slice(0, maxMessages) : items, hidden, cut };
}
