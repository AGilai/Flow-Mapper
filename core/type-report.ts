// What a service header still gets from legacy fields instead of `type` (0.68.0, frame 34): the pure part of scripts/type-report.ts.
// A header "relies on legacy" when its look comes from `details.icon` / `details.product` / `kind`, or its `type` is not in the catalogue.

import { SPECIFIC_TYPES, resolveType, typeInfo } from './component-types.ts';
import { iconKind } from './component-icons.ts';

export type Reason = 'builtin-icon' | 'custom-icon' | 'icon-no-type' | 'product-text' | 'unknown-type';
export interface Finding { reason: Reason; /** the legacy value (icon name, "<svg ...>" shortened, product text, unknown type) */ value: string; /** the type the component resolves to now */ resolves: string; resolvedSource: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const LABELS = new Map(SPECIFIC_TYPES.flatMap((t) => [[norm(t.label), t.id], [norm(t.id), t.id]] as [string, string][]));
const short = (s: string) => (s.length > 48 ? `${s.slice(0, 45)}...` : s);

/** The findings of one header ({type?, kind?, details?}): empty when it has a known type (or nothing legacy). */
export function findings(header: any): Finding[] {
  const r = resolveType(header), out: Finding[] = [], d = header?.details ?? {}, add = (reason: Reason, value: string) => out.push({ reason, value, resolves: r.id, resolvedSource: r.source });
  if (r.unknown) add('unknown-type', r.unknown);
  const icon = d.icon, k = iconKind(icon);
  if (typeof icon === 'string' && icon) {
    if (k === 'svg' || k === 'data') add('custom-icon', short(icon.replace(/\s+/g, ' ')));
    else if (k === 'builtin' && r.source === 'legacy-icon') add('builtin-icon', icon);
    else if (k === 'builtin' && !typeInfo(header?.type) && r.source !== 'declared') add('icon-no-type', icon); // aws-ec2, aws-iam: an icon with no catalogue type
  }
  const p = typeof d.product === 'string' ? d.product.trim() : '';
  if (p && !LABELS.has(norm(p)) && !(typeInfo(header?.type) && SPECIFIC_TYPES.some((t) => t.id === header.type && norm(t.label) === norm(p)))) add('product-text', short(p));
  return out;
}
