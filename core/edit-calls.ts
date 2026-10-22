// Calls as ops: an arrow that traces is an egress of the calling component plus a step in one of its functions. The egress carries the
// bind key and transport that make the link to the endpoint (or leave it "not designed yet"); the step puts it in the function's order.

import type { DraftOpInput } from './draft-ops.ts';
import { endpointBuild } from './edit-forms.ts';
import { EditError, renumber, setField, slug, unique, type CallEdit, type DeleteCallEdit, type Idx, type LeafEdit, type StepGroupEdit } from './edit-kit.ts';
import { STEP_MARKS } from './step-marks.ts';
import { cleanReturns, returnsProblem, type StepReturns } from './step-returns.ts';
import type { Mode, Transport } from './types.ts';

const up = (anchor: string, data: unknown): DraftOpInput => ({ op: 'upsert', anchor, data });
const sorted = (steps: any[]) => [...steps].sort((a, b) => a.seq - b.seq);

/** async for sns, sqs, eventbridge, event and amqp publishes (not `amqp-rpc:`); sync otherwise, undecided included. */
export const defaultMode = (transport: Transport, bindKey: string): Mode =>
  ['sns', 'sqs', 'eventbridge', 'event'].includes(transport) || (transport === 'amqp' && !bindKey.startsWith('amqp-rpc:')) ? 'async' : 'sync';

/** The component a bind key names (`http:GET users-svc/x` -> users-svc), for naming only. */
const serviceOfKey = (bindKey: string) => /^[^:]+:(?:[A-Za-z]+ )?([^/]+)\//.exec(bindKey)?.[1] ?? 'ext';

/** `out.<target component>.<operation or endpoint id>`, unique among the calling component's egress. */
export function egressIdFor(service: string, target: { service?: string; label: string }, x: Idx): string {
  return unique(`out.${target.service ?? 'ext'}.${slug(target.label)}`, new Set(x.list(service, 'egress').map((r) => r.key)));
}

/** `groups`, `details.real` and `returns` of an edit onto a step (undefined keeps, null / '' clears). */
function stepExtrasOf(step: Record<string, any>, e: { groups?: StepGroupEdit[] | null; real?: string; returns?: StepReturns | null }) {
  if (e.groups !== undefined) {
    if (e.groups !== null && (!Array.isArray(e.groups) || e.groups.some((g) => !g?.id || typeof g.id !== 'string'))) throw new EditError('INVALID', 'groups is a list of {id, kind?, condition?}', 'groups');
    if (e.groups === null || !e.groups.length) delete step.groups; else step.groups = e.groups.map((g) => ({ id: g.id, ...(g.kind && g.kind !== 'alt' ? { kind: g.kind } : {}), ...(g.condition ? { condition: g.condition } : {}) }));
  }
  const d = { ...(step.details ?? {}) };
  setField(d, 'real', e.real);
  if (e.returns !== undefined) {
    const bad = returnsProblem(e.returns);
    if (bad) throw new EditError('INVALID', bad, 'returns');
    if (e.returns === null) delete step.returns; else step.returns = cleanReturns(e.returns);
  }
  if (Object.keys(d).length) step.details = d; else delete step.details;
}

/** A leaf step (a note over components, or an internal step of one function) appended to a function, or inserted before step `before`. */
export function leafOps(e: LeafEdit, x: Idx): DraftOpInput[] {
  const { service, fn } = e.from;
  if (!x.get(service, 'header')) throw new EditError('NO_SERVICE', `component '${service}' does not exist in this design`, 'from');
  if (!e.operation && !e.note) throw new EditError('INVALID', 'a leaf step needs an operation or a note', 'note');
  if (e.over !== undefined && (!Array.isArray(e.over) || e.over.some((o) => typeof o !== 'string' || !x.get(o, 'header')))) throw new EditError('NO_SERVICE', 'over names components of this design', 'over');
  const f = x.get(service, 'functions', fn)?.data ?? { id: fn, name: fn, steps: [] };
  const steps = sorted(f.steps ?? []);
  const step: Record<string, any> = { type: 'call', kind: 'leaf' };
  for (const k of ['operation', 'note'] as const) setField(step, k, e[k]);
  if (e.over?.length) step.over = [...new Set(e.over)];
  if (e.mark) { if (!STEP_MARKS.includes(e.mark)) throw new EditError('INVALID', `mark is 'new' or 'changed'`, 'mark'); step.mark = e.mark; }
  stepExtrasOf(step, e);
  if (e.self) step.details = { ...(step.details ?? {}), self: true };
  const at = e.before === undefined ? steps.length : steps.findIndex((s) => s.seq === e.before);
  if (at < 0) throw new EditError('NO_STEP', `${fn} has no step ${e.before} to insert before`, 'before');
  return [up(`fn:${service}/${fn}`, { ...f, steps: renumber([...steps.slice(0, at), step, ...steps.slice(at)]) })];
}

