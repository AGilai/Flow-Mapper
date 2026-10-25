// #85: the SVG of an incomplete flow (frame 22): the frontier marker as a button, a blocked row (amber tint and stripe, the call and why, a stub that stops),
// and the reserved "inferred (LLM)" tag. Colours and dash rhythms are in css/incomplete.css (tokens only).

import { s } from '../dom.js';
import { blockedCall, blockedLine, frontierParts, INFERRED_TAG, INFERRED_TIP } from './incomplete-pure.js';

export const BLOCKED_H = 48;          // a blocked row is taller: two text lines and the stub
export const BLOCKED_LINE = { icall: 20, unresolved: 28 }; // where the row's line sits (as flow-draw-layout LINE for these types)
const CH = 6.4, clip = (t, room) => (t.length > room ? `${t.slice(0, Math.max(1, room - 1))}…` : t);

/** Is this lane event a blocked step (`gap: true`)? Only those get the treatment. */
export const isBlockedEvent = (e) => !!e.msg?.blocked && (e.type === 'icall' || e.type === 'unresolved');

/** The frontier marker: a button (24 px, chevron, "frontier: N steps" and, when some are blocked, "· M blocked" in amber ink). Clicking it draws the steps. */
export function frontierSvg(e, r, x0, y0, y1 = y0) {
  const m = e.msg, p = frontierParts(m.frontierSteps ?? 0, m.frontierBlocked ?? 0), full = p.base + p.blocked, w = Math.ceil(full.length * 6.2) + 34, bx = x0 + 10;
  return s('g', { class: `msg frontier${m.frontierBlocked ? ' has' : ''}`, 'data-e': r, tabindex: 0, role: 'button', 'aria-expanded': 'false', 'aria-label': `${full}. Show the steps` },
    s('path', { class: 'stub', d: `M${x0} ${y0} h10` }),
    s('rect', { class: 'fbtn', x: bx, y: y0 - 12, width: w, height: 24, rx: 5 }),
    s('path', { class: 'fchev', d: `M${bx + 10} ${y0 - 4}l4 4-4 4` }),
    s('text', { class: 'flab', x: bx + 22, y: y0 + 4 }, p.base, p.blocked ? s('tspan', { class: 'fbl' }, p.blocked) : null),
    s('text', { class: 'fhint', x: bx + w + 8, y: y0 + 4 }, 'click to expand'),
    s('rect', { class: 'hit', x: x0, y: y0 - 14, width: w + 130, height: 28 }),
    s('title', {}, `${full}. Click to draw the folded steps (the "Frontier steps" switch).`));
}

/** The amber parts of a blocked row: tint and stripe over the whole row (drawn first, under everything). */
export const blockedBand = (y0, width, line) => [s('rect', { class: 'btint', x: 0, y: y0 - line, width, height: BLOCKED_H }), s('rect', { class: 'bstripe', x: 0, y: y0 - line, width: 3, height: BLOCKED_H })];
/** A short dotted stub from the lifeline that ends in a stop bar: it goes nowhere on purpose. */
export const blockedStub = (x0, y) => s('g', { class: 'bstub' }, s('path', { d: `M${x0} ${y}h34` }), s('path', { class: 'bstop', d: `M${x0 + 34} ${y - 4}v8` }));

/** Two lines at the lifeline: the call in mono, then "blocked: <plain>"; one line each, cut with an ellipsis, the full text in the title. */
export function blockedLines(e, x, y0, width) {
  const m = e.msg, call = blockedCall(m.blocked, m.label), why = blockedLine(m.blocked, m.gap), room = Math.max(8, Math.floor((width - x - 16) / CH));
  return [s('text', { class: 'bl1', x, y: y0 - 4 }, clip(call, room)), s('text', { class: 'bl2', x, y: y0 + 11 }, s('tspan', { class: 'bw' }, 'blocked:'), ` ${clip(why.slice(9), room - 9)}`), s('title', {}, `${call}\n${why}`)];
}

/** A blocked internal call (a frontier step, or any call inside a service): tint, call and reason, stub. */
export function blockedIcall(e, g, y0, { barX, width }) {
  const x0 = barX(e.bar, 1);
  return g('icall blocked', ...blockedBand(y0, width, BLOCKED_LINE.icall), ...blockedLines(e, x0 + 62, y0, width), blockedStub(x0, y0 + 21), s('rect', { class: 'hit', x: x0 - 6, y: y0 - 18, width: Math.max(60, width - x0 - 12), height: BLOCKED_H - 4 }));
}

/** The "inferred (LLM)" tag (reserved): a dashed accent chip; `cx` its left edge. */
export const inferredTag = (x, y0) => { const w = Math.ceil(INFERRED_TAG.length * 5.6) + 12; return s('g', { class: 'inf-tag' }, s('rect', { x, y: y0 + 6, width: w, height: 15, rx: 4 }), s('text', { x: x + 6, y: y0 + 17 }, INFERRED_TAG), s('title', {}, INFERRED_TIP)); };

/** How far right of its lifeline a blocked row text reaches (the lane is widened to hold it, up to 70 characters). */
export const blockedNeed = (e) => 74 + Math.min(70, Math.max(blockedCall(e.msg.blocked, e.msg.label).length, blockedLine(e.msg.blocked, e.msg.gap).length)) * 6.6;

/** How far right of its lifeline the folded frontier button reaches (button and its hint). */
export const frontierNeed = (e) => 10 + Math.ceil((frontierParts(e.msg.frontierSteps ?? 0, e.msg.frontierBlocked ?? 0).base.length + (e.msg.frontierBlocked ? 12 : 0)) * 6.2) + 34 + 110;
