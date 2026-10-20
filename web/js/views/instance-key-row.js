// One key template in a service's card on the instance page: the summary row (template, db, commands, ops/h, TTL,
// and the other readers, or the owner when the service only reads) and its in-place detail (why it is a problem, this
// service's flows that touch it, the other services that read it). A row with a problem starts open.

import { h } from '../dom.js';
import { href } from '../router.js';
import { ttlText, opsText } from '../format.js';
import { serviceLink } from './inventory-links.js';

const flowHref = (f) => href('/flows', { service: f.service, ingress: f.ingress });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ttlWithHuman = (s) => (ttlText(s) === `${s} s` ? `${s} s` : `${s} (${ttlText(s)})`);

function flowRow(f) {
  return h('div.ri-flow',
    h('div.ri-entry', h('a', { href: flowHref(f) }, f.bindKey), h('span.xs', `${f.service} · ${f.ingress}`)),
    h('div.ri-flowchain', f.chain.map((n) => [h('span.step', n), h('span.ar', '→')]), h('span.step.end', f.operation)));
}

/** TTL disagreement: both claims side by side, the differing values highlighted. */
function claims(r) {
  return r.writers.map((w) => {
    const flow = r.flows.find((f) => f.access !== 'read' && f.step.service === w.service);
    const cmd = (w.commands.find((c) => r.writeCommands.includes(c)) ?? 'SET');
    return h('div.ri-claim', h('span.src', serviceLink(w.service)),
      h('span', w.ttlSeconds != null ? `${cmd} + ` : `${cmd} · `, w.ttlSeconds != null ? h('span.ri-diff', `EX ${ttlWithHuman(w.ttlSeconds)}`) : h('span.ri-muted', 'no TTL set'),
        w.opsPerHour != null ? ` · ${opsText(w.opsPerHour)} ops/h` : '', flow ? [' · ', h('a', { href: flowHref(flow) }, flow.ingress)] : null));
  });
}

function problem(r) {
  const p = r.problem;
  if (!p) return null;
  if (p.kind === 'ttl-disagree') {
    return h('div.ri-problem', h('span.tag', `⚠ ${r.writers.length} writers disagree on the TTL`), claims(r), h('p', h('b', 'What follows: '), p.follows));
  }
  return h('div.ri-problem', h('span.tag', '⚠ Read, but nobody harvested writes it'), h('p', p.why), h('p', h('b', 'What follows: '), p.follows));
}

function detail(r, service, mode) {
  const mine = r.flows.filter((f) => f.step.service === service);
  const writes = mine.filter((f) => f.access !== 'read'), reads = mine.filter((f) => f.access === 'read');
  const others = r.readers.filter((u) => u.service !== service), coWriters = r.writers.filter((u) => u.service !== service);
  const readIn = (s) => r.flows.find((f) => f.access === 'read' && f.step.service === s);
  if (mode === 'reads') {
    return h('div.ri-detail', problem(r),
      h('div', h('h4', reads.length ? `Read in ${plural(reads.length, 'flow')} of ${service}` : `Read by ${service}`),
        reads.length ? reads.map(flowRow) : h('p.small.muted', 'No step names this key, so no flow is shown. A resource step with details.keyTemplate links the flows that read it.')),
      r.writers.length ? h('p.small.muted', 'Written by ', r.writers.map((w, i) => [i ? ', ' : '', h('b', w.service)]), '. Open the owner\'s card for its flows.') : null);
  }
  return h('div.ri-detail', problem(r),
    h('div', h('h4', writes.length ? `Written by ${plural(writes.length, 'flow')} of ${service}` : `Written by no flow of ${service} we can show`),
      writes.length ? writes.map(flowRow) : h('p.small.muted', 'No step names this key. A resource step with details.keyTemplate links the flows that write it.')),
    coWriters.length && r.problem?.kind !== 'ttl-disagree' ? h('p.small.muted', 'Also written by ', coWriters.map((w, i) => [i ? ', ' : '', serviceLink(w.service)]), '.') : null,
    others.length ? h('div', h('h4', `Read by ${plural(others.length, 'other service')}`),
      h('div.ri-also', others.map((u) => h('span', serviceLink(u.service), ` · ${u.commands.join(', ') || u.access}${u.opsPerHour != null ? ` · ${opsText(u.opsPerHour)} ops/h` : ''}`,
        readIn(u.service) ? [' · in ', h('a', { href: flowHref(readIn(u.service)) }, readIn(u.service).ingress)] : null)))) : null);
}

/** Column heads of a card section; `mode` is 'writes' or 'reads'. */
export const keyHead = (mode) => h('div.ri-kgrid.ri-hd', h('span'), h('span', 'Key template'), h('span', 'DB'), h('span', 'Commands'), h('span', 'Ops/h'), h('span', 'TTL'), h('span', mode === 'reads' ? 'Owner' : 'Also read by'));

/** `r`: a row of the keys API, in the card of `service`. `onOpen(owner, row)` opens another service's card at that row.
 *  Returns the <details> element (open it with `.open = true`). */
export function keyRow(r, { service, mode, onOpen }) {
  const ttl = r.ttl.disagree ? h('span', h('span.ri-chip.warn', `${new Set(r.ttl.values.map((v) => v.ttlSeconds)).size} TTLs`))
    : r.ttl.seconds != null ? h('span.ri-num.ri-nw', ttlText(r.ttl.seconds))
    : h('span.ri-muted', r.writers.length ? '—' : 'unknown');
  const others = r.readers.filter((u) => u.service !== service);
  const last = mode === 'reads'
    ? (r.writers.length ? h('span.ri-readers', r.writers.map((w) => h('a', { href: '#', title: `Open ${w.service}'s keys`, on: { click: (e) => { e.preventDefault(); e.stopPropagation(); onOpen(w.service, r); } } }, w.service)))
      : h('span.ri-readers', h('span.ri-chip.warn', 'no harvested writer')))
    : others.length ? h('span.ri-readers', others.map((u) => serviceLink(u.service)))
    : h('span.ri-readers.ri-muted', r.writers.length > 1 ? 'only the writers' : 'only the owner');
  const el = h('details.ri-k', { 'data-key': r.keyTemplate, 'data-db': String(r.dbIndex) },
    h('summary', h('span'), h('span.ri-key', r.keyTemplate), h('span.ri-db', `db${r.dbIndex}`),
      h('span.ri-cmds', r.commands.map((c) => h('span.ri-cmd', { class: r.writeCommands.includes(c) ? 'w' : '' }, c))),
      h('span.ri-num', opsText(r.opsPerHour)), ttl, last));
  let built = false;
  const build = () => { if (!built) { built = true; el.append(detail(r, service, mode)); } };
  el.addEventListener('toggle', () => { if (el.open) build(); });
  if (r.problem) { el.open = true; build(); }
  return el;
}
