// The lock: a reference (an endpoint copied from another environment whose behaviour is not in this design). Neutral (`--ink-2`), never `--warn`.
// An SVG symbol, not the emoji: emoji render differently per OS. `lockChip` for lists and panels, `lockSvg` for drawings.

import { h, s } from '../dom.js';
import { icon, SVG_PATH } from '../icons.js';

/** "reference from prod" (short: "reference"). */
export const lockText = (ref, short = false) => (short || !ref?.source ? 'reference' : `reference from ${ref.source}`);

/** A chip: lock + words. `ref` is { source } (or null). */
export const lockChip = (ref, { short = false, title = null, text = null } = {}) =>
  h('span.st.lock-chip', { title: title ?? 'Its behaviour lives in another environment. Import it into the design to change it.' }, icon('lock'), text ?? lockText(ref, short));

/** The lock as an SVG group at (x, y), `size` px square. */
export function lockSvg(x, y, size = 12) {
  const g = s('g', { class: 'lockg', transform: `translate(${x},${y}) scale(${size / 24})` });
  g.innerHTML = SVG_PATH.lock;
  return g;
}
