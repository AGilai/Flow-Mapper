// The Drivers view as data (for MCP readers): per store type the verdict sentence, the packages with their versions, majors and lag,
// and the unresolved rows. Pure; the same selection and verdict as the page and the Markdown report (drivers-export.ts).

import { driverTable, type DriverPackage, type UnresolvedItem } from './drivers.ts';
import { selectDrivers, type DriversModel, type ExportOpts } from './drivers-export.ts';
import { kindLabel } from './driver-kinds.ts';
import { parseDriverQuery, formatDriverQuery } from './versions.ts';
import { verdictOf, verdictText } from './driver-verdict.ts';

export interface DriversKindView { kind: string; label: string; verdict: string; components: number; packages: DriverPackage[]; unresolved: UnresolvedItem[] }
export interface DriversView { env: string; filter: string; kinds: DriversKindView[] }

const uniq = (a: string[]) => [...new Set(a)].sort((x, y) => x.localeCompare(y));

/** One entry per store type left after the filters. Each package lists its versions with `major`, `lag` (majors behind the newest in the env), `components` and `via`; `majors` are the ones in use. */
export function driversView(m: DriversModel, o: ExportOpts): DriversView {
  const sel = selectDrivers(m, o);
  const kinds = sel.kinds.map((kind): DriversKindView => {
    const label = kindLabel(kind), ents = sel.entries.filter((e) => e.kind === kind), unr = sel.unresolved.filter((u) => u.kind === kind);
    const table = driverTable(ents, kind, m.base);
    const q = formatDriverQuery(parseDriverQuery(o.q ?? '', { packages: uniq(ents.map((e) => e.package)), components: uniq([...ents, ...unr].map((x) => x.service)) })) || (o.mixed ? 'mixed majors' : '');
    return { kind, label, verdict: verdictText(verdictOf(label, q, table, unr.length, 0)), components: table.components, packages: table.packages, unresolved: unr };
  });
  return { env: o.env, filter: sel.filter, kinds };
}
