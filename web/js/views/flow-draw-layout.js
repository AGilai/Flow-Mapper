// Geometry of a lane drawing: column x per lifeline, y per row, head sizes, alt strips. No DOM here.
// Every other flow-draw-*.js module draws from the object layoutLane returns.

import { altFrames, stripsByRow, STRIP } from './sequence-alt.js';
import { arrowEnds, columnGaps, centres, labelWidth, wrapId, clampLines } from './flow-cols.js';
import { FOLD_W, COL_NARROW, displayCols, foldGroups, planSqueeze } from './flow-squeeze.js';

export const COL = 138, COL_MIN = 132, PAD = 16, GUTTER = 8, BAR = 12, NEST = 8, CH_HEAD = 116; // CH_HEAD: a topic or queue head is narrower than a service head
const ROWH = { call: 46, return: 36, pill: 32, mw: 34, store: 46, hop: 48, unresolved: 42, frontier: 32, amqpnote: 26 };
const rowH = (e) => (e.type === 'hop' && e.marker ? 56 : e.type === 'call' && e.rpc?.chip ? 58 : e.type === 'unresolved' && e.chip ? 56 : ROWH[e.type]); // an RPC's "amqp rpc" chip sits under its arrow
const LINE = { call: 30, return: 22, pill: 16, mw: 17, store: 23, hop: 30, unresolved: 28, frontier: 16, amqpnote: 14 };
const T_VAR = { http: '--t-http', rpc: '--t-rpc', grpc: '--t-http', eventbridge: '--t-eb', sns: '--t-sns', sqs: '--t-sqs', amqp: '--t-amqp', cron: '--t-cron', socket: '--t-socket', undecided: '--ink-2', res: '--t-res' };
export const colorOf = (t) => `var(${T_VAR[t] ?? '--ink-2'})`;
export const SUB_CH = 19, LINE_H = 14, TILE_PX = 6.6;
export const tileW = (t) => Math.max(22, Math.ceil(String(t).length * TILE_PX) + 12);
export const markW = (m) => Math.ceil(m.label.length * (m.kind === 'key' ? 6.9 : 6.4)) + 30; // an exchange's binding key is mono
export const FUNNEL = 'M1.5 2h9L7 6.3V10l-2-1V6.3z';

