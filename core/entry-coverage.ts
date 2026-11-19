// #135 for readers of MCP: each entry-point row's open ends on the Flows list's basis, "X of Y flows fully traced", and a trace's open ends. Pure.

import { blockedSites, listBlocked, listIncomplete, openEnds, type Coverage } from './incomplete.ts';

type Row = { coverage?: Coverage | null };

/** Rows with `openEnds: {own, called}` where the harvester reports coverage. `own` is `coverage.blocked` (the flow's own service, what the list chip shows); `called` is null: the list has no trace, `trace_flow` knows. */
export const withOpenEnds = <R extends Row>(rows: R[]) => rows.map((r) => (r.coverage ? { ...r, openEnds: { own: listBlocked(r.coverage), called: null as number | null } } : r));

/** `full`: flows not reported incomplete; `reported`: flows whose harvester reports coverage at all (the UI hides the line when none does). */
export const tracedOf = (rows: Row[]) => ({ full: rows.length - rows.filter((r) => listIncomplete(r.coverage)).length, total: rows.length, reported: rows.filter((r) => r.coverage).length });

/** `openEnds` of a trace (as the header shows it): `own` / `called` distinct call sites, `sites` (at most 20) as {service, at: "<fn>#<seq> (file:line)", what}, `more` the ones past the list. */
export function traceOpenEnds(t: Parameters<typeof openEnds>[0] & { coverage?: Coverage | null }) {
  const { own, called } = openEnds(t, t.coverage), { sites, more } = blockedSites(t, t.coverage);
  return { own, called, sites: sites.map((s) => ({ service: s.service, at: `${s.fn}#${s.seq}${s.file ? ` (${s.file}${s.line ? ':' + s.line : ''})` : ''}`, what: s.plain || s.reason || s.call || 'target not resolved' })), ...(more ? { more } : {}) };
}
