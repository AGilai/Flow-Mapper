// The ONE text size of the flow description and the step description (0.45.0, #91): five sizes, kept in localStorage (`flow-mapper.textSize`), applied as
// the custom property --fm-text on <html>. Every A− / A+ control subscribes, so changing it in either place resizes both and both show the same state.

import { h } from '../dom.js';
import { SIZES, clampSize, sizeStored, sizeSave, stepSize, sizeLabel } from './flow-info-pure.js';

let cur = null;
const subs = new Set();
const apply = (n) => { try { document.documentElement.style.setProperty('--fm-text', `${SIZES[n]}px`); } catch { /* no document */ } };
export const textSize = () => { if (cur === null) { cur = sizeStored(); apply(cur); } return cur; };
export function setTextSize(n) { cur = clampSize(n); sizeSave(cur); apply(cur); subs.forEach((f) => f(cur)); }

/** sizeControl() -> { el, dispose }: "A−" and "A+" buttons, disabled at the ends. */
export function sizeControl() {
  const mk = (d, glyph, label) => h('button', { type: 'button', 'aria-label': label, title: label, on: { click: () => setTextSize(stepSize(textSize(), d)) } }, glyph);
  const less = mk(-1, 'A−', 'Smaller text'), more = mk(1, 'A+', 'Larger text');
  const el = h('span.fm-fs', { role: 'group', 'aria-label': 'Text size' }, less, more);
  const paint = (n) => { less.disabled = n <= 0; more.disabled = n >= SIZES.length - 1; el.title = `Text size ${sizeLabel(n)}`; };
  subs.add(paint); paint(textSize());
  return { el, dispose: () => subs.delete(paint) };
}