/** layoutLane(lane, fit, sq) -> every measure the drawing needs; `fit`: the width the diagram has (0 = no limit); sq: { keep: [column index] } turns Squeeze on (flow-squeeze.js). */
export function layoutLane(lane, fit = 0, sq = null) {
  const { columns, events, bars } = lane;
  // Each gap between lifelines grows to fit the longest arrow label that crosses it: a label is never cut.
  const idx = new Map(columns.map((c, i) => [c, i]));
  const isCh = (c) => c.kind === 'channel', headW = (c, col) => (isCh(c) ? CH_HEAD : col - 8);
  // The room right of a queue for its number tiles (or "no reader"): the next lifeline in that direction must clear it.
  const endW = (e) => (e.end ? (e.end.none ? e.end.none.length * 8 + 36 : e.end.tiles.reduce((n, t) => n + tileW(t.text) + 4, 0)) + 14 : 0);
  // A publish is one arrow: the event type sits on its first part (service -> topic), the filter marker on the second (topic -> queue). Branch rows carry the marker only.
  const hopSpans = (e) => {
    const a = idx.get(e.from), b = idx.get(e.to), v = e.via ? idx.get(e.via) : null, lab = e.trunk ? labelWidth(e.sub ? `${e.label} ${e.sub}` : e.label) + 8 + BAR + 2 * NEST : 0, mk = e.marker ? markW(e.marker) + 16 : 0;
    return v == null ? [{ a, b, need: Math.max(lab, mk) }] : [{ a, b: v, need: lab }, { a: v, b, need: mk }];
  };
  const spans = events.flatMap((e) => {
    const ends = e.type === 'hop' ? [e.from, e.to] : arrowEnds(e);
    if (!ends) return [];
    const a = idx.get(ends[0]), b = idx.get(ends[1]), out = e.type === 'hop' ? hopSpans(e) : [{ a, b, need: labelWidth(e.label) + 8 + BAR + 2 * NEST }];
    if (e.end) { const n = b + (Math.sign(b - a) || 1); if (n >= 0 && n < columns.length) out.push({ a: b, b: n, need: endW(e) + 14 }); }
    return out;
  });
  // `fit`: the room the diagram has. The plain gap shrinks (to COL_MIN) until everything shows without scrolling; topic and queue gaps stay.
  // Still too wide and Squeeze on: lifelines fold into fold columns (flow-squeeze.js); a fold is FOLD_W wide and an arrow into it stops at its left edge.
  const layout = (col, folded, fw = FOLD_W) => {
    const dc = displayCols(columns.length, folded), di = new Map();
    dc.forEach((d, k) => d.cols.forEach((c) => di.set(c, k)));
    const hw = (d) => (d.fold ? fw : headW(columns[d.cols[0]], col)), room = (c) => (folded.has(c) ? fw / 2 : 0);
    const dsp = spans.map((p) => ({ a: di.get(p.a), b: di.get(p.b), need: p.need + room(p.a) + room(p.b) }));
    const dx = centres(PAD + GUTTER + (dc[0].fold ? fw : col) / 2, columnGaps(dc.length, dsp, (i) => Math.round((hw(dc[i]) + hw(dc[i + 1])) / 2 + 8)));
    const xs = columns.map((_, c) => dx[di.get(c)] - room(c)), last = dc[dc.length - 1];
    const reach = Math.max(dx[dx.length - 1] + (last.fold ? fw / 2 + 20 : isCh(columns[last.cols[0]]) ? 92 : 200), ...events.filter((e) => e.type === 'amqpnote').map((e) => xs[idx.get(e.col)] + 10 + e.text.length * 5.6 + 100));
    return { xs, col, width: Math.ceil(reach + PAD) };
  };
  const fitted = (folded, fw = FOLD_W, min = COL_MIN) => { let M = layout(COL, folded, fw); for (let col = COL - 6; fit && M.width > fit && col >= min; col -= 6) M = layout(col, folded, fw); return M; };
  const plan = (keep) => planSqueeze({ n: columns.length, ends: keep, fit, widthOf: (f, o) => layout(o.narrow ? COL_NARROW : COL_MIN, f, o.foldW).width });
  let L = fitted(new Set()), folded = new Set(), fw = FOLD_W, sig = '';
  if (sq && fit && L.width > fit) { const P = plan(sq.keep); ({ folded, foldW: fw, key: sig } = P); if (folded.size) L = fitted(folded, fw, P.narrow ? COL_NARROW : COL_MIN); }
  const { xs, col: COLW, width } = L, HEAD_BOX = COLW - 8, nameCh = (c) => Math.max(9, Math.floor((headW(c, COLW) - 14) / 6.6));
  const colX = new Map(columns.map((c, i) => [c, xs[i]]));
  // a queue head drops its transport prefix and the 'queue delivery' line (the title keeps both): two lines at most
  const subCh = COLW < COL_MIN ? Math.max(10, Math.floor((COLW - 22) / 5.8)) : SUB_CH; // narrowed heads (Squeeze, last stage) wrap the sub line shorter
  const heads = columns.map((c) => (c.sub === 'queue delivery' ? { name: clampLines(wrapId(c.label.replace(/^[^:]+:/, ''), nameCh(c)), nameCh(c)), sub: [] } : { name: clampLines(wrapId(c.label, nameCh(c)), nameCh(c)), sub: isCh(c) ? [c.sub] : wrapId(c.sub ?? '', subCh) }));
  const boxH = 12 + Math.max(...heads.map((x) => x.name.length * LINE_H + x.sub.length * 13)) + 6, HEAD = boxH + 16;
  const frames = altFrames(lane.altMsgs), strips = stripsByRow(frames, lane.altRows);
  const nStrips = (r) => strips.get(r)?.length ?? 0;
  const top = [], ys = [];
  let y = PAD;
  events.forEach((e, r) => { top[r] = y; ys[r] = y + nStrips(r) * STRIP + LINE[e.type]; y += nStrips(r) * STRIP + rowH(e); });
  top[events.length] = y;
  const height = y + PAD;
  const barX = (bar, dir) => (folded.has(idx.get(bar.col)) ? colX.get(bar.col) + (dir < 0 ? 0 : fw) : colX.get(bar.col) + bar.level * NEST + dir * BAR / 2); // in a fold: its edge on that side
  const groups = foldGroups(columns.length, folded).map((g) => ({ ...g, x: xs[g.from], w: fw, names: g.cols.map((c) => columns[c].service ?? columns[c].label) }));
  const edge = (bar, col, dir) => (bar ? barX(bar, dir) : colX.get(col));
  const headBox = (c) => headW(c, COLW);
  return { columns, events, bars, idx, folded, groups, plan, sig, foldW: fw, fit, isCh, headW, headBox, xs, COLW, width, height, colX, heads, boxH, HEAD, frames, strips, top, ys, barX, edge };
}
