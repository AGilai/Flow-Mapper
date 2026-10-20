// RabbitMQ rows of the Inventory (0.19.0): exchanges and queues in the words of their kind ("3 publishers, 5 bindings";
// "bound by audit.#, 1 consumer"), RPC command and reply queues as plumbing the page folds, and the RPC commands themselves
// (an entry point of their server). Pure.

import type { GraphIndex } from './graph-index.ts';
import { bindingKeyOf } from './amqp.ts';
import { exchangeView, exchanges } from './amqp-exchange.ts';
import { rpcOf } from './amqp-route.ts';

/** What the inventory needs of a row; structurally an InventoryItem. */
export interface AmqpRow {
  type: 'channel' | 'rpc'; id: string; label: string; kind: string; group?: string; team?: string; connections: string; size: number; problems: number;
  /** Exchange type, for "amqp-exchange · topic". */
  exchangeType?: string;
  /** RPC plumbing (command and reply queues): folded behind "Show RPC queues". */
  plumbing?: boolean;
  /** Where a row of its own opens: an RPC command opens its server's page with the endpoint panel, a reply-queue row its caller. */
  open?: { service: string; ingress?: string };
}

const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;
/** Keys and commands are written between backticks: the page shows them in mono. */
const some = (xs: string[], max: number) => (xs.length > max ? `${xs.slice(0, max).map((x) => `\`${x}\``).join(', ')}, +${xs.length - max} more` : xs.map((x) => `\`${x}\``).join(', '))
const rpcDetails = (d: any) => (d?.rpc && typeof d.rpc === 'object' ? d.rpc : null);

interface Cmd { command: string; server?: { service: string; ingress: string }; queue?: string; callers: string[] }
function commands(g: GraphIndex): Cmd[] {
  const by = new Map<string, Cmd>();
  const of = (c: string) => by.get(c) ?? by.set(c, { command: c, callers: [] }).get(c)!;
  for (const i of g.model.ingress) {
    if (i.transport !== 'amqp' || !(i.bindKey.startsWith('amqp-rpc:') || rpcDetails(i.details))) continue;
    const c = of(rpcDetails(i.details)?.command ?? i.bindKey.replace(/^amqp-rpc:/, ''));
    c.server = { service: i.service, ingress: i.id };
    c.queue = rpcDetails(i.details)?.commandQueue;
  }
  for (const e of g.model.egress) {
    const r = rpcOf(e);
    if (r) { const c = of(r.command); if (!c.callers.includes(e.service)) c.callers.push(e.service); c.queue ??= r.commandQueue; }
  }
  return [...by.values()];
}

/** `prior`: the problem count the channel summary already has per channel key (unbound queues and the like), kept in the row's count. */
export function amqpRows(g: GraphIndex, prior: Map<string, number> = new Map()): AmqpRow[] {
  const out: AmqpRow[] = [];
  const team = (...services: (string | undefined)[]) => services.map((s) => (s ? g.services.get(s)?.team : undefined)).find(Boolean);
  const views = exchanges(g).map((e) => exchangeView(g, e.key)!);
  for (const v of views) {
    out.push({ type: 'channel', id: v.key, label: v.name, kind: 'amqp-exchange', group: v.key, exchangeType: v.type, team: v.team,
      connections: `${n(v.publisherServices, 'publisher')}, ${n(v.bindingCount, 'binding')}`, size: v.publisherServices + v.bindingCount, problems: v.problems + (prior.get(v.key) ?? 0) });
  }
  const unfed = new Set(views.flatMap((v) => v.bindings.filter((b) => b.noPublisher).map((b) => `${b.queueKey}\u0000${b.service}/${b.id}`)));
  const cmds = commands(g);
  const replies = new Map<string, { patterns: Set<string>; commands: Set<string> }>();
  for (const e of g.model.egress) {
    const r = rpcOf(e);
    if (!r?.replyTo) continue;
    const x = replies.get(e.service) ?? replies.set(e.service, { patterns: new Set(), commands: new Set() }).get(e.service)!;
    x.patterns.add(r.replyTo); x.commands.add(r.command);
  }

  const queues = new Map<string, (typeof g.model.channels)[number]>(); // one row per queue, however many services declare it; the infra declaration wins
  for (const c of g.model.channels) {
    if (c.kind === 'amqp-queue' && (!queues.has(c.bindKey) || g.services.get(c.service)?.kind === 'infra')) queues.set(c.bindKey, c);
  }
  for (const c of queues.values()) {
    const name = c.bindKey.replace(/^amqp-queue:/, ''), label = c.name ?? name;
    const role = String(c.details?.role ?? '');
    if (role === 'rpc-command') {
      const mine = cmds.filter((x) => x.queue === label || x.queue === name);
      const server = mine.find((x) => x.server)?.server?.service ?? c.service;
      out.push({ type: 'channel', id: c.bindKey, label, kind: 'rpc-command-queue', group: c.bindKey, team: team(server, c.service), plumbing: true, size: 0, problems: 0,
        connections: mine.length ? `carries ${n(mine.length, 'command')} of ${server}: ${some(mine.map((x) => x.command), 2)}` : `command queue of ${server}` });
      continue;
    }
    if (role === 'rpc-reply') { out.push({ type: 'channel', id: c.bindKey, label, kind: 'rpc-reply-queue', group: c.bindKey, team: team(c.service), plumbing: true, size: 0, problems: 0, connections: 'reply queue of an RPC caller' }); continue; }
    const bound = g.model.bindings.filter((b) => b.to === c.bindKey);
    const consumers = g.model.ingress.filter((i) => i.bindKey === c.bindKey);
    const sent = g.model.egress.some((e) => e.bindKey === c.bindKey);
    const keys = [...new Set(bound.map((b) => bindingKeyOf(b)))];
    const dead = bound.length > 0 && !sent && bound.every((b) => unfed.has(`${c.bindKey}\u0000${b.service}/${b.id}`));
    out.push({ type: 'channel', id: c.bindKey, label, kind: 'amqp-queue', group: c.bindKey, team: team(consumers[0]?.service, c.service), size: bound.length + consumers.length, problems: (dead ? 1 : 0) + (prior.get(c.bindKey) ?? 0),
      connections: [keys.length ? `bound by ${some(keys, 2)}` : sent ? 'sent to directly' : 'not bound', n(consumers.length, 'consumer'), dead ? 'no harvested publisher' : null].filter(Boolean).join(', ') });
  }
  for (const [service, x] of replies) {
    out.push({ type: 'channel', id: `rpc-reply:${service}`, label: [...x.patterns][0].replace(/\{[^}]*\}/g, '*'), kind: 'rpc-reply-queues', team: team(service), plumbing: true, size: 0, problems: 0, open: { service },
      connections: `replies to ${service}'s ${n(x.commands.size, 'command')}, one exclusive queue per process` });
  }
  for (const c of cmds) {
    const parts = [c.server ? `served by ${c.server.service}` : 'no harvested server', c.callers.length ? `called by ${c.callers.slice(0, 3).join(', ')}${c.callers.length > 3 ? `, +${c.callers.length - 3} more` : ''}` : 'no harvested caller'];
    out.push({ type: 'rpc', id: `amqp-rpc:${c.command}`, label: c.command, kind: 'amqp-rpc', team: team(c.server?.service, c.callers[0]), size: c.callers.length + (c.server ? 1 : 0),
      problems: !c.server ? 1 : 0, // called, but nothing harvested serves it; a command nobody calls is not a problem
      connections: parts.join(', '), open: { service: c.server?.service ?? c.callers[0], ...(c.server ? { ingress: c.server.ingress } : {}) } });
  }
  return out;
}
