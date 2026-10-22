// A parsed Mermaid diagram as DesignEdits and the ops they make (0.27.4). Pure. The edits are the same kinds the edit forms send (component,
// endpoint, call, flow), applied one after the other to the draft's rows, so each one sees what the one before made. Only new things are
// written: a component, endpoint or call that is already there (same bind key, same step) is reused, so importing the same text twice adds nothing.

import { applyOp, opRow, type DraftOpInput } from './draft-ops.ts';
import { designEditOps, type DesignEdit } from './design-edit.ts';
import { slug } from './edit-kit.ts';
import { rowId, type ItemRow } from './item-rows.ts';
import type { Links } from './links.ts';
import type { MmCtx, MmMessage, MmNote, MmParsed } from './mermaid-parse.ts';
import { componentName, defaultChoices, readChoice, validName, type MatchChoice, type MatchRow } from './mermaid-match.ts';

export type Target = { name: string } | { client: true } | { skip: true };
export interface MermaidPlan {
  edits: DesignEdit[]; ops: DraftOpInput[]; flow: { service: string; ingress: string; name?: string } | null;
  counts: { components: number; endpoints: number; calls: number; notes: number; reused: number }; creates: string[]; undecided: string[]; warnings: { line?: number; text: string }[];
}

/** The decision per participant (defaults, then the caller's `matches`) as targets; the components to copy from the source first. */
export function resolveTargets(rows: MatchRow[], given: Record<string, unknown> = {}) {
  const choices: Record<string, MatchChoice> = defaultChoices(rows), warnings: string[] = [], targets: Record<string, Target> = {}, fromSource: { id: string; name: string }[] = [];
  for (const [id, v] of Object.entries(given ?? {})) {
    const c = readChoice(v);
    if (!rows.some((r) => r.id === id)) warnings.push(`matches names '${id}', which is not a participant: ignored`);
    else if (!c) warnings.push(`the match for '${id}' is not a component name, {create}, {fromSource} or {client}: ignored`);
    else choices[id] = c;
  }
  for (const r of rows) {
    const c = choices[r.id], pick = (n: string) => (validName(n) ? n : componentName(n));
    if ('client' in c) targets[r.id] = { client: true };
    else if ('skip' in c) targets[r.id] = { skip: true };
    else if ('component' in c) targets[r.id] = { name: c.component };
    else if ('fromSource' in c) { const name = r.source ?? componentName(r.label); targets[r.id] = { name }; fromSource.push({ id: r.id, name }); }
    else targets[r.id] = { name: pick(c.name ?? r.label) };
  }
  return { choices, targets, fromSource, warnings };
}

const HTTP = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/\S*)$/i;
/** A message label as an endpoint: `METHOD /path` is http; anything else is undecided with the label as the operation; `Op: text` leaves text as the step's description. */
export function readLabel(label: string, to: string): { transport: 'http' | 'undecided'; bindKey: string; operation?: string; text?: string } {
  const i = label.indexOf(': '), head = (i >= 0 ? label.slice(0, i) : label).trim(), text = i >= 0 ? label.slice(i + 2).trim() : '';
  const h = HTTP.exec(head);
  if (h) return { transport: 'http', bindKey: `http:${h[1].toUpperCase()} ${to}${h[2]}`, ...(text ? { text } : {}) };
  const op = head || 'call';
  return { transport: 'undecided', bindKey: `tbd:${to}/${slug(op)}`, operation: op, ...(text ? { text } : {}) };
}

const canon = (v: any): string => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

