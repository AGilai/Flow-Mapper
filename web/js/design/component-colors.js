// Component colours (UI-GUIDE section 8): slot 1..8 per component from `GET /api/envs/meta` `colors`, drawn with `--cmp-<slot>`.
// A component, never a transport or a status. Client apps and infra have no slot: neutral (externals and data stores are not components of the meta).
// 0.28.1: inside one flow two components on one slot are told apart (lane-slots.js, core/colors.ts declash); a lane column then carries its flow slot `c.slot`, which `colVar` prefers.

import { state } from '../state.js';

const NEUTRAL = new Set(['client-app', 'infra']);

/** The slot (1..8) of a component in an environment, or null. `kind` is the component's serviceKind when known. */
export function slotOf(meta, env, service, kind) {
  if (!service || NEUTRAL.has(kind)) return null;
  const slot = meta?.find?.((m) => m.name === env)?.colors?.[service];
  return slot >= 1 && slot <= 8 ? slot : null;
}

/** The CSS colour of a component in an environment (`var(--cmp-3)`; the current one unless `env` is given), or null for neutral. `slot`: this flow's de-clashed slot, when known. */
export const cmpVar = (service, kind, slot = null, env = state.env) => { const n = slot ?? slotOf(state.envMeta, env, service, kind); return n ? `var(--cmp-${n})` : null; };

/** The colour of a lane column (a service with a slot): its flow slot `c.slot` (set by flow-render) or the stored one, in the column's environment `c.env` (a tab of another env). */
export const colVar = (c) => (c?.kind === 'service' ? cmpVar(c.service, c.serviceKind, c.slot, c.env ?? state.env) : null);

/** The one colour a set of lifeline columns share (a Squeeze fold of one component), else null. */
export function sharedVar(cols) {
  const v = new Set(cols.map(colVar));
  return v.size === 1 ? [...v][0] : null;
}
