// Component colours (UI-GUIDE section 8): slot 1..8 per component from `GET /api/envs/meta` `colors`, drawn with `--cmp-<slot>`.
// A component, never a transport or a status. Client apps and infra have no slot: neutral (externals and data stores are not components of the meta).

import { state } from '../state.js';

const NEUTRAL = new Set(['client-app', 'infra']);

/** The slot (1..8) of a component in an environment, or null. `kind` is the component's serviceKind when known. */
export function slotOf(meta, env, service, kind) {
  if (!service || NEUTRAL.has(kind)) return null;
  const slot = meta?.find?.((m) => m.name === env)?.colors?.[service];
  return slot >= 1 && slot <= 8 ? slot : null;
}

/** The CSS colour of a component in the current environment (`var(--cmp-3)`), or null for neutral. */
export const cmpVar = (service, kind) => { const n = slotOf(state.envMeta, state.env, service, kind); return n ? `var(--cmp-${n})` : null; };

/** The one colour a set of lifeline columns share (a Squeeze fold of one component), else null. */
export function sharedVar(cols) {
  const v = new Set(cols.map((c) => (c.kind === 'service' ? cmpVar(c.service, c.serviceKind) : null)));
  return v.size === 1 ? [...v][0] : null;
}
