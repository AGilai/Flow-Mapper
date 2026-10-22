// A flow's trace as Mermaid `sequenceDiagram` text (0.27.4). Pure: the REST route, the MCP tool and the static preview all call it with the
// full trace (core/description.ts HASH_TRACE) and, optionally, the flow's name and descriptions.
//   participants  every lifeline a kept message touches, in lifeline order: `participant <id> as <label>` (the entry client is an `actor`)
//   messages      sync `->>` with its return `-->>` (when the callee is a component), async `-)`; calls inside one component are left out
//   groups        (0.33.1, #72) the frames a step sits in as nested `alt`/`else`/`opt`/`loop`/`par`/`and`/`critical`/`option`/`break` ... `end`; a step marked changed sits in `rect`
//   notes         a leaf step with `over`: `Note over A,B: text`; an internal step that was a self-message: `A->>A: text`
//   directives    `%% flow: <name>`, `%% link: <label> <url>` (the flow's links), `%% real: <bind key>` before the message it belongs to
//   notes         a step with a title: the title is the message and its API a note; the step description (human, else AI, else the step's own note) as `Note over A,B: text`
// Text is one line; `;` and `#` are written as Mermaid entities.

import { lineText, titleOf, stepKeys, type FlowDescriptions } from './description.ts';
import type { Links } from './links.ts';
import type { Alt } from './alt.ts';
import type { Message, Participant, Trace } from './trace.ts';
import { rangeBlocks, type RangeNote } from './mermaid-ranges.ts';

export interface MermaidOpts { name?: string; description?: string; descriptions?: FlowDescriptions | null; links?: Links | null; ranges?: RangeNote[] /* 0.34.0: step-range comments, as rect + Note (core/mermaid-ranges.ts) */ }

const BRANCH = { par: 'and', critical: 'option' } as Record<string, string>;
interface Frame { key: string; open: string; kind: string; cond: string; depth: number }
/** The frames around a message, outermost first (its alt chain, then `rect` when it is marked changed). */
function framesOf(m: Message): Frame[] {   // a frame covers its own messages and the calls below them (the view draws it so)
  const chain: Alt[] = [];
  for (let a: Alt | undefined = m.alt; a; a = a.parent) chain.unshift(a);
  const out = chain.map((a) => ({ key: a.group, kind: a.kind ?? 'alt', cond: a.condition ?? '', open: `${a.kind ?? 'alt'}${a.condition ? ` ${esc(a.condition)}` : ''}`, depth: m.depth }));
  if (m.mark === 'changed') out.push({ key: 'rect', kind: 'rect', cond: '', open: 'rect rgb(255, 244, 214)', depth: m.depth });
  if (m.mark === 'new') out.push({ key: 'rect-new', kind: 'rect', cond: '', open: 'rect rgb(214, 245, 214)', depth: m.depth });   // #71: green reads back as new
  return out;
}

