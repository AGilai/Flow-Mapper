// Step marks (0.32.2, #75): a step flagged `mark: "new" | "changed"` by a design (manifest step, plan, design edit, MCP). Pure.
// The trace message carries it (and the free text `details.changed` as the tooltip); an entry point whose flow runs a marked step counts as changed ("Changed only", `markedReached` in flow-counts.ts).

import type { Step, StepAlternative, StepFix } from './types.ts';

export const STEP_MARKS = ['new', 'changed'] as const;

/** 0.36.1 (#82): the step's alternatives: the top-level field, else `details.alternatives` (data pushed before the field existed). Empty when none. */
export const altsOf = (st: Step): StepAlternative[] => (Array.isArray(st.alternatives) ? st.alternatives : Array.isArray(st.details?.alternatives) ? st.details.alternatives as StepAlternative[] : []);

/** 0.36.1 (#82): the step's `fixes` (an arm fixed by the caller's literal): top-level, else `details.fixes`. */
export const fixesOf = (st: Step): StepFix[] => (Array.isArray(st.fixes) ? st.fixes : Array.isArray(st.details?.fixes) ? st.details.fixes as StepFix[] : []);

/** What a step adds to its trace message: `mark`, the `details.changed` text beside it, and `over` (the components a leaf note spans, #74). */
export const stepExtras = (st: Step, id?: string) => ({
  ...(altsOf(st).length ? { alternatives: altsOf(st) } : {}), ...(fixesOf(st).length ? { fixes: fixesOf(st) } : {}), ...(id && (altsOf(st).length || fixesOf(st).length) ? { stepId: id } : {}),                       // 0.36.1 (#82): verbatim, with the id `arms[].step_ids` use: `<service>:<fn>#<seq>`
  ...(st.mark ? { mark: st.mark, ...(typeof st.details?.changed === 'string' && st.details.changed ? { changed: st.details.changed } : {}) } : {}),
  ...(st.over?.length ? { over: st.over } : {}),
  ...(typeof st.details?.real === 'string' && st.details.real ? { real: st.details.real } : {}),                 // 0.33.1: the bind key a mermaid import was told it really calls
  ...(st.returns?.label ? { returns: st.returns } : {}),                                                            // 0.33.2 (#81): the label (and detail) of the return that answers the call
  ...(st.details?.self === true ? { self: true } : {}),                                                              // an internal step that was a self-message
});

/** Id of a marked step inside `componentSets` (prefix `m:`; the counts skip it). */
export const markedId = (service: string, fn: string, seq: number) => `m:${service}:${fn}#${seq}`;
