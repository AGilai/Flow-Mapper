// #73: after an async call the caller continues. Its own later steps are drawn first; what the async callee does
// (its subtree) is held and runs when the calling function has no steps left. Pure; trace.ts owns the state.

type Run = () => void;

export interface DeferState<A> {
  alt: { get(): A; set(a: A): void };
  deferred: { get(): Run[] | null; set(d: Run[] | null): void };
}

export function deferHelpers<A>(s: DeferState<A>) {
  /** Wrap `run` so it sees the alt branch that was current when it was queued. */
  const withAlt = (run: Run): Run => {
    const a = s.alt.get();
    return () => { const prev = s.alt.get(); s.alt.set(a); try { run(); } finally { s.alt.set(prev); } };
  };
  /** An async send draws its arrows now, but the callee's work goes to `later` (unless an outer fan-out already holds it). */
  const holdAsync = (mode: string | undefined, later: Run[], run: Run) => {
    if (mode !== 'async' || s.deferred.get()) return run();
    s.deferred.set(later);
    try { run(); } finally { s.deferred.set(null); }
  };
  /** An internal async call: the arrow is drawn now, the callee's steps after the caller's. */
  const afterCaller = (mode: string | undefined, later: Run[], run: Run) => { if (mode === 'async') later.push(withAlt(run)); else run(); };
  return { withAlt, holdAsync, afterCaller };
}

/** #121: the frame section of a step (`group#branch`, outermost first). */
const sectionOf = (a: { group: string; branch: number; parent?: unknown } | undefined): string => { const c: string[] = []; for (let x = a as any; x; x = x.parent) c.unshift(`${x.group}#${x.branch}`); return c.join('>'); };

/** #121: runs the held async work (`later`) that was started in another frame section than the step about to be drawn (`alt`), so a consumer is drawn in the frame of its trigger
 *  (like a sync call) instead of at the end of the function, where the last frame would cover it. `laterIn[i]` is the section `later[i]` was started in; returns the section of this step. */
export function releaseHeld(later: Run[], laterIn: string[], prev: string, alt: Parameters<typeof sectionOf>[0]): string {
  while (laterIn.length < later.length) laterIn.push(prev);
  const here = sectionOf(alt);
  for (let i = 0; i < later.length;) { if (laterIn[i] !== here) { laterIn.splice(i, 1); later.splice(i, 1)[0](); } else i++; }
  return here;
}
