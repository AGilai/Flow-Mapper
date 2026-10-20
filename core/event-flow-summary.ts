// The one-sentence verdict and the problem callouts of an event page, written from the flow. Rows that
// a subscription filters out are not counted: as far as this page goes, that queue is not subscribed.

import type { EventRow, EventTarget, ProducerGroup, UnresolvedSend } from './event-flow.ts';
import type { Callout, Segment, Summary } from './channel-summary.ts';

interface Input { type: string; groups: ProducerGroup[]; unresolved: UnresolvedSend[]; unfed: EventTarget[] }

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const uniq = <T>(xs: T[]) => [...new Set(xs)];
const shown = (r: EventRow) => r.outcome !== 'filtered';
const rowsOf = (gs: ProducerGroup[]) => gs.flatMap((p) => p.targets.flatMap((t) => t.rows.filter(shown)));
const reads = (r: EventRow) => r.outcome === 'handled' || r.outcome === 'no-handler';

export function eventFlowSummary(i: Input): Summary {
  const seg: Segment[] = [];
  const t = (s: string, b = false) => seg.push(b ? { t: s, b } : { t: s });
  const sure = i.groups.filter((p) => !p.possible);
  const maybe = i.groups.filter((p) => p.possible);

  if (!i.groups.length) {
    const handlers = uniq(i.unfed.flatMap((x) => x.rows.map((r) => r.consumer!)));
    t(`Nothing harvested publishes ${i.type}`);
    if (handlers.length) { t(', but '); t(plural(handlers.length, 'service'), true); t(` ${handlers.length === 1 ? 'handles' : 'handle'} it`); }
    t('.');
  } else if (!sure.length) {
    t(`No service is known to publish ${i.type}; `);
    t(list(maybe.map((p) => p.producer)), true);
    t(` ${maybe.length === 1 ? 'may' : 'can'}, if ${maybe.length === 1 ? 'it picks' : 'they pick'} this type at runtime.`);
  } else {
    t(sure.length > 2 ? plural(sure.length, 'service') : list(sure.map((p) => p.producer)), true);
    t(sure.length === 1 ? ' publishes it' : ' publish it');
    const targets = sure.flatMap((p) => p.targets);
    const topics = uniq(targets.flatMap((x) => (x.topic ? [x.topic.name] : [])));
    const direct = uniq(targets.filter((x) => x.direct).flatMap((x) => x.rows.filter(shown).map((r) => r.queue?.key ?? r.consumer)));
    const dest: [string, boolean][] = [];
    if (topics.length) dest.push([topics.length > 2 ? plural(topics.length, 'topic') : list(topics), true]);
    if (direct.length) dest.push([direct.length === 1 ? 'one queue' : `${direct.length} queues`, false]);
    if (dest.length) {
      t(' to ');
      dest.forEach(([s, b], k) => { if (k) t(' and straight to '); t(s, b); });
    }
    const mine = rowsOf(sure).filter(reads);
    const services = uniq(mine.map((r) => r.consumer!));
    const queues = uniq(mine.flatMap((r) => (r.queue ? [r.queue.key] : [])));
    if (!dest.length) t(', but the harvester could not tell where to');
    else if (services.length) {
      t('. It reaches '); t(plural(services.length, 'service'), true);
      if (queues.length) { t(' through '); t(plural(queues.length, 'queue')); }
    } else if (rowsOf(sure).some((r) => r.outcome === 'no-reader')) t(', but no harvested service reads it');
    else t(', but no subscription lets it through');
    t('.');
    const reached = new Set(services);
    const extra = uniq(rowsOf(i.groups).filter((r) => r.outcome === 'possible').map((r) => r.consumer!)).filter((s) => !reached.has(s));
    if (maybe.length) {
      t(' '); t(list(maybe.map((p) => p.producer)), true); t(' may also send it');
      t(extra.length ? `, which would reach ${extra.length} more.` : '.');
    }
  }

  const callouts: Callout[] = [];
  const seen = new Set<string>();
  for (const p of sure) for (const x of p.targets) for (const r of x.rows) {
    if (r.outcome !== 'no-handler') continue;
    const k = `${r.consumer}\u0000${r.queue?.key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const ing = r.ingresses.find((n) => n.outcome === 'no-handler')!.id;
    callouts.push({ text: `${r.consumer} receives it${r.queue ? ` on ${r.queue.name}` : ''} but has no handler for it, so the message is read and dropped. Add it to ${ing} or filter it out of the subscription.`, rowId: r.id, level: 'warn' });
  }
  for (const u of i.unresolved) callouts.push({ text: `${u.service} publishes it from ${u.egress}, but the harvester could not tell where to: ${u.reason}. It reaches no one we know of.`, rowId: null, level: 'warn' });
  return { text: seg.map((s) => s.t).join(''), segments: seg, callouts };
}
