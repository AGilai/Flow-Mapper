// Drawing of the decision rows (flow-decision-rows.js, 0.38.0): a divider row carries the dropdown of the arms (and "Both") right in the diagram;
// a caption row names an arm when both are drawn; a 3 px marker per arm runs in the left gutter. The controls are HTML in a foreignObject, so the
// zoom scales them with the lane. CSS: css/flow-scenario.css (tokens only).

import { s, h } from '../dom.js';
import { icon } from '../icons.js';
import { guardText, srcText } from './flow-decision-rows.js';

export const DEC_X = 30, MARK_X = 4, MARK_STEP = 9;
const clip = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));
const armLabel = (d, arm) => d.arms.find((a) => a.arm === arm)?.label ?? arm;

/** Why a decision is fixed: "fixed by the caller: member.source = 'idp'". */
export const lockReason = (d) => `fixed by the caller${d.guard?.text && d.lock?.literal != null ? `: ${clip(d.guard.text, 40)} = '${d.lock.literal}'` : ''}`;

/** The badge (and tooltip) of a decision that depends on data: the guard's text and file:line. */
export const depBadge = (d) => (d.depends_on === 'data' ? h('span.dec-dep', { title: guardText(d) || 'The arm depends on the data at run time', tabindex: 0 }, 'depends on data') : null);

/** The dropdown of one decision (or its locked, read-only form). */
export function armSelect(d, onChoose, { id = null } = {}) {
  if (d.lock) return h('span.dec-sel.lock', { tabindex: 0, role: 'note', title: `${lockReason(d)} ${srcText(d.lock.source)}`.trim(), 'aria-label': `Fixed to ${armLabel(d, d.lock.arm)}. ${lockReason(d)}` }, icon('lock'), h('span.v', armLabel(d, d.lock.arm)));
  const differs = (d.chosen ?? d.arms[0]?.arm) !== d.arms[0]?.arm;
  const sel = h('select.dec-sel', { id, 'data-g': d.group_id, 'aria-label': `${d.name}: which arm`, class: differs ? 'set' : '', title: d.name, on: { change: (ev) => onChoose(d.group_id, ev.target.value) } },
    d.arms.map((a) => h('option', { value: a.arm, selected: d.chosen === a.arm }, a.label ?? a.arm)), h('option', { value: 'both', selected: d.chosen === 'both' }, 'Both (either / or)'));
  return sel;
}

/** One decision row at baseline `y0`. geo: { width, onChoose(group, arm), srcUrl(at) -> url | null }. */
export function decisionSvg(e, y0, { width, onChoose, srcUrl }) {
  const d = e.decision, x = DEC_X + (e.level ? 14 : 0), hh = e.kind === 'caption' ? 24 : 32, box = (kids, cls) => s('foreignObject', { x, y: y0 - hh / 2, width: Math.max(80, width - x - 10), height: hh }, h('div.dec-row', { class: cls, on: { click: (ev) => ev.stopPropagation(), keydown: (ev) => ev.stopPropagation(), dblclick: (ev) => ev.stopPropagation(), contextmenu: (ev) => ev.stopPropagation() } }, kids));
  if (e.kind === 'caption') {
    const a = d.arms.find((x) => x.arm === e.arm);
    return s('g', { class: `dec dec-caption ar-${(e.level * 2 + e.k) % 4}` }, box([h('b.dec-arm', { title: a?.label ?? e.arm }, a?.label ?? e.arm), a?.guard_text ? h('span.dec-g', { title: a.guard_text }, a.guard_text) : null], 'cap'));
  }
  const src = d.lock ? srcText(d.lock.source) : '', url = d.lock ? srcUrl?.(d.lock.at) : null;
  const kids = [h('span.dec-k', e.level ? h('span.dec-nest', '└ ') : null, e.both ? 'either / or' : 'decision'), armSelect(d, onChoose), depBadge(d),
    h('span.dec-t', { title: [d.name, d.template_name !== d.name ? d.template_name : null].filter(Boolean).join('\n') }, d.lock ? `${lockReason(d)} · ` : '', d.lock && src ? (url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, src) : src) : null, d.lock ? ' · ' : null, d.name)];
  return s('g', { class: `dec dec-divider${e.level ? ' nested' : ''}${e.both ? ' both' : ''}` }, s('line', { class: 'dec-line', x1: DEC_X - 4, x2: width, y1: y0, y2: y0 }), box(kids, 'div'));
}

/** The gutter markers (3 px, one per arm; a nested decision's arms use the second lane). spans: armSpans(events); top: row -> y. */
export function armMarks(spans, top) {
  return s('g', { class: 'armmarks', 'aria-hidden': 'true' }, spans.map((m) => s('rect', { class: `armmark ar-${(m.level * 2 + m.k) % 4}`, x: MARK_X + m.level * MARK_STEP, y: top[m.row0] + 3, width: 3, height: Math.max(6, top[m.row1 + 1] - top[m.row0] - 6), rx: 1.5 }, s('title', {}, armLabel(m.decision, m.arm)))));
}
