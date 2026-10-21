// Component colours (UI-GUIDE section 8): slot 1..8 per component from `GET /api/envs/meta` `colors`, drawn with `--cmp-<slot>`.
// A component, never a transport or a status. Client apps and infra have no slot: neutral (externals and data stores are not components of the meta).
// 0.28.1: inside one flow two components on one slot are told apart (`laneSlots`, core/colors.ts declash): the later one takes the next free slot for that flow only.

import { state } from '../state.js';
import { declash } from '../../core/colors.js';

const NEUTRAL = new Set(['client-app', 'infra']);

/** The slot (1..8) of a component in an environment, or null. `kind` is the component's serviceKind when known. */
export function slotOf(meta, env, service, kind) {
  if (!service || NEUTRAL.has(kind)) return null;
  const slot = meta?.find?.((m) => m.name === env)?.colors?.[service];
  return slot >= 1 && slot <= 8 ? slot : null;
}

/** The slots of the service columns of one lane, in column order, de-clashed for this flow: Map<service, slot>. The stored colours are not changed. */
export function laneSlots(columns, meta = state.envMeta, env = state.env) {
  return declash(columns.filter((c) => c.kind === 'service').map((c) => ({ name: c.service, slot: slotOf(meta, env, c.service, c.serviceKind) })));
}

/** The CSS colour of a component in the current environment (`var(--cmp-3)`), or null for neutral. `slot`: this flow's de-clashed slot, when known. */
export const cmpVar = (service, kind, slot = null) => { const n = slot ?? slotOf(state.envMeta, state.env, service, kind); return n ? `var(--cmp-${n})` : null; };

/** The colour of a lane column (a service with a slot): its flow slot `c.slot` (set by flow-render) or the stored one. */
export const colVar = (c) => (c?.kind === 'service' ? cmpVar(c.service, c.serviceKind, c.slot) : null);

/** The one colour a set of lifeline columns share (a Squeeze fold of one component), else null. */
export function sharedVar(cols) {
  const v = new Set(cols.map(colVar));
  return v.size === 1 ? [...v][0] : null;
}
