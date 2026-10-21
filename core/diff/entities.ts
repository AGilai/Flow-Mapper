// Per-row marks: an item absent in the base is new, absent in the current side is removed (with a ghost), present in both
// and not the same is changed. Functions compare by aligned steps; DTOs, event DTOs and schemas by field.

import { anchorOfRow, fieldAnchor } from '../anchors.ts';
import { rowLabel, type ItemRow } from '../item-rows.ts';
import type { Step } from '../types.ts';
import type { DiffOpts, Mark, MarkInfo } from './index.ts';
import { diffFields, fieldsOf, type FieldMark } from './fields.ts';
import { normItem, same, stableJson } from './normalise.ts';
import type { Side } from './side.ts';
import { alignSteps } from './steps.ts';
import { fieldCounts, joinWhat } from './what.ts';

export interface RawMark extends MarkInfo { row: { service: string; list: string; key: string }; fields?: FieldMark[]; isField?: true }
export interface Ghost { label: string; service?: string; type?: string }

const FIELDED = new Set(['dto', 'event_dto', 'schema']);
/** JSON of an item's data, remembered per object: baseline and environment rows are reused between comparisons, so each is stringified once. */
const jsonOf = (() => { const c = new WeakMap<object, string>(); return (d: any): string => { if (!d || typeof d !== 'object') return JSON.stringify(d); let j = c.get(d); if (j === undefined) c.set(d, (j = JSON.stringify(d))); return j; }; })();
const contentOf = (r: ItemRow) => (r.list === 'schema' ? r.data : r.data?.content);

/** The top-level keys whose normalised value differs. */
function changedKeys(list: string, a: any, b: any): string[] {
  const x = normItem(list, a) as any, y = normItem(list, b) as any;
  return [...new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})])].filter((k) => stableJson(x?.[k]) !== stableJson(y?.[k])).sort();
}

function stepWhat(a: Step[], b: Step[]): string[] {
  const d = alignSteps(a, b), name = (s: Step) => s.target ?? s.operation ?? s.note ?? s.type;
  const out: string[] = [];
  if (d.added.length) out.push(d.added.length === 1 ? `+1 step: ${name(d.added[0])}` : `+${d.added.length} steps`);
  if (d.removed.length) out.push(d.removed.length === 1 ? `−1 step: ${name(d.removed[0])}` : `−${d.removed.length} steps`);
  if (d.changed.length) out.push(`~${d.changed.length} step${d.changed.length === 1 ? '' : 's'}`);
  return out;
}

function changed(b: ItemRow, c: ItemRow): Omit<RawMark, 'row'> {
  if (c.list === 'header') return { mark: 'changed', what: `header: ${changedKeys('header', b.data, c.data).join(', ')}` };
  if (c.list === 'functions') {
    const { steps: sa, ...ra } = b.data, { steps: sb, ...rb } = c.data;
    const parts = [...(same('functions', { ...ra, steps: [] }, { ...rb, steps: [] }) ? [] : [`changed ${changedKeys('functions', ra, rb).join(', ')}`]), ...stepWhat(sa ?? [], sb ?? [])];
    return { mark: 'changed', what: joinWhat(parts) ?? 'steps reordered' };
  }
  const keys = changedKeys(c.list, b.data, c.data);
  const one = keys.length === 1 ? (b.data as any)[keys[0]] : undefined;
  return { mark: 'changed', what: `changed ${keys.join(', ')}`, ...(typeof one === 'string' || typeof one === 'number' ? { was: `was ${one}` } : {}) };
}

export function rawMarks(base: Side, cur: Side, _opts: DiffOpts): { marks: Map<string, RawMark>; ghosts: Record<string, Ghost> } {
  const marks = new Map<string, RawMark>(), ghosts: Record<string, Ghost> = {};
  const ids = new Set([...base.rows.keys(), ...cur.rows.keys()]);
  for (const id of ids) {
    const b = base.rows.get(id), c = cur.rows.get(id), r = (c ?? b)!;
    if (r.list === 'flow') continue;
    if (b && c && (b.data === c.data || jsonOf(b.data) === jsonOf(c.data))) continue; // identical: the common case, nothing to normalise
    const anchor = anchorOfRow(r), row = { service: r.service, list: r.list, key: r.key };
    if (!b || !c) {
      const mark: Mark = b ? 'removed' : 'new';
      marks.set(anchor, { mark, row });
      if (b) ghosts[anchor] = { label: rowLabel(r), service: r.service || undefined, type: r.list };
    } else if (FIELDED.has(r.list)) {
      const fm = diffFields(fieldsOf(contentOf(b)), fieldsOf(contentOf(c)));
      if (!fm.length) continue;
      marks.set(anchor, { mark: 'changed', what: fieldCounts(fm), row, fields: fm });
      for (const f of fm) marks.set(fieldAnchor(anchor, f.path), { mark: f.mark, ...(f.was ? { was: f.was } : {}), row, isField: true });
    } else if (!same(r.list, b.data, c.data)) marks.set(anchor, { ...changed(b, c), row });
  }
  return { marks, ghosts };
}
