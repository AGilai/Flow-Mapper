// Checks references inside one service: ingress (and per-event) handlers and step targets must exist, IDs unique.
// A step with no target may also be a classified leaf (kind: leaf, or a call with an operation or note).
// A bind key or step target may be missing only when `unresolved` says why (what: 'target').

import { isLeaf } from './types.ts';

export interface ServiceEntities {
  functions?: { id: string; steps?: { seq: number; type: string; target?: string; unresolved?: { what: string }[]; kind?: 'leaf'; operation?: string; note?: string }[] }[];
  ingress?: { id: string; bindKey?: string; handler: string; events?: { type: string; handler: string }[]; unresolved?: { what: string }[] }[];
  egress?: { id: string; bindKey?: string; unresolved?: { what: string }[] }[];
  resources?: { id: string }[];
  channels?: { bindKey: string }[];
  bindings?: { id: string }[];
}

const explained = (x: { unresolved?: { what: string }[] }) => !!x.unresolved?.some((u) => u.what === 'target');

export function integrityErrors(e: ServiceEntities): string[] {
  const errs: string[] = [];
  const ids = (list: keyof ServiceEntities, key: 'id' | 'bindKey' = 'id') => {
    const seen = new Set<string>();
    for (const x of (e[list] ?? []) as any[]) {
      if (seen.has(x[key])) errs.push(`${list}: duplicate ${key} '${x[key]}'`);
      seen.add(x[key]);
    }
    return seen;
  };
  const fns = ids('functions'), egs = ids('egress'), rs = ids('resources');
  ids('ingress'); ids('bindings'); ids('channels', 'bindKey');
  for (const i of e.ingress ?? []) {
    if (!fns.has(i.handler)) errs.push(`ingress '${i.id}': handler '${i.handler}' is not a function of this service`);
    if (!i.bindKey && !explained(i)) errs.push(`ingress '${i.id}': bindKey is required unless unresolved (what: target) says why`);
    for (const mw of i.middleware ?? []) if (!fns.has(mw)) errs.push(`ingress '${i.id}': middleware '${mw}' is not a function of this service`);
    for (const ev of i.events ?? []) if (!fns.has(ev.handler)) errs.push(`ingress '${i.id}' event '${ev.type}': handler '${ev.handler}' is not a function of this service`);
  }
  for (const x of e.egress ?? []) if (!x.bindKey && !explained(x)) errs.push(`egress '${x.id}': bindKey is required unless unresolved (what: target) says why`);
  for (const f of e.functions ?? []) {
    const seqs = new Set<number>();
    for (const s of f.steps ?? []) {
      if (seqs.has(s.seq)) errs.push(`function '${f.id}': duplicate step seq ${s.seq}`);
      seqs.add(s.seq);
      if (!s.target) { if (!explained(s) && !isLeaf(s)) errs.push(`function '${f.id}' step ${s.seq}: target is required unless unresolved (what: target) says why, or it is a leaf (kind: leaf, or a call with an operation or note)`); continue; }
      const pool = s.type === 'call' ? fns : s.type === 'egress' ? egs : rs;
      if (!pool.has(s.target)) errs.push(`function '${f.id}' step ${s.seq}: ${s.type} target '${s.target}' not found`);
    }
  }
  return errs;
}
