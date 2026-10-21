// References in a flow (0.26.0), pure: which lifeline heads are locked, which messages run into a reference, the partial-flow line.
// A message into a reference carries `reference: {anchor, source}`; `partial.steps` lists the first message into each one (design traces only; absent on sealed ones).

/** Messages that enter a service participant (an arrow into it from another participant, not a step inside it). */
const enters = (m) => typeof m.to === 'string' && m.to.startsWith('svc:') && m.to !== m.from;

/** The services whose every entering message is a reference (D6: a head is locked only then): Map<service, source>. */
export function lockedServices(trace) {
  const seen = new Map(); // service -> { all: boolean, source }
  for (const m of trace?.messages ?? []) {
    if (!enters(m)) continue;
    const service = m.to.slice(4), cur = seen.get(service) ?? { all: true, source: null };
    if (m.reference) cur.source ??= m.reference.source; else cur.all = false;
    seen.set(service, cur);
  }
  return new Map([...seen].filter(([, v]) => v.all && v.source).map(([k, v]) => [k, v.source]));
}

/** The reference of one message ({anchor, source}) or null. */
export const refOf = (m) => m?.reference ?? null;

/** { service, ingress } of the endpoint an anchor `ing:<service>/<id>` names. */
export function ingressOf(anchor) {
  const rest = String(anchor ?? '').replace(/^ing:/, ''), i = rest.indexOf('/');
  return i < 0 ? null : { service: rest.slice(0, i), ingress: rest.slice(i + 1) };
}

/**
 * The partial-flow line: [{ n (the walk's step number, or null when the arrow is not a step now), message, anchor, service, label, source }] in flow order.
 * `steps` is the walk's numbering (flow-steps.js `stepsOf`), `partial` the trace's `partial`. Absent partial: [].
 */
export function partialItems(partial, messages, steps) {
  return (partial?.steps ?? []).map((p) => {
    const msg = messages[p.message], st = steps.find((x) => x.event.msg === msg);
    return { n: st?.n ?? null, message: p.message, anchor: p.anchor, service: p.service, ingress: p.ingress, label: p.label, source: p.source };
  });
}

/** "Partial flow: 2 steps continue into references, so their behaviour isn't in this design:" */
export const partialLead = (n) => `Partial flow: ${n === 1 ? '1 step continues' : `${n} steps continue`} into ${n === 1 ? 'a reference' : 'references'}, so their behaviour isn't in this design:`;

/** The label of one item: "step 3 users-svc · GET /users/{id}/posture". */
export const partialLabel = (it) => `${it.n ? `step ${it.n} ` : ''}${it.service} · ${String(it.label).replace(/^[\w-]+:/, '').replace(/^(\w+) [^/\s]*(\/.*)$/, '$1 $2')}`;
