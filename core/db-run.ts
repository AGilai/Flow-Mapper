// The run a store call belongs to (0.43.3, #88 follow-up), pure. A merged node `*3 get, hget` names its calls in `dbGroup.members`; once the viewer
// expands the run, each call is a message of its own and the Info pane of one of them must offer to group them again.

import type { DbCall, Message } from './trace-types.ts';

export interface DbRun { key: string; members: string[]; calls: DbCall[]; index: number }

/** `folded`: the messages of the view drawn with no run expanded (`viewOf(..., { dbOpen: [], group: true })`). The run that holds the message `key`, or null (not a member of a run). `key` of the run is its first member's, the one `dbOpen` holds. */
export function dbRunOf(folded: readonly Message[], key: string | undefined | null): DbRun | null {
  if (!key) return null;
  for (const m of folded) {
    const g = m.dbGroup, at = g ? g.members.indexOf(key) : -1;
    if (g && at >= 0) return { key: m.key ?? g.members[0], members: g.members, calls: g.calls, index: at };
  }
  return null;
}

export interface RunCardModel { title: string; rows: { no: string; label: string; key: string | null; current: boolean }[]; button: string }

/** The "Calls in this run" block of an expanded call's pane. `n`: the drawn step of the current call (null: not numbered); the run's calls are the steps n - index ... */
export function runCardModel(run: DbRun, n: number | null): RunCardModel {
  const first = n != null ? n - run.index : null;
  return { title: 'Calls in this run',
    rows: run.calls.map((c, i) => ({ no: first != null ? String(first + i) : String(i + 1), label: c.label ?? '', key: c.keyTemplate ?? null, current: i === run.index })),
    button: `Group the ${run.calls.length} calls into one arrow again` };
}

/** What the pane of a run member may do: its drawn step `n` (from `steps`, the walk's), and `group()`: fold the run (the tab's DB toggle), select the merged arrow and open its pane (`regroup(runKey)`). */
export function runContext(m: unknown, run: DbRun, { steps, regroup }: { steps: () => { n: number; event: { msg?: unknown } }[]; regroup: (key: string) => void }) {
  return { run, n: steps().find((x) => x.event.msg === m)?.n ?? null, group: () => regroup(run.key) };
}
