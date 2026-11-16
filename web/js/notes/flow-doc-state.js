// Whether the flow doc (the bottom pane of a flow) is on the page (Unreleased, frame 28a, a1/a2/a3). Two switches, remembered per viewer in this browser:
//   enabled  View > Descriptions > Flow doc. Off is "nothing" (a3): no pane, no icon on the tab.
//   shown    the pane itself. Off (with enabled on) is "hidden" (a1/a2): no pane, a note icon on the active tab that brings it back.
// The diagram's callout badges do not depend on either: they come from the document's callouts, not from the pane being open.

const KEY = { enabled: 'flow-mapper.flowdoc-on2', shown: 'flow-mapper.flowdoc-shown2' } /* renamed in Unreleased: a pane hidden with the old × or switch comes back once */;
const subs = new Set();
const read = (k) => { try { return localStorage.getItem(k) !== '0'; } catch { return true; } };
const st = { enabled: read(KEY.enabled), shown: read(KEY.shown) };

/** The current values (a live object: read it, do not write it). */
export const flowDoc = () => st;
/** Is the pane on the page? */
export const docVisible = () => st.enabled && st.shown;
/** Set 'enabled' or 'shown'; remembered, subscribers told. */
export function setFlowDoc(key, on) {
  if (st[key] === !!on) return;
  st[key] = !!on;
  try { localStorage.setItem(KEY[key], on ? '1' : '0'); } catch { /* storage unavailable */ }
  subs.forEach((f) => f(st));
}
/** A link or a cross-reference to a comment or an action item needs the pane: it comes back, whatever hid it. */
export function revealFlowDoc() { setFlowDoc('enabled', true); setFlowDoc('shown', true); }
/** Call `fn(st)` on every change; returns the way to stop. */
export function onFlowDoc(fn) { subs.add(fn); return () => subs.delete(fn); }
