// A view of a canonical trace (0.37.1, #82), pure, shared by the server (REST, MCP) and the browser (preview). trace() makes one
// canonical trace (every arm that is not locked, full detail, keys stamped); everything else is this post-pass, so choosing an
// arm never refetches and the server and the browser agree.
//
//   choose  group -> arm | 'both' (a Map or an object; '*' sets the default for every other group). Default: the FIRST arm of each decision.
//           A lock (`decision.lock`) wins over a conflicting choice (a warning). A decision under an arm that is not in force is not offered.
//   detail  'external' (default): ingress, calls out of a service, deliveries, DB ops, problems and an arm's only content; 'full': everything.
//           `scope: 'intra'` ignores detail (its lifelines are the functions).
//   open    ['svc' | 'svc:fn']: brings back the internal calls of that service / function in the external view.
//   group   DB-op grouping (default: on in external, off in full); dbOpen: keys of runs that stay expanded.
// Keys are never recomputed (a view copies the canonical key; a DB row takes its first member's), numbers are rewritten (trace-renumber.ts).

import type { Decision, Message, Trace } from './trace-types.ts';
import { stepKeys } from './description.ts';
import { decisionCounts, rangeOf, type Chosen } from './trace-counts.ts';
import { groupDbOps } from './trace-db-group.ts';
import { renumber } from './trace-renumber.ts';
import { splitArm } from './alternatives.ts';
import { dropFrames } from './alt-decisions.ts';

export interface ViewOptions { choose?: ReadonlyMap<string, string> | Record<string, string>; detail?: 'external' | 'full'; open?: string[]; dbOpen?: string[]; group?: boolean }
type Item = { m: Message; i: number };

const KEEP = new Set(['entry', 'egress', 'deliver', 'resource']);
const external = (m: Message) => KEEP.has(m.kind) || !!m.gap || !!m.broken || !!m.unhandled;
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

export function viewOf(t: Trace, opts: ViewOptions = {}): Trace {
  const detail = t.scope === 'intra' ? 'full' : opts.detail ?? 'external';
  const decisions = t.decisions ?? [];
  const group = opts.group ?? detail === 'external';
  if (!decisions.length && detail === 'full' && !group) return t; // nothing to decide, show or fold: the canonical trace itself
  const req = opts.choose instanceof Map ? opts.choose : new Map(Object.entries(opts.choose ?? {}));
  const keys = t.messages.every((m) => m.key) ? t.messages.map((m) => m.key!) : stepKeys(t.messages);
  const all: Item[] = t.messages.map((m, i) => ({ m: m.key ? m : { ...m, key: keys[i] }, i }));
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

  const altOff = new Set(decisions.filter((d) => d.from === 'alt' && eff.get(d.group_id) !== 'both').map((d) => d.group_id)); // 0.38.2: a branch on one arm draws no alt frame
  const messages = renumber(kept, t.messages).map((m) => (m.alt && altOff.size ? (({ alt: _a, ...r }) => { const a = dropFrames(m.alt, altOff); return a ? { ...r, alt: a } : r; })(m) : m));
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
