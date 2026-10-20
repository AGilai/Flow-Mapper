// The one-sentence summary and the problem callouts of a channel page, written from the flow rows and
// the delivery grid. Plain wording for the reader; every callout that is about a row names its id.

import type { Cell, DeliveryGrid, FlowRow, Publisher } from './channel-flow.ts';
import { filterLabel } from './glob.ts';

export interface Segment { t: string; b?: boolean }
export interface Callout { text: string; /** id of the flow row it is about */ rowId: string | null; level: 'warn' | 'bad' | 'info' }
export interface Summary { text: string; segments: Segment[]; callouts: Callout[] }

interface Input {
  name: string; kind: string; layout: 'fanout' | 'inbound'; rows: FlowRow[]; grid: DeliveryGrid; publishers: Publisher[]; unbound: string[];
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/** Up to 3 names, then "and N more". */
const some = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more` : list(xs));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const NOUN: Record<string, string> = { 'sns-topic': 'topic', 'eventbridge-bus': 'bus', 'amqp-exchange': 'exchange' };

function sentence(i: Input): Segment[] {
  const seg: Segment[] = [];
  const t = (s: string, b = false) => seg.push(b ? { t: s, b } : { t: s });
  const consumers = [...new Set(i.grid.destinations.flatMap((d) => (d.consumer ? [d.consumer.service] : [])))];
  if (i.layout === 'inbound') {
    const topics = [...new Set(i.rows.filter((r) => r.from).map((r) => r.from!.name))];
    const direct = [...new Set(i.rows.flatMap((r) => r.direct.map((p) => p.service)))];
    const allTopics = i.rows.every((r) => !r.from || r.from.kind === 'sns-topic');
    if (topics.length) { t('Fed by '); t(topics.length > 3 ? plural(topics.length, allTopics ? 'topic' : 'source') : list(topics), true); }
    if (direct.length) { t(topics.length ? ' and receives messages straight from ' : 'Receives messages straight from '); t(some(direct), true); }
    if (!topics.length && !direct.length) t('Nothing harvested feeds this queue yet');
    if (consumers.length) { t(', read by '); t(some(consumers), true); } else t(', and no harvested service reads it yet');
    t('.');
    return seg;
  }
  const noun = NOUN[i.kind] ?? 'channel';
  const pubs = [...new Set(i.publishers.map((p) => p.service))];
  const n = i.grid.rows.filter((r) => !r.possible).length;
  const maybe = i.grid.rows.length - n;
  if (!pubs.length) t('No harvested service publishes here yet');
  else {
    t(pubs.length > 2 ? plural(pubs.length, 'service') : list(pubs), true);
    t(pubs.length === 1 ? ' publishes ' : ' publish ');
    if (n) { t(plural(n, 'event type'), true); t(' here'); if (maybe) t(`, and possibly ${maybe} more`); }
    else if (maybe) { t('here, possibly '); t(plural(maybe, 'event type'), true); }
    else t('here, but its event types are not listed');
  }
  if (!i.rows.length) { t('.'); return seg; }
  const queues = i.rows.every((r) => /queue/.test(r.to.kind));
  t(`; the ${noun} fans out to `);
  t(plural(i.rows.length, queues ? 'queue' : 'target'), true);
  const eachOne = i.rows.length > 1 && i.rows.every((r) => new Set(r.consumers.map((c) => c.service)).size === 1) && consumers.length === i.rows.length;
  if (eachOne) t(', each read by one service');
  else if (consumers.length) { t(', read by '); t(plural(consumers.length, 'service'), true); }
  const unread = i.rows.filter((r) => !r.consumers.length).length;
  if (unread) t(`${consumers.length || eachOne ? '; ' : ', '}${unread === 1 ? 'one has' : `${unread} have`} no harvested reader yet`);
  t('.');
  return seg;
}

export function flowSummary(i: Input): Summary {
  const segments = sentence(i);
  const callouts: Callout[] = [];
  const subject = (r: FlowRow) => (i.layout === 'fanout' ? r.to.name : r.from?.name ?? r.to.name);
  const eventsWhere = (d: number, test: (c: Cell) => boolean) => i.grid.rows.filter((r) => test(r.cells[d])).map((r) => r.type);

  // Rows whose declarations disagree.
  for (const row of i.rows) {
    if (!row.filter || row.filter.agree) continue;
    const names = list([...new Set(row.filter.declarations.map((d) => d.service))]);
    const labels = [...new Set(row.filter.declarations.map((d) => filterLabel(d.events)))];
    const head = `${subject(row)}: ${names} disagree on the filter`;
    const noHandler: string[] = [];
    const maybe = new Set<string>();
    i.grid.destinations.forEach((dest, d) => {
      if (dest.rowId !== row.id && i.layout === 'fanout') return;
      const evs = eventsWhere(d, (c) => c.uncertain && !c.possible);
      evs.forEach((e) => maybe.add(e));
      const nh = eventsWhere(d, (c) => c.uncertain && !c.possible && c.status === 'no-handler');
      if (nh.length && dest.consumer) noHandler.push(`${some(nh)} may reach ${dest.consumer.service}, which has no handler for ${nh.length === 1 ? 'it' : 'them'}`);
    });
    const tail = noHandler.length ? `, so ${list(noHandler)}.`
      : maybe.size ? `, so ${some([...maybe])} may or may not be delivered.`
      : ` (${list(labels)}). It makes no difference to the event types published today.`;
    callouts.push({ text: head + tail, rowId: row.id, level: noHandler.length || maybe.size ? 'warn' : 'info' });
  }

  // Events that arrive where nothing handles them, for sure.
  i.grid.destinations.forEach((dest, d) => {
    if (!dest.consumer) return;
    const evs = eventsWhere(d, (c) => !c.uncertain && !c.possible && c.status === 'no-handler');
    if (!evs.length) return;
    const prefix = i.layout === 'fanout' && dest.queue ? `${dest.queue.name}: ` : '';
    callouts.push({ text: `${prefix}${some(evs)} ${evs.length === 1 ? 'reaches' : 'reach'} ${dest.consumer.service}, which has no handler for ${evs.length === 1 ? 'it' : 'them'}.`, rowId: dest.rowId || null, level: 'bad' });
  });

  // Published, but every subscription filters it out.
  if (i.layout === 'fanout' && i.grid.destinations.length) {
    const lost = i.grid.rows.filter((r) => !r.possible && r.cells.every((c) => c.status === 'filtered')).map((r) => r.type);
    if (lost.length) callouts.push({ text: `${some(lost)} ${lost.length === 1 ? 'is' : 'are'} published here, but no subscription lets ${lost.length === 1 ? 'it' : 'them'} through.`, rowId: null, level: 'warn' });
  }
  // The resolver's terse reasons, in the reader's words. A queue nobody reads is already in the sentence.
  const NOUN_OF: Record<string, string> = { 'topic has no subscription': 'topic', 'exchange has no binding': 'exchange' };
  for (const reason of i.unbound) {
    if (reason === 'queue has no consumer') continue;
    if (reason === 'bus has no rule') callouts.push({ text: 'No rule sends events from this bus anywhere yet, so events published here are not delivered.', rowId: null, level: 'warn' });
    else if (NOUN_OF[reason]) callouts.push({ text: `Nothing subscribes to this ${NOUN_OF[reason]} yet, so events published here are not delivered anywhere. The subscribing service's harvester may be missing.`, rowId: null, level: 'warn' });
    else callouts.push({ text: reason, rowId: null, level: 'warn' });
  }
  return { text: segments.map((s) => s.t).join(''), segments, callouts };
}
