// The view parameters of the trace API (0.37.1, #82), pure: REST query strings, the preview's request and MCP arguments all become `ViewOptions`.
//   detail=external|full   (default external)      choose=<group>:<arm>,<group>:<arm>   (an arm may be `both`; `*:both` makes both the default)
//   open=svc,svc:fn        dbOpen=<key>,<key>      group=0|1  (DB-op grouping; default on in external, off in full)

import type { ViewOptions } from './trace-view.ts';

const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(String).map((s) => s.trim()).filter(Boolean);

/** `choose` as a string (`g:arm,g:arm`; the group is up to the first ':') or an object `{group: arm}`. */
export function parseChoose(v: unknown): Record<string, string> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, a]) => [k, String(a)]));
  return Object.fromEntries(list(v).flatMap((e) => { const i = e.indexOf(':'); return i > 0 ? [[e.slice(0, i), e.slice(i + 1)]] : []; }));
}

/** Throws `Error('detail must be external or full')` for a detail that is neither (callers turn it into a 400). */
export function viewParams(q: { detail?: unknown; choose?: unknown; open?: unknown; dbOpen?: unknown; group?: unknown }): ViewOptions {
  const d = q.detail === undefined || q.detail === null || q.detail === '' ? 'external' : String(q.detail);
  if (d !== 'external' && d !== 'full') throw new Error('detail must be external or full');
  const g = q.group === undefined || q.group === '' || q.group === null ? undefined : ['1', 'true', 'on'].includes(String(q.group));
  return { detail: d, choose: parseChoose(q.choose), open: list(q.open), dbOpen: list(q.dbOpen), ...(g === undefined ? {} : { group: g }) };
}