export function mermaidPlan(parsed: MmParsed, targets: Record<string, Target>, rows: ItemRow[], opts: { groupPath?: string } = {}): MermaidPlan {
  const map = new Map(rows.map((r) => [rowId(r), r]));
  const get = (service: string, list: string, key = '') => map.get(rowId({ service, list, key }));
  const plan: MermaidPlan = { edits: [], ops: [], flow: null, counts: { components: 0, endpoints: 0, calls: 0, notes: 0, reused: 0 }, creates: [], undecided: [], warnings: [] };
  const warn = (text: string, line?: number) => plan.warnings.push({ text, ...(line ? { line } : {}) });

  /** Apply one edit to the rolling rows; only ops that change something are kept. Returns the new rows' lists. */
  function emit(edit: DesignEdit): string[] {
    const fresh: string[] = [], kept: DraftOpInput[] = [];
    for (const o of designEditOps(edit, [...map.values()])) {
      const r = opRow(o), old = map.get(rowId(r));
      if (o.op === 'upsert' && old && canon(old.data) === canon(o.data)) continue;
      if (!old) fresh.push(r.list);
      applyOp(map, { ...o, ...r, data: o.data } as any); kept.push(o);
    }
    if (kept.length) { plan.edits.push(edit); plan.ops.push(...kept); }
    return fresh;
  }
  const ingressOf = (service: string, bindKey: string) => [...map.values()].find((r) => r.service === service && r.list === 'ingress' && r.data.bindKey === bindKey);

  for (const p of parsed.participants) {
    const t = targets[p.id];
    if (!t || !('name' in t) || get(t.name, 'header')) continue;
    if (emit({ kind: 'component', name: t.name, serviceKind: 'service', ...(opts.groupPath ? { groupPath: opts.groupPath } : {}) }).includes('header')) { plan.counts.components++; plan.creates.push(t.name); }
  }

  const msgs = parsed.messages.filter((m) => m.kind !== 'return');
  const cur = new Map<string, string>();   // component -> the handler its lifeline is inside of now
  let entry: { service: string; ingress: string } | null = null;
  const seenCount = new Map<string, number>(), skipped = new Set<string>(), noFn = new Set<string>();
  let lastHost = '';   // the component whose function made the last call (a return gives it back to the caller): a note goes into that function, after the call. Never into the callee's: an endpoint's function runs for every call to it, a note there would show once, at the first.
  let pending: MmNote[] = [];

  /** An endpoint of `service` with this bind key: the one that is there, or a new one. */
  function ensureEndpoint(service: string, l: ReturnType<typeof readLabel>, entryPoint: boolean, description?: string) {
    let ing = ingressOf(service, l.bindKey);
    const fresh = !ing;
    if (!ing) {
      if (emit({ kind: 'endpoint', service, transport: l.transport, bindKey: l.bindKey, ...(entryPoint ? { entryPoint: true } : {}), ...(description ? { description } : {}) }).includes('ingress')) { plan.counts.endpoints++; if (l.transport === 'undecided') plan.undecided.push(l.operation ?? l.bindKey); }
      ing = ingressOf(service, l.bindKey)!;
    }
    return { id: ing.key as string, handler: ing.data.handler as string, fresh };
  }
  /** A frame is declared by the function of the first step inside it: the view draws a frame over the calls below its steps, so the functions those calls run in do not repeat it. */
  const owner = new Map<string, string>();
  const ctxOf = (c: MmCtx, host: string) => {
    const groups = (c.groups ?? []).filter((g) => owner.get(g.id) === host || (!owner.has(g.id) && owner.set(g.id, host)));
    return { ...(groups.length ? { groups } : {}), ...(c.mark ? { mark: c.mark } : {}) };
  };
  const fnSteps = (service: string, fn: string): any[] => get(service, 'functions', fn)?.data.steps ?? [];
  const seen = (key: string) => (seenCount.set(key, (seenCount.get(key) ?? 0) + 1), seenCount.get(key)! - 1);

  /** A step with no target (a note, or a self-message) in the function the lifeline `host` is in. Re-importing finds it by its words and adds nothing. */
  function leaf(host: string, e: { operation?: string; note?: string; over?: string[]; self?: boolean; real?: string } & MmCtx) {
    const fn = cur.get(host)!, same = (s: any) => s.kind === 'leaf' && s.operation === e.operation && s.note === e.note && JSON.stringify(s.over ?? null) === JSON.stringify(e.over ?? null);
    if (fnSteps(host, fn).filter(same).length > seen(`${host}/${fn}|leaf|${e.operation}|${e.note}|${e.over}`)) { plan.counts.reused++; return; }
    const { groups, mark, ...rest } = e;
    emit({ kind: 'leaf', from: { service: host, fn }, ...rest, ...ctxOf({ groups, mark }, `${host}/${fn}`) });
    plan.counts.notes++;
  }
  /** A note over lifelines: a note step spanning those components, in the function that is active. False: no function yet, try again after the next call. */
  function note(n: MmNote): boolean {
    const over = [...new Set(n.over.map((id) => targets[id]).filter((t): t is { name: string } => !!t && 'name' in t).map((t) => t.name))];
    if (!over.length) { warn(`a note over ${n.over.join(', ')} is on a client or data store: skipped`, n.line); return true; }
    if (!n.text) return true;
    const host = lastHost;
    if (!cur.has(host)) return false;
    leaf(host, { note: n.text, over, groups: n.groups, mark: n.mark });
    return true;
  }
  const flush = () => { pending = pending.filter((n) => !note(n)); };

  function message(m: MmMessage) {
    const S = targets[m.from], R = targets[m.to];
    for (const [id, t] of [[m.from, S], [m.to, R]] as const) if (t && 'skip' in t && !skipped.has(id)) { skipped.add(id); warn(`'${id}' is a channel or data store, not a component: its messages are skipped`, m.line); }
    if (R && 'skip' in R || S && 'skip' in S) return;
    if (!R || 'client' in R) return warn(`${m.from} -> ${m.to} goes to a client: skipped`, m.line);
    const l = readLabel(m.label, R.name), note0 = l.text ?? '';
    const clientSide = !S || !('name' in S);
    if (clientSide) {
      if (entry) return warn(`a second message from the client '${m.from}': skipped (one flow per diagram)`, m.line);
      const e = ensureEndpoint(R.name, l, true, note0 || undefined);
      entry = { service: R.name, ingress: e.id }; cur.set(R.name, e.handler); lastHost = R.name;
      if (note0 && e.fresh) plan.counts.notes++;
      return;
    }
    if (!cur.has(S.name)) {   // the sender was never called: it starts here, with an endpoint of its own that is not yet designed
      const e = ensureEndpoint(S.name, { transport: 'undecided', bindKey: `tbd:${S.name}/${slug(parsed.title || 'mermaid-flow').toLowerCase()}` }, !entry);
      if (!entry) entry = { service: S.name, ingress: e.id };
      cur.set(S.name, e.handler);
    }
    const fn = cur.get(S.name)!;
    if (!get(S.name, 'functions', fn) && !noFn.has(S.name + fn)) { noFn.add(S.name + fn); warn(`'${fn}' of ${S.name} has no function in this design (its behaviour is in another environment): its calls here go into a new function of that name`, m.line); }
    if (S.name === R.name) {   // a self-message: an internal step of that component
      lastHost = S.name;
      leaf(S.name, { operation: m.label || 'step', self: true, ...(m.real ? { real: m.real } : {}), groups: m.groups, mark: m.mark });
      return;
    }
    const e = ensureEndpoint(R.name, l, false);
    const mode = m.kind === 'async' ? 'async' : undefined;
    const key = `${S.name}/${fn}|${l.bindKey}`, before = seen(key);
    const steps = fnSteps(S.name, fn).filter((s: any) => s.type === 'egress' && get(S.name, 'egress', s.target)?.data.bindKey === l.bindKey);
    if (steps.length > before) plan.counts.reused++;
    else {
      emit({ kind: 'call', from: { service: S.name, fn }, to: { service: R.name, ingress: e.id }, ...(mode ? { mode } : {}), ...(l.operation ? { operation: l.operation } : {}), ...(note0 ? { note: note0 } : {}),
        ...ctxOf(m, `${S.name}/${fn}`), ...(m.real ? { real: m.real } : {}), ...(m.response ? { response: m.response } : {}) });
      plan.counts.calls++; if (note0) plan.counts.notes++;
    }
    cur.set(R.name, e.handler); lastHost = S.name;
  }

  // messages and notes in the order they were written (a note's `after` counts the messages before it); a return closes the call it answers
  let ni = 0;
  parsed.messages.forEach((m, i) => {
    while (ni < parsed.notes.length && parsed.notes[ni].after <= i) { const n = parsed.notes[ni++]; if (!note(n)) pending.push(n); }
    if (m.kind === 'return') {
      const to = targets[m.to];
      if (to && 'name' in to && cur.has(to.name)) lastHost = to.name;
    } else message(m);
    flush();
  });
  while (ni < parsed.notes.length) { const n = parsed.notes[ni++]; if (!note(n)) pending.push(n); }
  flush();
  for (const n of pending) warn('a note before any call has no function to sit in: skipped', n.line);

  const [main, ...sub] = parsed.links, links: Links | undefined = main ? { main, ...(sub.length ? { sub } : {}) } : undefined;   // the first link is the flow's main link, the rest are sub links
  if (entry) {
    const ing = get(entry.service, 'ingress', entry.ingress)!, e = entry as { service: string; ingress: string };
    const name = (parsed.flow ?? parsed.title)?.trim(), cur0 = get(e.service, 'flow', e.ingress)?.data ?? {};
    const edit: DesignEdit = { kind: 'flow', service: e.service, ingress: e.ingress, ...(ing.data.entryPoint === true ? {} : { entryPoint: true }),
      ...(name && name !== cur0.name ? { name } : {}), ...(parsed.description && parsed.description !== cur0.description ? { description: parsed.description } : {}),
      ...(links && canon(links) !== canon(cur0.links ?? null) ? { links } : {}) };
    if (Object.keys(edit).length > 3) emit(edit);
    plan.flow = { ...e, ...(name ? { name } : {}) };
  } else if (!msgs.length) warn('the diagram has no messages: nothing to import');
  return plan;
}