const RESERVED = new Set(['end', 'box', 'rect', 'loop', 'alt', 'else', 'opt', 'par', 'and', 'break', 'critical', 'option', 'note', 'participant', 'actor', 'title', 'activate', 'deactivate', 'autonumber', 'create', 'destroy', 'links', 'link']);
export const esc = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/[#;]/g, (c) => `#${c.charCodeAt(0)};`).replace(/%%/g, '%#37;');   // `%%` would start a comment: written as an entity too

/** `http:POST orders-svc/orders` is written `POST /orders`; anything else as the trace labels it. */
export function messageLabel(m: Pick<Message, 'label' | 'transport'> & { operation?: string }): string {
  const label = m.label.replace(/ ↩ seen at step \d+$/, '');   // a repeat of an endpoint seen earlier in the flow
  if (m.operation && /(^|\s)tbd:\S+$/.test(label)) return m.operation;   // not designed yet: the words it was drawn with, not its placeholder key
  const h = /\bhttp:([A-Za-z]+) ([^/\s]+)(\/\S*)?\s*$/.exec(label);   // `POST /verify http:POST auth-svc/verify` (an operation and the bind key) too
  return h ? `${h[1].toUpperCase()} ${h[3] ?? '/'}` : label;
}

/** The text a lifeline is labelled with: the component name; a channel or data store by its key (`sns:order-events`, `postgres:users-db/users`); the unresolved thing. */
function labelOf(p: Participant): string {
  return p.kind === 'channel' || p.kind === 'resource' ? p.id.replace(/^(ch|res):/, '') : p.kind === 'service' ? p.service ?? p.label : p.label;
}

export function exportMermaid(t: Pick<Trace, 'start' | 'participants' | 'messages'>, opts: MermaidOpts = {}): string {
  const name = (opts.name ?? (t.start as { name?: string }).name ?? '').trim();
  const keys = stepKeys(t.messages);
  const kept = t.messages.map((m, i) => ({ m, key: keys[i], index: i })).filter(({ m }) => !m.internal && m.kind !== 'frontier');
  const used = new Set(kept.flatMap(({ m }) => [m.from, m.to]));
  for (const { m } of kept) for (const o of m.over ?? []) for (const p of t.participants) if (labelOf(p) === o) used.add(p.id);   // a note spans lifelines even where no arrow touches them
  const parts = t.participants.filter((p) => used.has(p.id));
  const ids = new Map<string, string>(), taken = new Set<string>();
  for (const p of parts) {
    let id = labelOf(p).replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'p';
    if (/^\d/.test(id) || RESERVED.has(id.toLowerCase().split('_')[0])) id = `p_${id}`;
    for (let n = 2; taken.has(id.toLowerCase()); n++) id = `${id.replace(/_\d+$/, '')}_${n}`;
    taken.add(id.toLowerCase()); ids.set(p.id, id);
  }
  const kind = new Map(parts.map((p) => [p.id, p.kind]));
  const desc = (opts.description ?? lineText(opts.descriptions?.flow)?.text ?? '').trim();

  const where = `${t.start.service} · ${t.start.ingress ?? t.start.fn}`;
  const out: string[] = [`%% Flow: ${name ? `${esc(name)} (${where})` : where}`];
  if (name) out.push(`%% flow: ${esc(name)}`);
  const links = [...(opts.links?.main ? [opts.links.main] : []), ...(opts.links?.sub ?? [])];
  for (const l of links) out.push(`%% link: ${esc(l.label)} ${l.url.replace(/\s+/g, '')}`);
  if (desc) desc.split(/\r?\n/).forEach((l, i) => out.push(i === 0 ? `%% Description: ${l.trim()}` : `%% ${l.trim()}`));
  out.push('sequenceDiagram');
  if (name) out.push(`title ${esc(name)}`);
  for (const p of parts) out.push(`${p.kind === 'client' ? 'actor' : 'participant'} ${ids.get(p.id)} as ${esc(labelOf(p)) || ids.get(p.id)}`);

  const open: { from: string; to: string; depth: number; response?: string }[] = [];
  const ret = (o: { from: string; to: string; response?: string }) => out.push(`${ids.get(o.to)}-->>${ids.get(o.from)}: ${esc(o.response ?? '') || 'return'}`);
  const close = (depth: number) => { while (open.length && open[open.length - 1].depth >= depth) ret(open.pop()!); };
  const idByLabel = new Map(parts.map((p) => [labelOf(p), ids.get(p.id)!]));
  const stack: Frame[] = [];   // the frames written and not yet closed
  const frames = (want: Frame[], depth: number) => {
    let base = 0;   // frames opened by a step above this one cover it too (a rect only covers its own step)
    while (base < stack.length && stack[base].depth < depth && !stack[base].key.startsWith('rect')) base++;
    let k = base;
    while (k < stack.length && k - base < want.length && stack[k].key === want[k - base].key) k++;
    const branched = k > base && !stack[k - 1].key.startsWith('rect') && stack[k - 1].cond !== want[k - 1 - base].cond;   // the same frame, another section
    while (stack.length > k) { out.push('end'); stack.pop(); }
    if (branched) { const w = want[k - 1 - base]; out.push(`${BRANCH[w.kind] ?? 'else'}${w.cond ? ` ${esc(w.cond)}` : ''}`); stack[k - 1] = w; }
    for (let i = k - base; i < want.length; i++) { out.push(want[i].open); stack.push(want[i]); }
  };
  const openAt = new Map<number, number>(); // #73: deferred work (`of`) returns to the frame its async call started in, whatever its depth says
  const rb = opts.ranges?.length ? rangeBlocks(keys, kept.map((k) => ({ index: k.index, a: ids.get(k.m.from)!, b: ids.get(k.m.to)! })), parts.map((p) => ids.get(p.id)!), opts.ranges.map((r) => ({ ...r, text: esc(r.text) }))) : null; // 0.34.0
  for (const [pos, { m, key }] of kept.entries()) {
    const back = m.of === undefined ? undefined : openAt.get(m.of);
    if (back !== undefined) while (open.length > back) ret(open.pop()!);
    close(m.depth);
    frames(framesOf(m), m.depth);
    if (m.n !== undefined) openAt.set(m.n, open.length);
    const a = ids.get(m.from)!, b = ids.get(m.to)!;
    out.push(...(rb?.before.get(pos) ?? []));
    if (m.kind === 'leaf') {   // a step that ends the tree: a note over the lifelines it spans (`over`), or an internal step (a self-message), not an arrow between two
      if (m.self) { if (m.real) out.push(`%% real: ${esc(m.real)}`); out.push(`${a}->>${a}: ${esc(m.label)}`); out.push(...(rb?.after.get(pos) ?? [])); continue; }
      const over = [...new Set((m.over ?? []).map((o) => idByLabel.get(o)).filter((x): x is string => !!x))];
      out.push(`Note over ${over.length ? over.join(',') : a}: ${esc(m.label)}`);
      out.push(...(rb?.after.get(pos) ?? []));
      continue;
    }
    const title = titleOf(opts.descriptions?.callees[key]).trim(); // 0.30.0: a step title is the message text, and the API moves into a note
    if (m.real) out.push(`%% real: ${esc(m.real)}`);
    out.push(`${a}${m.mode === 'async' ? '-)' : '->>'}${b}: ${esc(title || messageLabel(m)) || '(call)'}`);
    if (title) out.push(`Note over ${a === b ? a : `${a},${b}`}: ${esc(messageLabel(m))}`);
    const note = lineText(opts.descriptions?.callees[key])?.text ?? m.note;
    if (note) out.push(`Note over ${a === b ? a : `${a},${b}`}: ${esc(note)}`);
    out.push(...(rb?.after.get(pos) ?? []));
    if (m.mode !== 'async' && m.from !== m.to && ['service', 'client', 'function'].includes(kind.get(m.to) ?? '')) open.push({ from: m.from, to: m.to, depth: m.depth, response: m.returns?.label });
  }
  close(-1);
  frames([], -1);
  return out.join('\n') + '\n';
}
