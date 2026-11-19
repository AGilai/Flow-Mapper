// Arrow notation (frame 33), pure: which of the three kinds an event is drawn as, which call a return answers, and when a return keeps its label.
//   sync   solid line, filled head      async  solid line, open head (never dashed), a bolt on its number      return  dashed line, open head, "↩N" tile
// Kind (line + head) and transport (colour) are independent. No DOM here, so tests can import it.

/** 'sync' | 'async' | 'return' for a lane event. A call carries its mode; a hop (a publish through a topic or queue, nobody waits) is async; a store or unresolved row keeps its own look. */
export const arrowKind = (e) => (e.type === 'return' ? 'return' : e.type === 'hop' || (e.type === 'call' && e.msg?.mode === 'async') ? 'async' : 'sync');

/** The draw options of a call arrow: an async one is a solid line with an open head, whether or not it opens a bar. */
export const callStyle = (e) => ({ open: arrowKind(e) === 'async' });

/** The return text worth drawing: a status or payload name. The word "return", "ok" and an empty text carry nothing (the "↩N" tile says it). */
export function returnLabel(label) {
  const t = Array.isArray(label) ? label.join(' ') : String(label ?? '');
  return /^\s*(return|ok|)\s*$/i.test(t) ? null : t.trim();
}

/** The step number of the call a return answers (1-based over the steps `steps` lists), or null. `events`: lane.events, `steps`: stepsOf(lane). */
export function returnOf(events, steps, ret) {
  const call = events[ret.bar?.start];
  return steps.find((st) => st.event === call)?.n ?? null;
}

/** Hover word of a call's arrow. */
export const kindWord = (e) => (arrowKind(e) === 'async' ? 'async' : 'sync');
