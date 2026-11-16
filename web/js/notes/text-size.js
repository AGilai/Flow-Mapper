// A text size control (Unreleased): A- / reset / A+ in the header of a document (the call card, the flow doc pane, the design doc). It sets the CSS variable --ts on the element
// it scales (the document text and the editor use `zoom: var(--ts)`, call-notes.css), so the toolbar and the page chrome keep their size. One step list; the choice is remembered
// per browser and per kind of card (`flow-mapper.textsize-<kind>`).

import { h } from '../dom.js';
import { readKey, writeKey } from '../views/flow-info-pure.js';

export const TEXT_STEPS = [0.85, 1, 1.15, 1.3, 1.4];
const HOME = 1;
const saved = (kind) => { const raw = readKey(`textsize-${kind}`), n = Number(raw); return raw !== null && Number.isInteger(n) && n >= 0 && n < TEXT_STEPS.length ? n : HOME; };

/** textSize(kind, target) -> { el, set(i) }: `el` is the control; `target` gets --ts. */
export function textSize(kind, target) {
  let i = saved(kind);
  const mk = (qa, label, text, run) => h('button.ts-b', { type: 'button', 'data-qa': qa, 'aria-label': label, title: label, on: { click: (e) => { e.stopPropagation(); run(); } } }, text);
  const dec = mk('ts-dec', 'Smaller text', 'A−', () => set(i - 1)), reset = mk('ts-reset', 'Reset the text size', 'A', () => set(HOME)), inc = mk('ts-inc', 'Larger text', 'A+', () => set(i + 1));
  const el = h('span.ts-ctl', { role: 'group', 'aria-label': 'Text size', 'data-qa': `ts-${kind}` }, dec, reset, inc);
  function set(n, keep = false) {
    i = Math.max(0, Math.min(TEXT_STEPS.length - 1, n));
    target.style.setProperty('--ts', String(TEXT_STEPS[i]));
    dec.disabled = i === 0; inc.disabled = i === TEXT_STEPS.length - 1; reset.classList.toggle('on', i !== HOME);
    el.dataset.size = String(TEXT_STEPS[i]);
    if (!keep) writeKey(`textsize-${kind}`, String(i));
  }
  set(i, true);
  return { el, set };
}
