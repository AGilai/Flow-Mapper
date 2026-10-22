// Back from a sub-flow (0.33.2): a tab opened from the active one remembers it and the step the viewer was on; "Back to <main flow>" and the browser's
// Back button return to the same place. The rules with no DOM are in flow-back-pure.js.
//   createBack(h) -> { drill(key), note(key, parent), backOf(key), goBack(key), stepFor(key) }
// h: { active(), has(key), step() (the step param of the active tab), view(key), open(key) -> Promise (opens and activates), persist(), setStep(n),
//      label(key) (the name of a tab for the button) }

import { backTarget, noteOpened } from './flow-back-pure.js';

export function createBack(h) {
  let from = new Map();
  const want = new Map(); // key -> the step a tab opens on when it is brought back
  const note = (key, parent = h.active()) => { from = noteOpened(from, key, parent, h.step() ?? h.view(parent)?.step?.() ?? null); };
  /** Open `key` as a sub-flow of the active tab: one history entry for the parent (with its step), so the browser's Back lands there. */
  function drill(key) {
    if (h.active() && h.active() !== key && !h.has(key)) { h.persist(); history.pushState(null, '', location.href); }
    note(key);
    return h.open(key);
  }
  async function goBack(key) {
    const b = backTarget(key, from);
    if (!b) return;
    if (b.step) { want.set(b.key, b.step); h.view(b.key)?.goStep(b.step); }
    await h.open(b.key);
    if (b.step) { h.setStep(b.step); h.persist(); }
  }
  return { drill, note, goBack, stepFor: (k) => (want.has(k) ? want.get(k) : undefined), backOf: (k) => { const b = backTarget(k, from); return b && { ...b, label: h.label(b.key) }; } };
}
