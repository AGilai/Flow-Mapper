// Checks references inside one service: ingress (and per-event) handlers and step targets must exist, IDs unique.

export interface ServiceEntities {
  functions?: { id: string; steps?: { seq: number; type: string; target: string }[] }[];
  ingress?: { id: string; handler: string; events?: { type: string; handler: string }[] }[];
  egress?: { id: string }[];
  resources?: { id: string }[];
  channels?: { bindKey: string }[];
  bindings?: { id: string }[];
}

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
    for (const ev of i.events ?? []) if (!fns.has(ev.handler)) errs.push(`ingress '${i.id}' event '${ev.type}': handler '${ev.handler}' is not a function of this service`);
  }
  for (const f of e.functions ?? []) {
    const seqs = new Set<number>();
    for (const s of f.steps ?? []) {
      if (seqs.has(s.seq)) errs.push(`function '${f.id}': duplicate step seq ${s.seq}`);
      seqs.add(s.seq);
      const pool = s.type === 'call' ? fns : s.type === 'egress' ? egs : rs;
      if (!pool.has(s.target)) errs.push(`function '${f.id}' step ${s.seq}: ${s.type} target '${s.target}' not found`);
    }
  }
  return errs;
}
