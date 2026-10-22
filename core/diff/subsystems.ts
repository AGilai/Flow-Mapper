// Marks of a subsystem (grp:), derived from its members. `rawMarks` already marks `subsystem` and `link` rows (new, changed or removed, with ghosts);
// this adds what the rows cannot say: a subsystem is New when every component in it is New, Changed when a member changed or moved, or a link
// into it did. Reordering never marks (the diff drops `order`). A component has ONE subsystem, so a move shows on both boxes: "moved in" / "moved out".

import { rowId } from '../item-rows.ts';
import { topOf } from '../subsystems.ts';
import type { MarkInfo } from './index.ts';
import { normItem, stableJson } from './normalise.ts';
import type { Side } from './side.ts';
import { joinWhat } from './what.ts';

const headerOf = (side: Side, s: string) => side.rows.get(rowId({ service: s, list: 'header', key: '' }));
const membersOf = (side: Side): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const s of side.services) { const t = topOf(headerOf(side, s)?.data?.groupPath); if (t) out.set(t, [...(out.get(t) ?? []), s]); }
  return out;
};

/** Adds / replaces `grp:` marks in `marks` (the final per-anchor marks, after propagation). */
export function subsystemMarks(base: Side, cur: Side, marks: Map<string, MarkInfo>, prior?: Map<string, string>): void {
  // Moves: with a draft, against the environment as stored (`prior`); otherwise against the baseline, where a copied component has no groupPath (no move).
  const moves: { s: string; from: string; to: string }[] = [];
  for (const s of cur.services) {
    const a = prior ? (prior.has(s) ? prior.get(s) : undefined) : headerOf(base, s)?.data?.groupPath, b = headerOf(cur, s)?.data?.groupPath;
    if (a && b && topOf(a) !== topOf(b)) moves.push({ s, from: topOf(a), to: topOf(b) });
  }
  const label = (k: string) => cur.rows.get(rowId({ service: '', list: 'subsystem', key: k }))?.data?.label ?? k;
  if (prior) for (const m of moves) {
    const have = marks.get(`svc:${m.s}`), what = `subsystem: ${label(m.from)} \u2192 ${label(m.to)}`;
    if (have?.mark === 'new') continue;
    marks.set(`svc:${m.s}`, { mark: 'changed', what: joinWhat([...(have?.what ? [have.what] : []), what]) });
  }
  const mc = membersOf(cur), mb = membersOf(base);
  const keys = new Set<string>([...mc.keys(), ...[...cur.rows.values()].filter((r) => r.list === 'subsystem' && !r.key.includes('/')).map((r) => r.key)]);
  const linkEnds = (side: Side, key: string): string[] => [...side.rows.values()].filter((r) => r.list === 'link' && [r.data?.from, r.data?.to].some((a) => endIn(side, a, key))).map((r) => `link:${r.key}`);
  for (const key of keys) {
    const anchor = `grp:${key}`, raw = marks.get(anchor), members = mc.get(key) ?? [];
    if (raw?.mark === 'removed') continue;
    const mark = (s: string) => marks.get(`svc:${s}`)?.mark;
    const allNew = members.length > 0 && members.every((s) => mark(s) === 'new');
    const inn = moves.filter((m) => m.to === key).map((m) => m.s), out = moves.filter((m) => m.from === key).map((m) => m.s);
    if (raw?.mark === 'new' || allNew) {
      const w = joinWhat([...(allNew ? ['whole subsystem new'] : []), ...(inn.length ? [`moved in: ${inn.join(', ')}`] : [])]);
      marks.set(anchor, { mark: 'new', ...(w ? { what: w } : {}) }); continue;
    }
    const parts: string[] = [];
    const n = (m: string) => members.filter((s) => mark(s) === m).length;
    const gone = (mb.get(key) ?? []).filter((s) => !cur.services.has(s) && marks.get(`svc:${s}`)?.mark === 'removed').length;
    const kinds = [['new', n('new')], ['changed', n('changed')], ['removed', gone]].filter(([, c]) => c) as [string, number][];
    if (kinds.length) parts.push(kinds.map(([k, c]) => `${c} ${k} component${c === 1 ? '' : 's'}`).join(', '));
    const movedIn = inn, movedOut = out;
    if (movedIn.length) parts.push(`moved in: ${movedIn.join(', ')}`);
    if (movedOut.length) parts.push(`moved out: ${movedOut.join(', ')}`);
    const links = new Set([...linkEnds(cur, key), ...linkEnds(base, key)]);
    const lm = [...links].map((a) => marks.get(a)?.mark).filter(Boolean);
    if (lm.length) parts.push(lm.every((m) => m === 'new') ? `+${lm.length} link${lm.length === 1 ? '' : 's'}` : `${lm.length} link${lm.length === 1 ? '' : 's'} changed`);
    const b = base.rows.get(rowId({ service: '', list: 'subsystem', key })), c = cur.rows.get(rowId({ service: '', list: 'subsystem', key }));
    if (b && c) {
      const x = normItem('subsystem', b.data) as any, y = normItem('subsystem', c.data) as any;
      for (const f of ['label', 'icon', 'about']) if (stableJson(x?.[f]) !== stableJson(y?.[f])) parts.push(f);
    }
    const what = joinWhat(parts);
    if (what) marks.set(anchor, { mark: 'changed', what, ...(raw?.was ? { was: raw.was } : {}) });
    else if (raw && !parts.length && raw.mark === 'changed') marks.delete(anchor);
  }
}

/** Is the link end `a` (grp: / svc: / egr: / ing:) in subsystem `key`? Uses the headers of `side`. */
function endIn(side: Side, a: unknown, key: string): boolean {
  if (typeof a !== 'string') return false;
  if (a.startsWith('grp:')) return topOf(a.slice(4)) === key;
  const m = /^(?:svc|egr|ing):([^/]+)/.exec(a);
  return !!m && topOf(headerOf(side, m[1])?.data?.groupPath) === key;
}
