// The Type row of a component's info pane (CR #148 follow-up): the large lifeline head no longer draws the type line, so the pane says it.
import { RUNTIME_NAMES, runtimeOf } from '../components/ext-links.js';

export const KIND = { service: 'Service', gateway: 'Gateway', lambda: 'Lambda', 'client-app': 'Client app', infra: 'Infrastructure' };

/** The specific runtime (e.g. "Kubernetes pod") when the manifest knows it, else the kind (Gateway, Lambda…), else the word "Service": never empty. */
export const typeOf = (svc, kind) => RUNTIME_NAMES[runtimeOf(svc)] ?? KIND[kind] ?? 'Service';

// Frame 34 (0.68.0): the Type row, the one `type` of a component (generic . specific). `typeParts(svc)` is the pure reading; `typeText(svc)` its words ("IDP · Auth0", "IDP", "Service").
import { resolveType, typeInfo, typeLabel } from '../components/type-info.js';

/** { id, generic, genericLabel, specific: label | null, unknown: the declared value outside the catalogue | null, source } of a component header. */
export function typeParts(svc) {
  const r = resolveType(svc ?? {}), spec = r.id !== r.generic;
  return { id: r.id, generic: r.generic, genericLabel: typeLabel(r.generic), specific: spec ? typeInfo(r.id).label : null, unknown: r.unknown ?? null, source: r.source };
}

/** "IDP · Auth0" (a specific type), "IDP" (generic only), "Service" (none or unknown). */
export const typeText = (svc) => { const p = typeParts(svc); return p.specific ? `${p.genericLabel} · ${p.specific}` : p.genericLabel; };
