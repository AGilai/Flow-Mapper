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
