// Edit mode: a "+ call" under the last step of each bar (a button, focusable, centred on the lifeline under the bar; drag is 2c). It opens the call form for that bar's function.
// Not on a reference bar (its behaviour is not in the design: import it first) and not on a lane of deliveries without a function.

import { s } from '../dom.js';

/** addCallChips(layout, { onAddCall(bar) }) -> one group of chips. */
export function addCallChips({ bars, ys, barX, folded, idx }, { onAddCall }) {
  return s('g', { class: 'addcalls' }, bars.filter((b) => !b.msg.reference && b.msg.target?.fn && !folded.has(idx.get(b.col))).map((b) => {
    const x = (barX(b, -1) + barX(b, 1)) / 2 - 26, y = ys[b.end] + 15; // centred under the bar's end
    const g = s('g', { class: 'addcall', 'data-qa': 'add-call', tabindex: 0, role: 'button', 'aria-label': `Add a call under ${b.service}: ${b.msg.label}` },
      s('rect', { x, y, width: 52, height: 15, rx: 7.5 }), s('text', { x: x + 9, y: y + 11 }, '+ call'), s('title', {}, `Add a call from ${b.msg.target.fn}`));
    const go = (ev) => { ev.stopPropagation(); ev.preventDefault(); onAddCall(b); };
    g.addEventListener('click', go);
    g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') go(ev); });
    return g;
  }));
}
