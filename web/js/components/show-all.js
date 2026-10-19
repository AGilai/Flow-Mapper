// Long lists collapse to the first `limit` items with a "Show all N" control.

import { h } from '../dom.js';

/**
 * Renders `render(items)` for the first `limit` items; a button below it shows all of them.
 * The returned element has `.reveal()`, which expands the list (used when a link points at a hidden row).
 */
export function showAll(items, limit, render, noun = 'items') {
  const box = h('div.show-all');
  let all = items.length <= limit;
  const draw = () => {
    box.replaceChildren(...[render(all ? items : items.slice(0, limit)),
      items.length > limit ? h('button.btn.ghost.show-more', { type: 'button', on: { click: () => { all = !all; draw(); } } },
        all ? 'Show fewer' : `Show all ${items.length} ${noun}`) : null].filter(Boolean));
  };
  draw();
  box.reveal = () => { if (!all) { all = true; draw(); } };
  return box;
}
