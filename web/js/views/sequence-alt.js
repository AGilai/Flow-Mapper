// Alt frames (#41): steps of one function that exclude each other are drawn inside one frame, a section per
// branch with its condition in brackets and a dashed line between sections. A frame covers its own messages and
// everything below them in the call tree (messages deeper than the alternatives), so each branch shows its subtree.

import { s } from '../dom.js';

export const STRIP = 20; // height of the strip that carries a section's condition

/** Frames of the visible messages: { group, depth, level, first, last, strips: [{ at: message index, cond }] } in order of appearance. */
export function altFrames(msgs) {
  const all = [], open = [];
  msgs.forEach((m, i) => {
    let member = null;
    for (let k = open.length - 1; k >= 0; k--) {
      const f = open[k];
      if (m.alt?.group === f.group && m.depth === f.depth) member = f;
      else if (m.depth > f.depth) f.last = i;
      else open.splice(k, 1);
    }
    if (m.alt && !member) {
      member = { group: m.alt.group, depth: m.depth, level: open.length, first: i, last: i, strips: [], branch: 0 };
      all.push(member);
      open.push(member);
    }
    if (member && m.alt) {
      member.last = i;
      if (member.branch !== m.alt.branch) { member.branch = m.alt.branch; member.strips.push({ at: i, cond: m.condition }); }
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
    const parts = [s('rect', { class: 'alt-box', x: l, y: t, width: r - l, height: b - t, rx: 3 })];
    f.strips.forEach((st, k) => {
      const y = stripY(f, st);
      if (k) parts.push(s('line', { class: 'alt-sep', x1: l, x2: r, y1: y, y2: y }));
      else parts.push(s('path', { class: 'alt-tab', d: `M${l} ${y} h34 v11 l-6 6 h-28 z` }), s('text', { class: 'alt-kw', x: l + 7, y: y + 12 }, 'alt'));
      if (st.cond) parts.push(s('text', { class: 'alt-cond', x: l + (k ? 8 : 42), y: y + 14 }, s('title', {}, st.cond), `[${st.cond.length > 70 ? st.cond.slice(0, 69) + '…' : st.cond}]`));
    });
    return s('g', { class: 'alt', 'aria-hidden': 'true' }, parts);
  });
}
