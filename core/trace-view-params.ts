// The view parameters of the trace API (0.37.1, #82), pure: REST query strings, the preview's request and MCP arguments all become `ViewOptions`.
//   detail=simple|external|full   (default external; simple 0.44.0, #90)      choose=<group>:<arm>,<group>:<arm>   (an arm may be `both`; `*:both` makes both the default)
//   open=svc,svc:fn        dbOpen=<key>,<key>      unfold=<step key>,...  (copy the first expansion under these repeat markers)      group=0|1  (DB-op grouping; default on in external, off in full)

import type { ViewOptions } from './trace-view.ts';

const list = (v: unknown): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(String).map((s) => s.trim()).filter(Boolean);

/** `choose` as a string (`g:arm,g:arm`; the group is up to the first ':') or an object `{group: arm}`. Anything else throws (callers turn it into a 400). */
export function parseChoose(v: unknown): Record<string, string> {
  if (v === undefined || v === null || v === '') return {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const bad = Object.entries(v as Record<string, unknown>).find(([, a]) => typeof a !== 'string' || !a);
    if (bad) throw new Error(`choose: the arm of '${bad[0]}' must be a non-empty string`);
    return { ...(v as Record<string, string>) };
  }
  if (typeof v !== 'string' && !Array.isArray(v)) throw new Error('choose must be <group>:<arm>,... or an object {group: arm}');
  return Object.fromEntries(list(v).map((e) => {
    const i = /:(?:b\d+|both)$/.test(e) ? e.lastIndexOf(':') : e.indexOf(':'); // an alt group id has a colon (`<fn>:<altGroup>`), its arms are b1..bN
    if (i < 1 || i === e.length - 1) throw new Error(`choose: '${e}' is not <group>:<arm>`);
    return [e.slice(0, i), e.slice(i + 1)];
  }));
}

/** Throws an Error for a bad detail, choose or group (callers turn it into a 400). */
export function viewParams(q: { detail?: unknown; choose?: unknown; open?: unknown; dbOpen?: unknown; group?: unknown; unfold?: unknown }): ViewOptions {
  const d = q.detail === undefined || q.detail === null || q.detail === '' ? 'external' : String(q.detail);
  if (d !== 'simple' && d !== 'external' && d !== 'full') throw new Error('detail must be simple, external or full');
  const gs = q.group === undefined || q.group === '' || q.group === null ? undefined : String(q.group);
  if (gs !== undefined && !['1', 'true', 'on', '0', 'false', 'off'].includes(gs)) throw new Error('group must be 0 or 1');
  const g = gs === undefined ? undefined : ['1', 'true', 'on'].includes(gs);
  return { detail: d, choose: parseChoose(q.choose), open: list(q.open), dbOpen: list(q.dbOpen), ...(list(q.unfold).length ? { unfold: list(q.unfold) } : {}), ...(g === undefined ? {} : { group: g }) };
}
