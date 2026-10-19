// Long lists collapse to the first `limit` items with a "Show all N" control.

import { h } from '../dom.js';

/**
 * Renders `render(items, control)` for the first `limit` items. `control` is the "Show all N" button;
 * render may place it (for example right under the last row), otherwise it goes below the result.
 * The returned element has `.reveal()`, which expands the list (used when a link points at a hidden row).
 */
export function showAll(items, limit, render, noun = 'items') {
  const box = h('div.show-all');
  let all = items.length <= limit;
  const draw = () => {
    const control = items.length > limit
      ? h('button.btn.ghost.show-more', { type: 'button', on: { click: () => { all = !all; draw(); } } }, all ? 'Show fewer' : `Show all ${items.length} ${noun}`)
      : null;
    const out = render(all ? items : items.slice(0, limit), control);
    box.replaceChildren(...[out, control && !out.contains(control) ? control : null].filter(Boolean));
  };
  draw();
  box.reveal = () => { if (!all) { all = true; draw(); } };
  return box;
}
