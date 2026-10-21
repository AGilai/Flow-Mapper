// Formatting and small shared renderers.

import { h } from './dom.js';

export const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
export const num = (x) => (x ?? 0).toLocaleString('en-US');

/** A TTL in seconds the way people say it: 45 s, 15 min, 1 h, 24 h; seconds when it does not divide evenly (1500 s = 25 min, 100 s). */
export function ttlText(s) {
  if (s == null) return '';
  if (s >= 3600 && s % 3600 === 0) return `${s / 3600} h`;
  if (s >= 120 && s % 60 === 0) return `${s / 60} min`;
  return `${s} s`;
}
/** Operations per hour, short: 310, 4.2k, 220k. */
export const opsText = (n) => (n == null ? '' : n >= 100000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(Math.round(n)));

export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Text with `backticked` parts in mono (keys, commands). */
export const monoText = (s) => String(s).split('`').map((t, i) => (i % 2 ? h('span.ex-key', t) : t));

/** Transport chip. t: http | sns | sqs | amqp | cron | broken | async */
export const chip = (t, label = t === 'undecided' ? 'transport not decided' : t) => h('span.chip', { 'data-t': t }, label);

export const coverageBar = (x) => {
  if (x == null) return h('span.muted.small', 'no egress');
  const cls = x >= 0.98 ? '' : x >= 0.9 ? 'mid' : 'low';
  return h('div.row', h('div.bar', h('i', { class: cls, style: { width: `${Math.round(x * 100)}%` } })), h('span.small', pct(x)));
};

export const STATUS_LABEL = {
  open: 'Open', triaged: 'Triaged', in_progress: 'In progress', fixed: 'Fixed', verified: 'Verified',
  closed: 'Closed', wont_fix: "Won't fix", duplicate: 'Duplicate',
};
export const statusPill = (s) => h('span.pill', { class: { fixed: 'ok', verified: 'ok', closed: 'ok', open: 'warn' }[s] ?? '' }, STATUS_LABEL[s] ?? s);
export const priorityPill = (p) => h('span.pill', { class: p, title: `Priority ${p}` }, p);

/** Split "http:GET orders-svc/orders/{id}" → {transport:'http', rest:'GET orders-svc/orders/{id}'} */
/** A key or command as children that may wrap after punctuation (dots, slashes, dashes) and never mid-word. */
export const breakable = (t) => String(t).split(/(?<=[.\-_/:{}])/).flatMap((x, i) => (i ? [h('wbr'), x] : [x]));

export function splitKey(key) {
  const i = key.indexOf(':');
  return i > 0 ? { transport: key.slice(0, i), rest: key.slice(i + 1) } : { transport: '', rest: key };
}

/** Subscription event filter as text: '!x' entries are exclusions ("all except x"), not event names. */
export function filterText(events) {
  if (events === '*') return 'all events';
  const pos = events.filter((e) => !e.startsWith('!'));
  const neg = events.filter((e) => e.startsWith('!') && e.length > 1).map((e) => e.slice(1));
  return [pos.join(', '), neg.length ? `${pos.length ? 'except' : 'all except'} ${neg.join(', ')}` : ''].filter(Boolean).join(' ');
}

/** Chips for an event filter: one per accepted name, plus one "all except ..." chip for exclusions. */
export function filterChips(events) {
  const neg = events.filter((e) => e.startsWith('!') && e.length > 1).map((e) => e.slice(1));
  const pos = events.filter((e) => !e.startsWith('!'));
  return [
    ...pos.map((e) => h('span.ep-producer', h('span.key', e))),
    neg.length ? h('span.ep-producer.except', { title: `Passes every event except: ${neg.join(', ')}` }, pos.length ? 'except ' : 'all except ', h('span.key', neg.join(', '))) : null,
  ];
}

/** Egress group title. `key` is the confirmed targets joined by ', ', or 'Maybe a, b' when only unresolved events could reach them.
 *  Confirmed targets are counted; 'maybe' consumers are shown apart so they never read as confirmed. */
export function egressGroupLabel(key, items) {
  const onlyMaybe = key.startsWith('Maybe ');
  const confirmed = onlyMaybe ? [] : key.split(', ');
  const maybe = onlyMaybe ? key.slice(6).split(', ')
    : [...new Set(items.flatMap((e) => (e.maybeTargets ?? []).map((t) => t.service)))].filter((x) => !confirmed.includes(x));
  if (onlyMaybe && maybe.length === 1) return key;
  const tail = maybe.length ? (confirmed.length ? ` (+${maybe.length} maybe)` : ` (${maybe.length} maybe)`) : '';
  return (confirmed.length === 1 ? confirmed[0] : `Fan-out to ${confirmed.length}${confirmed.length ? ' services' : ''}`) + tail;
}
