// The viewer's three description switches (frame 28, View > Descriptions): the caption bar under the diagram, the Read / Write legend, and "Hide text" (the step
// description inside the caption). One value each, remembered in localStorage (flow-view-pure.js, flow-info-pure.js); every open tab and the View menu subscribe.

import { captionOn, captionSave, legendOn, legendSave, coverageOn, coverageSave } from './flow-view-pure.js';
import { textHidden, textHiddenSave } from './flow-info-pure.js';

const subs = new Set();
const st = { caption: captionOn(), legend: legendOn(), hideText: textHidden(), coverage: coverageOn() };

/** The current values (a live object: read it, do not write it). */
export const caps = () => st;
/** Set one of 'caption' | 'legend' | 'hideText' | 'coverage', remember it, tell the subscribers. */
export function setCap(key, on) {
  st[key] = !!on;
  if (key === 'caption') captionSave(st.caption); else if (key === 'legend') legendSave(st.legend); else if (key === 'coverage') coverageSave(st.coverage); else textHiddenSave(st.hideText);
  subs.forEach((f) => f(st));
}
/** Call `fn(st)` on every change; returns the way to stop. */
export function onCaps(fn) { subs.add(fn); return () => subs.delete(fn); }
