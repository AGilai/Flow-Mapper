// Rules a design's ops must satisfy beyond the item schemas, checked after a whole request is laid over the rows (like the schema check):
//   NO_TARGET  a step with a `target` in a function the request upserts must name a function / egress / resource of that service
//   NO_GROUP   a component header's groupPath (or its first segment) must be '' or one of the environment's subsystems (the `subsystem` rows of the result)
//   GROUP_IN_USE  a deleted subsystem is still named by a component's groupPath or a link end (checked over the result: a request that moves the components passes)
//   BAD_ICON, BAD_KEY  subsystem settings; the rules of a link are core/abstract-links.ts checkLink
//   TWO_GROUPS (twoGroups) one request gives a component two different subsystems; `alsoIn` does not exist
//   BAD_KIND   (checked per op) a component kind must be one of SERVICE_KINDS

import { rowId, type ItemRow } from './item-rows.ts';
import { checkLink } from './abstract-links.ts';
import { aboutProblem } from './markdown-lite.ts';
import { SUBSYSTEM_ICONS, SUBSYSTEM_KEY, topOf } from './subsystems.ts';

export const SERVICE_KINDS = ['service', 'gateway', 'lambda', 'infra', 'client-app'] as const;
const WHAT: Record<string, string> = { call: 'functions', egress: 'egress', resource: 'resources' };

export interface Issue { index: number; code: string; message: string }

/** `after`: the rows with the whole request applied; `touched`: the request's upserts (index in the request, item name); `deleted`: its deletes.
 *  `groups`: pass an array (any) to have groupPaths checked; the subsystems themselves are read from the `subsystem` rows of `after`. */
export function designIssues(after: Map<string, ItemRow>, touched: { index: number; service: string; list: string; key: string }[], groups: string[] | undefined,
  deleted: { index?: number; service: string; list: string; key: string }[] = []): Issue[] {
  const out: Issue[] = [];
  const keys = new Set([...after.values()].filter((r) => r.list === 'subsystem').map((r) => r.key));
  let all: ItemRow[] | undefined;
  for (const t of touched) {
    const row = after.get(rowId(t));
    if (!row) continue;
    if (t.list === 'functions') {
      for (const st of row.data?.steps ?? []) {
        const list = WHAT[st.type];
        if (st.target && list && !after.has(rowId({ service: t.service, list, key: st.target }))) {
          out.push({ index: t.index, code: 'NO_TARGET', message: `step ${st.seq} of ${t.service}/${t.key} targets '${st.target}', which is not ${list === 'egress' ? 'an egress' : list === 'functions' ? 'a function' : 'a resource'} of ${t.service}` });
        }
      }
    } else if (t.list === 'header' && groups) {
      const g = row.data?.groupPath;
      if (g !== undefined && g !== '' && !keys.has(g) && !keys.has(topOf(g))) out.push({ index: t.index, code: 'NO_GROUP', message: `groupPath '${g}' of ${t.service} is not one of the environment's subsystems (${[...keys].join(', ') || 'none'})` });
    } else if (t.list === 'subsystem') {
      if (!SUBSYSTEM_KEY.test(t.key)) out.push({ index: t.index, code: 'BAD_KEY', message: `subsystem key '${t.key}' must be lowercase letters, digits and '-' (a path like platform/identity is allowed)` });
      const about = aboutProblem(row.data?.about);
      if (about) out.push({ index: t.index, code: 'BAD_ABOUT', message: `subsystem '${t.key}': ${about}` });
      const icon = row.data?.icon;
      if (icon !== undefined && !(SUBSYSTEM_ICONS as readonly string[]).includes(icon)) out.push({ index: t.index, code: 'BAD_ICON', message: `icon '${icon}' of subsystem '${t.key}' must be one of ${SUBSYSTEM_ICONS.join(', ')}` });
    } else if (t.list === 'link') {
      all ??= [...after.values()];
      for (const i of checkLink(t.key, row.data, all)) out.push({ index: t.index, code: i.code, message: `link '${t.key}': ${i.message}` });
    }
  }
  for (const d of deleted.filter((x) => x.list === 'subsystem' && !keys.has(x.key))) {
    all ??= [...after.values()];
    const comps = all.filter((r) => r.list === 'header' && r.data?.groupPath === d.key || topOf(r.data?.groupPath) === d.key).map((r) => r.service);
    const links = all.filter((r) => r.list === 'link' && [r.data?.from, r.data?.to].includes(`grp:${d.key}`)).map((r) => r.key);
    if (comps.length || links.length) out.push({ index: d.index ?? 0, code: 'GROUP_IN_USE', message: `subsystem '${d.key}' is still used by ${[comps.length ? `component(s) ${comps.join(', ')}` : '', links.length ? `link(s) ${links.join(', ')}` : ''].filter(Boolean).join(' and ')}: move them first` });
  }
  return out;
}

/** One request must not give a component two different subsystems (and a header carries no `alsoIn`: a component has one subsystem). */
export function twoGroups(ops: { index: number; op: string; service: string; list: string; data?: any }[]): Issue[] {
  const out: Issue[] = [], seen = new Map<string, string>();
  for (const o of ops) {
    if (o.list !== 'header' || o.op !== 'upsert') continue;
    const also = o.data?.alsoIn ?? o.data?.details?.alsoIn;
    if (also !== undefined) out.push({ index: o.index, code: 'TWO_GROUPS', message: `${o.service}: a component belongs to one subsystem; 'alsoIn' is not supported: pick one (groupPath)` });
    const g = o.data?.groupPath;
    if (typeof g !== 'string' || !g) continue;
    const first = seen.get(o.service);
    if (first !== undefined && topOf(first) !== topOf(g)) out.push({ index: o.index, code: 'TWO_GROUPS', message: `${o.service} is given two subsystems in one request ('${first}' and '${g}'): pick one` });
    else if (first === undefined) seen.set(o.service, g);
  }
  return out;
}
