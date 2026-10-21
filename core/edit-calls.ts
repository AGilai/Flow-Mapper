// Calls as ops: an arrow that traces is an egress of the calling component plus a step in one of its functions. The egress carries the
// bind key and transport that make the link to the endpoint (or leave it "not designed yet"); the step puts it in the function's order.

import type { DraftOpInput } from './draft-ops.ts';
import { endpointBuild } from './edit-forms.ts';
import { EditError, renumber, setField, slug, unique, type CallEdit, type DeleteCallEdit, type Idx } from './edit-kit.ts';
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
