// Call-note markers on the diagram (frame 28g): a small note icon beside the number of a step whose call has a description, and the same "!" as the flow doc's Watch
// badge when the note has a Watch. Drawn next to the callout badge position (flow-step-badges.js), one step further out. `pos(n)` -> { x, y, dir } or null.

import { s } from '../dom.js';

/** drawCallMarks(res, pos) -> { set([{ step, note: { watch } }]) } */
export function drawCallMarks(res, pos) {
  const layer = s('g', { class: 'callmarks' });
  res.body.append(layer);
  const mark = (step, note, p) => {
    const x = p.x - p.dir * 22, out = [s('g', { class: 'callmark', 'data-step': step, transform: `translate(${x - 7} ${p.y - 7})` },
      s('rect', { width: 14, height: 16, rx: 3 }), s('path', { d: 'M3.5 5h7M3.5 8h7M3.5 11h4.5' }), s('title', {}, `Call note on step ${step}`))];
    if (note.watch.on) out.push(s('g', { class: 'callmark-bang docbadge', 'data-step': step, transform: `translate(${x - p.dir * 20} ${p.y + 1})` },
      s('g', { class: 'bd-bang watch' }, s('path', { d: 'M0 -8.500 L8.500 6.500 H-8.500 Z', 'stroke-linejoin': 'round' }), s('text', { y: 4.500 }, '!')), s('title', {}, `Watch: ${note.watch.text}`)));
    return out;
  };
  return { set(list) { layer.replaceChildren(...list.flatMap(({ step, note }) => { const p = pos(step); return p ? mark(step, note, p) : []; })); } };
}
