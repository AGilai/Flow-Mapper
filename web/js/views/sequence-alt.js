// Alt frames (#41): steps of one function that exclude each other are drawn inside one frame, a section per
// branch with its condition in brackets and a dashed line between sections. A frame covers its own messages and
// everything below them in the call tree (messages deeper than the alternatives), so each branch shows its subtree.

import { s } from '../dom.js';

export const STRIP = 20; // height of the strip that carries a section's condition

/** The frames a message sits in at its own depth, outermost first (`alt.parent` links, 0.32.1). */
export const chainOf = (alt) => { const out = []; for (let a = alt; a; a = a.parent) out.unshift(a); return out; };

/** Frames of the visible messages: { group, kind, depth, level, first, last, strips: [{ at: message index, cond }] } in order of appearance, an outer frame before the frames inside it.
 *  Frames nest by call depth (a frame covers the messages below its own) and, inside one function, by `alt.parent` (#72). */
export function altFrames(msgs) {
  const all = [], open = [];
  msgs.forEach((m, i) => {
    const chain = chainOf(m.alt);
    for (let k = open.length - 1; k >= 0; k--) {
      const f = open[k];
      if (m.depth > f.depth) f.last = i;
      else if (!(m.depth === f.depth && chain.some((a) => a.group === f.group))) open.splice(k, 1);
    }
    for (const a of chain) {
      let f = open.find((x) => x.group === a.group && x.depth === m.depth);
      if (!f) { f = { group: a.group, kind: a.kind ?? 'alt', depth: m.depth, level: open.length, first: i, last: i, strips: [], branch: 0 }; all.push(f); open.push(f); }
      f.last = i;
      if (f.branch !== a.branch) { f.branch = a.branch; f.strips.push({ at: i, cond: a.condition ?? (a === m.alt ? m.condition : undefined) }); }
    }
  });
  return all;
}

/** Strips per row, outer frames first: row -> [{ frame, strip, first }]. */
export function stripsByRow(frames, rows) {
  const by = new Map();
  for (const f of frames) f.strips.forEach((st, k) => {
    const list = by.get(rows[st.at]) ?? [];
    list.push({ frame: f, strip: st, first: k === 0 });
    by.set(rows[st.at], list);
  });
  return by;
}

/** SVG for all frames. `top(row)` is the y where a row's strips start, `bottom(row)` the y where the row ends. */
export function drawFrames(frames, rows, strips, top, bottom, width, gutter) {
  const stripY = (f, st) => { const row = rows[st.at]; return top(row) + strips.get(row).findIndex((e) => e.frame === f && e.strip === st) * STRIP; };
  return frames.map((f) => {
    const l = gutter + 6 + f.level * 8, r = width - 6 - f.level * 8;
    const t = stripY(f, f.strips[0]);
    const b = bottom(rows[f.last]) - 2 - f.level * 3;
    const tw = 14 + Math.max(3, f.kind.length) * 6.6; // the tab fits the word: alt, opt, loop, par, critical, break
    const parts = [s('rect', { class: 'alt-box', x: l, y: t, width: r - l, height: b - t, rx: 3 })];
    f.strips.forEach((st, k) => {
      const y = stripY(f, st);
      if (k) parts.push(s('line', { class: 'alt-sep', x1: l, x2: r, y1: y, y2: y }));
      else parts.push(s('path', { class: 'alt-tab', d: `M${l} ${y} h${tw} v11 l-6 6 h${6 - tw} z` }), s('text', { class: 'alt-kw', x: l + 7, y: y + 12 }, f.kind));
      if (st.cond) parts.push(s('text', { class: 'alt-cond', x: l + (k ? 8 : tw + 8), y: y + 14 }, s('title', {}, st.cond), `[${st.cond.length > 70 ? st.cond.slice(0, 69) + '…' : st.cond}]`));
    });
    return s('g', { class: 'alt', 'aria-hidden': 'true' }, parts);
  });
}
