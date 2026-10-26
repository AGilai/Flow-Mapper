// A view of a canonical trace (0.37.1, #82), pure, shared by the server (REST, MCP) and the browser (preview). trace() makes one
// canonical trace (every arm that is not locked, full detail, keys stamped); everything else is this post-pass, so choosing an
// arm never refetches and the server and the browser agree.
//
//   choose  group -> arm | 'both' (a Map or an object; '*' sets the default for every other group). Default: the FIRST arm of each decision.
//           A lock (`decision.lock`) wins over a conflicting choice (a warning). A decision under an arm that is not in force is not offered.
//   detail  'external' (default): ingress, calls out of a service, deliveries, DB ops, problems and an arm's only content; 'full': everything.
//           `scope: 'intra'` ignores detail (its lifelines are the functions).
//           'simple' (0.44.0, #90): each external call once, arms flattened, internal steps hidden (core/trace-simple.ts); `maxMessages` cuts it.
//   unfold  [key]: the repeat markers (by step key) whose first expansion is copied under them, as sub-steps 7.1, 7.2 (core/trace-unfold.ts).
//   open    ['svc' | 'svc:fn']: brings back the internal calls of that service / function in the external view.
//   group   DB-op grouping (default: on in external, off in full); dbOpen: keys of runs that stay expanded.
// Keys are never recomputed (a view copies the canonical key; a DB row takes its first member's), numbers are rewritten (trace-renumber.ts).

import type { Decision, Message, Trace } from './trace-types.ts';
import { stepKeys } from './description.ts';
import { decisionCounts, rangeOf, type Chosen, type Range } from './trace-counts.ts';
import { groupDbOps } from './trace-db-group.ts';
import { renumber } from './trace-renumber.ts';
import { simplify } from './trace-simple.ts';
import { renumberUnfolded } from './trace-unfold.ts';
import { splitArm } from './alternatives.ts';
import { dropFrames } from './alt-decisions.ts';

export interface ViewOptions { choose?: ReadonlyMap<string, string> | Record<string, string>; detail?: 'simple' | 'external' | 'full'; open?: string[]; dbOpen?: string[]; group?: boolean; unfold?: string[]; maxMessages?: number }
type Item = { m: Message; i: number };

const KEEP = new Set(['entry', 'egress', 'deliver', 'resource']);
// #84: a frontier step (a trace made with frontier=1) and the folded frontier marker are what the viewer asked for: the external detail keeps them
const external = (m: Message) => KEEP.has(m.kind) || !!m.gap || !!m.broken || !!m.unhandled || m.origin === 'frontier' || m.kind === 'frontier';
const opens = (o: string[], m: Message) => o.some((t) => { const [s, f] = [t.split(':')[0], t.includes(':') ? t.slice(t.indexOf(':') + 1) : '']; return m.service === s && (!f || m.fn === f || m.calls === f); });

/** The messages the detail leaves visible: `open` brings back internal ones; an arm that would show nothing keeps its outcome (a leaf, else its first message). */
function visible(all: Item[], detail: string, open: string[]): Item[] {
  if (detail === 'full') return all;
  const show = all.map((x) => external(x.m) || opens(open, x.m));
  const seen = new Set<string>();
  all.forEach((x, k) => { if (show[k]) for (const e of x.m.arms ?? []) seen.add(e); });
  for (const e of new Set(all.flatMap((x) => x.m.arms ?? []))) {
    if (seen.has(e)) continue;
    const hidden = all.map((x, k) => k).filter((k) => !show[k] && all[k].m.arms?.includes(e));
    for (const k of (hidden.filter((k) => all[k].m.kind === 'leaf').length ? hidden.filter((k) => all[k].m.kind === 'leaf') : hidden.slice(0, 1))) show[k] = true;
  }
  return all.filter((_, k) => show[k]);
}

/** The part of a view that decides which messages stay and which decisions are offered; `viewOf` and `viewCounts` both start here, so they cannot disagree. `stamp`: give the messages their keys (only a rendered view needs them). */
function plan(t: Trace, opts: ViewOptions, stamp: boolean) {
  const detail = t.scope === 'intra' ? 'full' : opts.detail ?? 'external';
  const decisions = t.decisions ?? [];
  const group = opts.group ?? detail === 'external';
  const req = opts.choose instanceof Map ? opts.choose : new Map(Object.entries(opts.choose ?? {}));
  const keys = !stamp || t.messages.every((m) => m.key) ? [] : stepKeys(t.messages);
  const all: Item[] = t.messages.map((m, i) => ({ m: m.key || !stamp ? m : { ...m, key: keys[i] }, i }));
  const grouped = group ? groupDbOps(visible(all, detail, opts.open ?? []), new Set(opts.dbOpen ?? [])) : visible(all, detail, opts.open ?? []);
  // choose: the arm in force per decision (lock, else the request, else the first arm; `*:both` makes the default both)
  const warnings: string[] = [], byId = new Map(decisions.map((d) => [d.group_id, d]));
  const dflt = req.get('*') === 'both' ? 'both' : undefined, eff = new Map<string, string>();
  for (const [g, a] of req) if (g !== '*' && !byId.has(g)) warnings.push(`${g}: not a decision of this flow`);
  for (const d of decisions) {
    const want = req.get(d.group_id);
    if (want && want !== 'both' && !d.arms.some((a) => a.arm === want)) warnings.push(`${d.group_id}: no arm '${want}'`);
    const ok = want && (want === 'both' || d.arms.some((a) => a.arm === want)) ? want : undefined;
    if (d.lock) { eff.set(d.group_id, d.lock.arm); if (want && want !== 'both' && want !== d.lock.arm) warnings.push(`${d.group_id}: locked to ${d.lock.arm}`); }
    else eff.set(d.group_id, ok ?? dflt ?? d.arms[0]?.arm ?? 'both');
  }
  const offered = (d: Decision): boolean => !d.parent || !byId.has(d.parent.group_id) || ((eff.get(d.parent.group_id) === d.parent.arm || eff.get(d.parent.group_id) === 'both') && offered(byId.get(d.parent.group_id)!));
  const shown = decisions.filter(offered);
  const kept = grouped.filter(({ m }) => (m.arms ?? []).every((e) => { const [g, a] = splitArm(e), c = eff.get(g); return !c || c === 'both' || c === a; }));

  return { detail, decisions, grouped, kept, shown, eff, warnings };
}

