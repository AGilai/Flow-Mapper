// Lifelines in subsystem order (#138). Pure. Used by deliveryOrder() only when a service lifeline has a groupPath.
//   services     hierarchical: all components under one top subsystem are contiguous, in the env's group order (parent first, then
//                children in their order; a component directly on the parent path before its children); inside a leaf group in the
//                order they first appear. The first lifeline (the caller) stays first; when it is a grouped component its subsystem ranks first (#127).
//   stores       a component-owned store sits right after its owner (and the owner's earlier stores); an owner with no lifeline in the flow: right after the store's first accessor (#139); an unowned store goes after the grouped components.
//   channels     the declaring component's lifeline (#104), else right after its sender (a queue after the topic that feeds it).
//   last         components with no groupPath, then external ones.
import type { Message, Participant } from './trace-types.ts';

export interface Grouping { groupOf: (service: string) => string; order: string[] }

const top = (p: string) => p.split('/')[0];
const two = (p: string) => p.split('/').slice(0, 2).join('/');
const isSvc = (p: Participant) => (p.kind === 'service' || p.kind === 'function') && !!p.service;

/** The lifelines regrouped, or null when no service lifeline has a groupPath (the caller keeps the legacy order then). */
export function groupedOrder(parts: Participant[], messages: Message[], gr: Grouping): Participant[] | null {
  const svcs = parts.filter(isSvc);
  if (!svcs.some((p) => gr.groupOf(p.service!))) return null;
  const head = parts[0];
  const keys = [...gr.order];   // env order first, then what only a groupPath names (first appearance)
  const pinned = head && isSvc(head) && gr.groupOf(head.service!) ? top(gr.groupOf(head.service!)) : '';
  if (pinned) { const i = keys.indexOf(pinned); if (i >= 0) keys.splice(i, 1); keys.unshift(pinned); }
  for (const p of svcs) { const g = gr.groupOf(p.service!); for (const k of g ? [top(g), two(g)] : []) if (!keys.includes(k)) keys.push(k); }
  const rank = (p: Participant): [number, number] => { const g = gr.groupOf(p.service!); return [keys.indexOf(top(g)), g.includes('/') ? keys.indexOf(two(g)) : -1]; };

  const grouped = svcs.filter((p) => gr.groupOf(p.service!) && !p.external && p !== head);
  grouped.sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1]; });   // stable: first appearance inside a leaf group
  const plain = svcs.filter((p) => !gr.groupOf(p.service!) && !p.external && p !== head), ext = svcs.filter((p) => p.external && p !== head);
  const main = [...(head ? [head] : []), ...grouped], rest = [...plain, ...ext];

  const ownerOf = (p: Participant): string | undefined => (p.kind === 'resource' ? messages.find((m) => m.to === p.id && m.owner)?.owner : p.owner);
  const attached = new Map<string, Participant[]>();   // anchor lifeline id -> what sits right after it
  const loose: Participant[] = [], placed = new Set<string>([...main, ...rest].map((p) => p.id));
  const svcOf = (name?: string) => (name ? svcs.find((p) => p.service === name) : undefined);
  const pending = parts.filter((p) => !isSvc(p) && p !== head);
  for (let guard = 0; pending.length && guard < parts.length * 3; guard++) {
    const p = pending.shift()!;
    let anchor: string | undefined;
    if (p.kind === 'resource') anchor = svcOf(ownerOf(p))?.id ?? (ownerOf(p) ? messages.find((m) => m.to === p.id && m.from !== p.id)?.from : undefined);   // #139: an owner with no lifeline here: right after the first component that calls the store
    else if (p.kind === 'channel') { const o = svcOf(p.owner); anchor = o && gr.groupOf(o.service!) ? o.id : messages.find((m) => m.to === p.id && m.from !== p.id)?.from; }
    if (anchor && !placed.has(anchor)) { pending.push(p); continue; }   // its anchor is another channel not placed yet
    placed.add(p.id);
    if (anchor) attached.set(anchor, [...(attached.get(anchor) ?? []), p]); else loose.push(p);
  }
  loose.push(...pending);
  const expand = (p: Participant): Participant[] => [p, ...(attached.get(p.id) ?? []).flatMap(expand)];
  return [...main.flatMap(expand), ...loose.filter((p) => p.kind === 'resource'), ...rest.flatMap(expand), ...loose.filter((p) => p.kind !== 'resource')];
}
