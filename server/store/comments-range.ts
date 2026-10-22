// A comment on a range of steps (0.34.0): `steps: { from, to }`, two step keys of the flow (core/description.ts), `from` before `to` in the flow's order,
// 2 or more steps; given instead of `step`, on a top comment only. The keys are stored as they are (migration 017: `steps_from`, `steps_to`): when the flow
// changes later, the readers clamp what is left (web/js/comments/range.js); nothing is rewritten here.

import type { Trace } from '../../core/trace.ts';
import { stepKeys, isStepKey, hasStep } from '../../core/description.ts';
import { badRequest } from '../errors.ts';

export interface StepRange { from: string; to: string }

/** The validated range, or null when none was given. `where` names the flow in the message. */
export function checkRange(steps: unknown, step: unknown, parent: boolean, t: Trace, where: string): StepRange | null {
  if (steps === undefined || steps === null) return null;
  const s = steps as { from?: unknown; to?: unknown };
  if (typeof steps !== 'object' || typeof s.from !== 'string' || typeof s.to !== 'string') throw badRequest('steps must be { from, to }: two step keys of the flow');
  if (step != null) throw badRequest('give step or steps, not both');
  if (parent) throw badRequest('a reply has no step range: give steps on the top comment');
  for (const k of [s.from, s.to]) if (!isStepKey(k) || !hasStep(t, k)) throw badRequest(`step '${k}' is not in the flow ${where}`);
  const keys = stepKeys(t.messages), a = keys.indexOf(s.from), b = keys.indexOf(s.to);
  if (a < 0 || b < 0) throw badRequest(`step '${a < 0 ? s.from : s.to}' is not in the flow ${where}`);
  if (a === b) throw badRequest('a range is 2 or more steps: use step for one');
  if (a > b) throw badRequest('steps.from must come before steps.to in the flow');
  return { from: s.from, to: s.to };
}
