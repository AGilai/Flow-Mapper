// An import set as the preview panel shows it, and as the ops that apply it. Pure.

import type { DraftOpInput, OpOrigin } from './draft-ops.ts';
import { anchorOfRow } from './anchors.ts';
import { labelOf, type ImportSet, type RefTarget, type Why } from './import-level.ts';

type Count = 'headers' | 'ingress' | 'functions' | 'egress' | 'resources' | 'channels' | 'bindings' | 'dtos' | 'messages' | 'schemas';
export interface ImportPreview {
  source: string; anchor: string; level: 'endpoint' | 'component'; total: number;
  counts: Record<Count, number>;
  /** Frame 10's list: the handler, how many functions it calls inside its component, the calls it makes, the stores it touches. */
  summary: { handler?: string; inside: number; calls: { anchor: string; label: string }[]; stores: { key: string; access?: string }[] };
  items: { anchor: string; why: Why; label: string }[];
  alreadyHere: ImportSet['alreadyHere']; references: RefTarget[]; warnings: string[];
}

const COUNT: Record<string, Count> = { header: 'headers', ingress: 'ingress', functions: 'functions', egress: 'egress', resources: 'resources', channels: 'channels', bindings: 'bindings', dto: 'dtos', event_dto: 'messages', schema: 'schemas' };

export function previewOf(set: ImportSet, anchor: string, source: string): ImportPreview {
  const counts = Object.fromEntries(Object.values(COUNT).map((k) => [k, 0])) as Record<Count, number>;
  for (const it of set.items) counts[COUNT[it.row.list]]++;
  const warnings: string[] = [];
  const bare = set.items.filter((it) => it.row.list === 'header' && !it.row.data.groupPath && it.row.data.kind !== 'infra').map((it) => it.row.service);
  if (bare.length) warnings.push(`${bare.join(', ')} ${bare.length === 1 ? 'is' : 'are'} not in a subsystem of this design (pass groupPath to place ${bare.length === 1 ? 'it' : 'them'})`);
  const differs = set.alreadyHere.filter((a) => a.differs).length;
  if (differs) warnings.push(`${differs} item(s) already in this design differ from ${source}: kept as in this design`);
  return {
    source, anchor, level: set.level, total: set.items.length, counts,
    summary: { ...(set.uses.handler ? { handler: set.uses.handler } : {}), inside: set.items.filter((it) => it.why === 'inside').length, calls: set.uses.calls, stores: set.uses.stores },
    items: set.items.map((it) => ({ anchor: anchorOfRow(it.row), why: it.why, label: labelOf(it.row) })),
    alreadyHere: set.alreadyHere, references: set.references, warnings,
  };
}

/** One upsert per item, headers first (the validation wants a service to exist before its entities); `origins[k]` belongs to `ops[k]`. */
export function importOps(set: ImportSet): { ops: DraftOpInput[]; origins: OpOrigin[] } {
  const items = [...set.items.filter((it) => it.row.list === 'header'), ...set.items.filter((it) => it.row.list !== 'header')];
  return {
    ops: items.map((it) => ({ op: 'upsert' as const, anchor: anchorOfRow(it.row), ...(it.row.list === 'channels' ? { service: it.row.service } : {}), data: it.row.data })),
    origins: items.map((it) => it.origin),
  };
}
