// The colour control of a component (frame 31e), in its Info pane: "Family (auto)" first (clears the manual colour), then the eight palette slots.
// A manual colour replaces only this component's shade (header stripe, bars, step dots, map node), never its lifeline or bands, and shows a diamond. Per viewer
// (family-colours.js). The options open in place under the row; Escape or a second click closes them.

import { h } from '../dom.js';
import { hasFamilies, overrideOf, setOverride } from './family-colours.js';

/** colourRow(env, service) -> the value cell of a "Colour" fact: a swatch button and the options. */
export function colourRow(env, service) {
  const auto = hasFamilies(env) ? 'Family (auto)' : 'Automatic';
  let open = false;
  const root = h('div.colour-row');
  const radio = (value, text, swatch) => h('label.colour-opt', h('input', { type: 'radio', name: `colour-${service}`, 'data-qa': `colour-${value ?? 'auto'}`, checked: overrideOf(env, service) === value, on: { change: () => { setOverride(env, service, value); draw(); } } }), swatch, text);
  const dot = (n) => h('span.colour-sw', { style: n ? { '--c': `var(--cmp-${n})` } : { '--c': 'var(--ink-3, var(--muted))' } });
  function draw() {
    const cur = overrideOf(env, service);
    root.replaceChildren(
      h('button.colour-btn', { type: 'button', 'data-qa': 'colour-btn', 'aria-expanded': String(open), on: { click: () => { open = !open; draw(); } } }, dot(cur), cur ? `Custom: slot ${cur}` : auto),
      open ? h('div.colour-opts', { role: 'radiogroup', 'aria-label': `Colour of ${service}`, on: { keydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); open = false; draw(); } } } },
        radio(null, auto, dot(0)), ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => radio(n, `Slot ${n}`, dot(n))),
        h('p.colour-note', 'A manual colour changes this component only, marked with a diamond. Its lifeline and bands keep the family colour.')) : null);
  }
  draw();
  return root;
}