/** The canonical trace's messages as items, keyed when `stamp`. */
const itemsOf = (t: Trace, stamp: boolean): Item[] => { const keys = !stamp || t.messages.every((m) => m.key) ? [] : stepKeys(t.messages); return t.messages.map((m, i) => ({ m: m.key || !stamp ? m : { ...m, key: keys[i] }, i })); };
const isSimple = (t: Trace, opts: ViewOptions) => t.scope !== 'intra' && opts.detail === 'simple';

/** The Simple view (0.44.0, #90): the post-pass of core/trace-simple.ts, renumbered; arms, alt frames and decisions are gone (`flattened` says how many). */
function simpleView(t: Trace, opts: ViewOptions): Trace {
  const { items, hidden, cut } = simplify(itemsOf(t, true), opts.maxMessages);
  const messages = renumber(items, t.messages).map(({ arms: _a, alt: _l, alternatives: _s, ...m }) => m as Message);
  const used = new Set(messages.flatMap((m) => [m.from, m.to]));
  const { decisions: _d, choose: _c, ...rest } = t;
  return { ...rest, messages, detail: 'simple', flattened: (t.decisions ?? []).length, truncated: t.truncated || cut, counts: { messages: { min: messages.length, max: messages.length } },
    participants: t.participants.filter((p) => used.has(p.id)).map((p) => (p.kind === 'service' ? { ...p, internalCalls: 0, hiddenSteps: hidden.get(p.service!) ?? 0 } : p)) };
}

/** The message range and the number of decisions offered of the view `viewOf(t, opts)` would make, without building it (no renumbering, no participants, no per-arm counts): what the Flows list needs per flow. */
export function viewCounts(t: Trace, opts: ViewOptions = {}): { messages: Range; decisions: number } {
  if (isSimple(t, opts)) { const n = simplify(itemsOf(t, false), opts.maxMessages).items.length; return { messages: { min: n, max: n }, decisions: 0 }; }
  const { kept, shown, eff } = plan(t, opts, false);
  return { messages: rangeOf(kept.map((x) => x.m), shown, new Map(shown.map((d) => [d.group_id, eff.get(d.group_id)!]))), decisions: shown.length };
}

export function viewOf(t: Trace, opts: ViewOptions = {}): Trace {
  if (isSimple(t, opts)) return simpleView(t, opts);
  const detail0 = t.scope === 'intra' ? 'full' : opts.detail ?? 'external';
  if (!(t.decisions ?? []).length && detail0 === 'full' && !(opts.group ?? detail0 === 'external') && !opts.unfold?.length) return t; // nothing to decide, show or fold: the canonical trace itself
  const { detail, decisions, grouped, kept, shown, eff, warnings } = plan(t, opts, true);
  const altOff = new Set(decisions.filter((d) => d.from === 'alt' && eff.get(d.group_id) !== 'both').map((d) => d.group_id)); // 0.38.2: a branch on one arm draws no alt frame
  const messages = (opts.unfold?.length ? renumberUnfolded(kept, t.messages, opts.unfold) : renumber(kept, t.messages)).map((m) => (m.alt && altOff.size ? (({ alt: _a, ...r }) => { const a = dropFrames(m.alt, altOff); return a ? { ...r, alt: a } : r; })(m) : m));
  const used = new Set(messages.flatMap((m) => [m.from, m.to]));
  const chosen: Chosen = new Map(shown.map((d) => [d.group_id, eff.get(d.group_id)!]));
  const locks: Chosen = new Map(decisions.flatMap((d) => (d.lock ? [[d.group_id, d.lock.arm] as const] : [])));
  const counts = rangeOf(messages, shown, chosen);
  const view: Trace = {
    ...t, messages, detail, counts: { messages: counts },
    participants: t.participants.filter((p) => used.has(p.id)).map((p) => (p.kind === 'service' ? { ...p, internalCalls: messages.filter((m) => m.kind === 'call' && m.service === p.service).length } : p)),
  };
  if (decisions.length) {
    view.decisions = shown.map((d) => ({ ...d, chosen: eff.get(d.group_id), arms: d.arms.map((a) => ({ ...a, steps: decisionCounts(grouped.map((x) => x.m), decisions, d.group_id, a.arm, locks) })) }));
    view.choose = Object.fromEntries(chosen);
  }
  if (warnings.length) view.warnings = warnings;
  return view;
}
