// What one bar's call runs, for the drill-down panel: the functions it reaches (handler first, then the chain),
// each with its steps in order and alt frames grouped by branch. Pure: built from the messages the bar owns.

import { isPublish } from './flow-scan.js';

const stepType = (m) => (m.kind === 'call' ? 'call' : m.kind === 'resource' ? 'store' : m.kind === 'frontier' ? 'frontier' : m.kind === 'leaf' ? 'leaf' : isPublish(m) ? 'publish'
  : m.broken || m.gap ? 'unresolved' : m.kind === 'egress' ? 'out' : 'other');

/** Source link of a step: its own `source`, else the call site of its egress. */
export function stepCode(m, trace) {
  return (m.seq ? trace.code?.[`step:${m.service}:${m.fn}#${m.seq}`] : null) ?? (m.egress ? trace.code?.[`egress:${m.service}:${m.egress}`] : null) ?? null;
}

/** Group consecutive alt steps of one group into one block with a section per branch (ordered by first appearance). */
export function altBlocks(steps) {
  const out = [];
  for (const st of steps) {
    const a = st.m.alt;
    const last = out[out.length - 1];
    if (!a) { out.push(st); continue; }
    if (last?.alt && last.alt.group === a.group) {
      let br = last.branches.find((b) => b.branch === a.branch);
      if (!br) { br = { branch: a.branch, condition: st.m.condition ?? null, steps: [] }; last.branches.push(br); }
      br.steps.push(st);
    } else out.push({ alt: a, branches: [{ branch: a.branch, condition: st.m.condition ?? null, steps: [st] }] });
  }
  return out;
}

/**
 * insideBar(bar, trace) -> { service, entry, functions: [{ fn, depth, isEntry, ingress, code, items }], counts }
 * `items` are steps { m, type, code } or alt blocks { alt, branches: [{ branch, condition, steps }] }.
 */
export function insideBar(bar, trace) {
  const owned = bar.msgs.slice(1);
  const handler = bar.msg.target?.fn ?? null;
  const order = [];
  const byFn = new Map();
  const touch = (fn) => { if (!byFn.has(fn)) { const f = { fn, steps: [], parent: null }; byFn.set(fn, f); order.push(f); } return byFn.get(fn); };
  if (handler) touch(handler);
  for (const m of owned) {
    const fn = m.fn ?? handler;
    if (!fn) continue;
    const f = touch(fn);
    f.steps.push({ m, type: stepType(m), code: stepCode(m, trace) });
    if (m.kind === 'call' && m.calls && m.calls !== fn) { const c = touch(m.calls); if (!c.parent) c.parent = fn; }
  }
  const depthOf = (f) => { let d = 0; for (let p = f.parent, n = 0; p && n < 50; n++) { d++; p = byFn.get(p)?.parent; } return d; };
  const functions = order.map((f) => ({ fn: f.fn, depth: depthOf(f), isEntry: f.fn === handler, ingress: f.fn === handler ? bar.msg.target?.ingress ?? null : null,
    code: trace.code?.[`${bar.service}:${f.fn}`] ?? null, items: altBlocks(f.steps) }));
  const t = (x) => owned.filter((m) => stepType(m) === x).length;
  return { service: bar.service, entry: bar.msg, functions,
    counts: { functions: functions.length, internal: t('call'), outgoing: t('out') + t('publish') + t('unresolved'), stores: t('store') } };
}
