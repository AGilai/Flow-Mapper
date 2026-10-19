// Formatting and small shared renderers.

import { h } from './dom.js';

export const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
export const num = (x) => (x ?? 0).toLocaleString('en-US');

export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Transport chip. t: http | sns | sqs | amqp | cron | broken | async */
export const chip = (t, label = t) => h('span.chip', { 'data-t': t }, label);

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
export function splitKey(key) {
  const i = key.indexOf(':');
  return i > 0 ? { transport: key.slice(0, i), rest: key.slice(i + 1) } : { transport: '', rest: key };
}
