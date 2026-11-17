// The verdict sentence of the Drivers page (#130), written from the data: what runs where, how many
// versions are behind, and what is unresolved. Segments carry a style so the page can colour the lag words.

import { lagLevel, type DriverTable } from './drivers.ts';

export interface Seg { t: string; s?: 'b' | 'lg1' | 'lg2' }
const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;
const WORD = ['none', 'one', 'two', 'three', 'four', 'five', 'six'];
const word = (x: number) => WORD[x] ?? String(x);

/** `label`: the store type's name ("Redis"). `query`: the query in words ("mongoose < 6"), empty when unfiltered. `table` is the filtered one; `unresolvedIn` / `unresolvedOut` count entries in and out of the result. */
export function verdictOf(label: string, query: string, table: DriverTable, unresolvedIn: number, unresolvedOut: number): Seg[] {
  const out: Seg[] = [];
  const vs = table.packages.flatMap((p) => p.versions);
  if (!query) {
    out.push({ t: `${label}: `, s: 'b' }, { t: `${n(table.packages.length, 'package')}, ${n(table.versions, 'version')}, ${n(table.components, 'component')}. ` });
    const multi = table.packages.filter((p) => p.majors.length > 1);
    multi.forEach((p, i) => out.push({ t: p.package, s: 'b' }, { t: ` ${i ? 'on' : 'runs on'} ${word(p.majors.length)}${i ? '' : ' majors'} (${p.majors.join(p.majors.length === 2 ? ' and ' : ', ')})${i < multi.length - 1 ? ', ' : '. '}` }));
  } else if (!vs.length) {
    out.push({ t: `No match for ${query} in ${label}. ` });
  } else {
    const comps = n(table.components, 'component');
    const only = vs.length === 1 ? `1 version (${vs[0].version})` : n(vs.length, 'version');
    out.push({ t: `${query} in ${label}: `, s: 'b' }, { t: `${comps} on ${only}. ` });
    const worst = vs.reduce((a, v) => (v.lag > a.lag ? v : a), vs[0]);
    const base = table.packages.find((p) => p.versions.includes(worst))!;
    if (worst.lag > 0) out.push({ t: `It is ${n(worst.lag, 'major')} behind ${base.baseline}.x`, s: lagLevel(worst.lag) === 2 ? 'lg2' : 'lg1' }, { t: `, the newest in use. ` });
  }
  const l1 = vs.filter((v) => v.lag === 1).length, l2 = vs.filter((v) => v.lag >= 2).length;
  if (!query) {
    if (l2) out.push({ t: `${n(l2, 'version')} ${l2 === 1 ? 'is' : 'are'} 2 or more majors behind`, s: 'lg2' }, { t: l1 ? ', ' : ' the newest major in use. ' });
    if (l1) out.push({ t: `${n(l1, 'version')} ${l1 === 1 ? 'is' : 'are'} one major behind. `, s: 'lg1' });
  }
  if (unresolvedIn) out.push({ t: `${n(unresolvedIn, 'entry', 'entries')} ${unresolvedIn === 1 ? 'is' : 'are'} unresolved (below). ` });
  else if (unresolvedOut) out.push({ t: `${n(unresolvedOut, 'unresolved entry', 'unresolved entries')} could be a different driver (below the table). ` });
  return out;
}

export const verdictText = (segs: Seg[]) => segs.map((s) => s.t).join('').trim();
