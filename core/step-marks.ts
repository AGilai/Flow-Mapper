// Step marks (0.32.2, #75): a step flagged `mark: "new" | "changed"` by a design (manifest step, plan, design edit, MCP). Pure.
// The trace message carries it (and the free text `details.changed` as the tooltip); an entry point whose flow runs a marked step counts as changed ("Changed only", `markedReached` in flow-counts.ts).

import type { Step } from './types.ts';

export const STEP_MARKS = ['new', 'changed'] as const;

/** What a step adds to its trace message: `mark`, the `details.changed` text beside it, and `over` (the components a leaf note spans, #74). */
export const stepExtras = (st: Step) => ({
  ...(st.mark ? { mark: st.mark, ...(typeof st.details?.changed === 'string' && st.details.changed ? { changed: st.details.changed } : {}) } : {}),
  ...(st.over?.length ? { over: st.over } : {}),
  ...(typeof st.details?.real === 'string' && st.details.real ? { real: st.details.real } : {}),                 // 0.33.1: the bind key a mermaid import was told it really calls
  ...(typeof st.details?.response === 'string' && st.details.response ? { response: st.details.response } : {}),   // the label of the return that answered the call
  ...(st.details?.self === true ? { self: true } : {}),                                                              // an internal step that was a self-message
});

/** Id of a marked step inside `componentSets` (prefix `m:`; the counts skip it). */
export const markedId = (service: string, fn: string, seq: number) => `m:${service}:${fn}#${seq}`;
