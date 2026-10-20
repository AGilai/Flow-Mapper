// One key template of the instance page: the summary row (template, db, commands, ops/h, TTL, other readers)
// and its in-place detail (why it is a problem, the flows that write it, the services that only read it).
// The detail is built when the row is first opened, so a list of thousands stays cheap.

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

function detail(r) {
  const writes = r.flows.filter((f) => f.access !== 'read'), reads = r.flows.filter((f) => f.access === 'read');
  const readIn = (s) => reads.find((f) => f.step.service === s);
  return h('div.ri-detail', problem(r),
    r.writers.length ? h('div', h('h4', writes.length ? `Written by ${plural(writes.length, 'flow')}` : 'Written by no flow we can show'),
      writes.length ? writes.map(flowRow)
        : h('p.small.muted', 'No step names this key. A resource step with details.keyTemplate links the flows that write it.')) : null,
    r.readers.length ? h('div', h('h4', r.writers.length ? `Read by ${plural(r.readers.length, 'other service')}, not owners` : `Read by ${plural(r.readers.length, 'service')}`),
      h('div.ri-also', r.readers.map((u) => h('span', serviceLink(u.service), ` · ${u.commands.join(', ') || u.access}${u.opsPerHour != null ? ` · ${opsText(u.opsPerHour)} ops/h` : ''}`,
        readIn(u.service) ? [' · in ', h('a', { href: flowHref(readIn(u.service)) }, readIn(u.service).ingress)] : null)))) : null);
}

/** `r`: a row of the keys API. Returns the <details> element (open it with `.open = true`). */
export function keyRow(r) {
  const ttl = r.ttl.disagree ? h('span', h('span.ri-chip.warn', `${new Set(r.ttl.values.map((v) => v.ttlSeconds)).size} TTLs`))
    : r.ttl.seconds != null ? h('span.ri-num.ri-nw', ttlText(r.ttl.seconds))
    : h('span.ri-muted', r.writers.length ? '—' : 'unknown');
  const readers = r.readers.length ? h('span.ri-readers', r.readers.map((u) => serviceLink(u.service)))
    : h('span.ri-readers.ri-muted', r.writers.length > 1 ? 'only the writers' : r.writers.length ? 'only the owner' : '');
  const el = h('details.ri-k', { 'data-key': r.keyTemplate, 'data-db': String(r.dbIndex) },
    h('summary', h('span'), h('span.ri-key', r.keyTemplate), h('span.ri-db', `db${r.dbIndex}`),
      h('span.ri-cmds', r.commands.map((c) => h('span.ri-cmd', { class: r.writeCommands.includes(c) ? 'w' : '' }, c))),
      h('span.ri-num', opsText(r.opsPerHour)), ttl, readers));
  let built = false;
  el.addEventListener('toggle', () => { if (el.open && !built) { built = true; el.append(detail(r)); } });
  return el;
}
