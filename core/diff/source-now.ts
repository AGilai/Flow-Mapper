// The rows of the source environments, now, for the components a design copied or imported (`against=source`). Pure: the caller hands over
// each source environment's current rows (null when that environment is gone: its rows are then compared with themselves, so no drift).
//   Per source: for each baseline service with a header, the source's current rows of it (all lists; `functions` only when the baseline brought
//   functions of it with the copy, else only those it knows: an import of one endpoint brings a few) and its DTOs. A component that came in by an
//   import (taken after the design was copied, `copiedAt`) is partial: only the rows the baseline knows are compared. A baseline service the
//   source does not have is looked up item by item (the synthetic `<source>-infra` that holds copied channels and bindings); env-scoped rows
//   (event DTOs, schemas) whose key is in the baseline. `vanished` = copied components the source no longer has.

import { DESIGN_LISTS, rowId, type ItemRow } from '../item-rows.ts';

export interface BaseRow extends ItemRow { sourceEnv: string; sourceVersion: number | null; takenAt: string }

export function sourceNow(sources: Map<string, ItemRow[] | null>, base: BaseRow[], copiedAt?: string | null): { rows: ItemRow[]; vanished: Set<string> } {
  const out: ItemRow[] = [], vanished = new Set<string>();
  const groups = new Map<string, BaseRow[]>();
  for (const r of base) groups.set(r.sourceEnv, [...(groups.get(r.sourceEnv) ?? []), r]);
  for (const [source, mine] of groups) {
    const src = sources.get(source);
    if (!src) out.push(...mine.map(({ service, list, key, data }) => ({ service, list, key, data })));
    else fromSource(src, mine, out, vanished, copiedAt);
  }
  return { rows: out, vanished };
}

const isDesign = (r: ItemRow) => (DESIGN_LISTS as readonly string[]).includes(r.list);

function fromSource(src: ItemRow[], base: BaseRow[], out: ItemRow[], vanished: Set<string>, copiedAt?: string | null) {
  const bySvc = new Map<string, ItemRow[]>();
  for (const r of src) bySvc.set(r.service, [...(bySvc.get(r.service) ?? []), r]);
  const find = (list: string, key: string) => src.find((r) => r.list === list && r.key === key && r.service !== '');
  const known = new Set(base.map((r) => rowId(r)));
  for (const h of base.filter((r) => r.list === 'header')) {
    const mine = bySvc.get(h.service);
    const fns = base.filter((r) => r.service === h.service && r.list === 'functions');
    const fnsCopied = copiedAt == null ? fns.length > 0 : fns.some((r) => r.takenAt === copiedAt);
    const partial = copiedAt != null && h.takenAt !== copiedAt;
    if (mine?.some((r) => r.list === 'header')) {
      out.push(...mine.filter((r) => (r.list === 'functions' ? fnsCopied || known.has(rowId(r)) : !partial || r.list === 'header' || known.has(rowId(r)))));
      continue;
    }
    if (h.sourceVersion !== null) { vanished.add(h.service); continue; }
    out.push({ service: h.service, list: 'header', key: '', data: h.data });
    for (const b of base.filter((r) => r.service === h.service && r.list !== 'header')) {
      const hit = b.list === 'bindings' ? bindingOf(src, b.key) : find(b.list, b.key);
      if (hit) out.push({ service: h.service, list: b.list, key: b.key, data: b.list === 'bindings' ? { ...hit.data, id: b.key } : hit.data });
    }
  }
  const keys = new Set(base.filter((r) => r.service === '' && !isDesign(r)).map((r) => rowId(r)));
  out.push(...(bySvc.get('') ?? []).filter((r) => keys.has(rowId(r))));
  // Subsystems, links and relations are design content: the source never has them, so they pass through as the baseline has them (new against the source too).
  out.push(...base.filter(isDesign).map(({ service, list, key, data }) => ({ service, list, key, data })));
}

/** A binding copied under the synthetic infra owner is keyed `<service>.<id>`: find it in the source by trying each split. */
function bindingOf(src: ItemRow[], key: string): ItemRow | undefined {
  for (let i = key.indexOf('.'); i > 0; i = key.indexOf('.', i + 1)) {
    const hit = src.find((r) => r.list === 'bindings' && r.service === key.slice(0, i) && r.key === key.slice(i + 1));
    if (hit) return hit;
  }
}