export function callOps(e: CallEdit, x: Idx): DraftOpInput[] {
  const { service, fn } = e.from;
  if (!x.get(service, 'header')) throw new EditError('NO_SERVICE', `component '${service}' does not exist in this design`, 'from');
  const f = x.get(service, 'functions', fn)?.data ?? { id: fn, name: fn, steps: [] };
  const steps = sorted(f.steps ?? []);
  const old = e.edit ? steps.find((s) => s.seq === e.edit!.seq && s.target === e.edit!.egress) : undefined;
  if (e.edit && !old) throw new EditError('NO_STEP', `step ${e.edit.seq} of ${fn} is not a call to '${e.edit.egress}'`, 'edit');
  const oldEgress = old ? x.get(service, 'egress', old.target)?.data : undefined;

  let pre: DraftOpInput[] = [], bindKey: string, transport: Transport, target: { service?: string; label: string };
  const to = e.to as any;
  if ('ingress' in to) {
    const t = x.get(to.service, 'ingress', to.ingress);
    if (!t) throw new EditError('NO_TARGET', `endpoint '${to.ingress}' of '${to.service}' does not exist in this design`, 'to');
    ({ bindKey, transport } = t.data); target = { service: to.service, label: e.operation || to.ingress };
  } else if ('endpoint' in to) {
    const b = endpointBuild(to.endpoint, x);
    pre = b.ops; ({ bindKey, transport } = b.row.data); target = { service: to.endpoint.service, label: e.operation || b.row.key };
  } else {
    if (!to.bindKey || !to.transport) throw new EditError('INVALID', 'a call that is not designed yet needs bindKey and transport', 'to');
    ({ bindKey, transport } = to); target = { service: serviceOfKey(bindKey), label: e.operation || bindKey.split('/').pop()! };
  }

  const same = !!oldEgress && oldEgress.bindKey === bindKey && oldEgress.transport === transport;
  const mode = e.mode ?? (same && oldEgress!.mode ? oldEgress!.mode : defaultMode(transport, bindKey));
  let egressId: string, egress: Record<string, any> | null = null;
  if (oldEgress && same && oldEgress.mode === mode) egressId = old.target;
  else if (oldEgress) {
    const shared = x.list(service, 'functions').some((r) => (r.data.steps ?? []).some((s: any) => s.target === old.target && !(r.key === fn && s.seq === old.seq)));
    egressId = shared ? egressIdFor(service, target, x) : old.target;     // a shared egress is never mutated
    egress = { ...oldEgress, id: egressId, bindKey, transport, mode };
  } else { egressId = egressIdFor(service, target, x); egress = { id: egressId, bindKey, transport, mode }; }

  const step: Record<string, any> = { ...(old ?? {}), type: 'egress', target: egressId };
  if (e.mode !== undefined || !old) step.mode = e.mode; if (step.mode === undefined) delete step.mode;
  for (const k of ['operation', 'condition', 'event', 'note'] as const) setField(step, k, e[k]);
  if (e.mark !== undefined && e.mark !== null && !STEP_MARKS.includes(e.mark)) throw new EditError('INVALID', `mark is 'new', 'changed' or null`, 'mark');
  setField(step, 'mark', e.mark);
  stepExtrasOf(step, e);
  let next: any[];
  if (old) next = steps.map((s) => (s === old ? step : s));
  else {
    const at = e.before === undefined ? steps.length : steps.findIndex((s) => s.seq === e.before);
    if (at < 0) throw new EditError('NO_STEP', `${fn} has no step ${e.before} to insert before`, 'before');
    next = [...steps.slice(0, at), step, ...steps.slice(at)];
  }
  return [...pre, ...(egress ? [up(`egr:${service}/${egressId}`, egress)] : []), up(`fn:${service}/${fn}`, { ...f, steps: renumber(next) })];
}

/** Remove a call's step; its egress goes too when no other step of the component uses it. */
export function deleteCallOps(e: DeleteCallEdit, x: Idx): DraftOpInput[] {
  const f = x.get(e.service, 'functions', e.fn);
  if (!f) throw new EditError('NO_ITEM', `function '${e.fn}' of '${e.service}' does not exist in this design`, 'fn');
  const steps = sorted(f.data.steps ?? []), step = steps.find((s) => s.seq === e.seq);
  if (!step) throw new EditError('NO_STEP', `${e.fn} has no step ${e.seq}`, 'seq');
  const left = steps.filter((s) => s !== step);
  const ops = [up(`fn:${e.service}/${e.fn}`, { ...f.data, steps: renumber(left) })];
  const used = step.type === 'egress' && step.target && (left.some((s) => s.target === step.target && s.type === 'egress')
    || x.list(e.service, 'functions').some((r) => r.key !== e.fn && (r.data.steps ?? []).some((s: any) => s.type === 'egress' && s.target === step.target)));
  if (step.type === 'egress' && step.target && !used && x.get(e.service, 'egress', step.target)) ops.push({ op: 'delete', anchor: `egr:${e.service}/${step.target}` });
  return ops;
}
