// Component colours (UI-GUIDE section 8): slot 1..8 per component from `GET /api/envs/meta` `colors`, drawn with `--cmp-<slot>`.
// A component, never a transport or a status. Client apps and infra have no slot: neutral in Component mode (#146: in Colour by Domain they take their family shade) (externals and data stores are not components of the meta).
// 0.28.1: inside one flow two components on one slot are told apart (lane-slots.js, core/colors.ts declash); a lane column then carries its flow slot `c.slot`, which `colVar` prefers.

import { state } from '../state.js';
import { familyOf, overrideOf, shadeVar } from './family-colours.js';

const NEUTRAL = new Set(['client-app', 'infra']);

/** The slot (1..8) of a component in an environment, or null. `kind` is the component's serviceKind when known. */
export function slotOf(meta, env, service, kind) {
  if (!service || NEUTRAL.has(kind)) return null;
  const slot = meta?.find?.((m) => m.name === env)?.colors?.[service];
  return slot >= 1 && slot <= 8 ? slot : null;
}

/** The CSS colour of a component in an environment (`var(--cmp-3)`; the current one unless `env` is given), or null for neutral. `slot`: this flow's de-clashed slot, when known. */
export const cmpVar = (service, kind, slot = null, env = state.env) => {
  if (!service) return null;
  if (NEUTRAL.has(kind)) { // #146: client apps and infra are grey in Component mode; in Domain mode a member of a group takes its family shade (a manual colour still wins), no group stays grey
    const fam = familyOf(env, service)?.shade; // null in Component mode and with no group
    if (!fam) return null;
    const o = overrideOf(env, service); return o ? `var(--cmp-${o})` : fam;
  }
  const ov = overrideOf(env, service); // frame 31: a manual colour replaces only this component's shade, in both modes
  if (ov) return `var(--cmp-${ov})`;
  const fam = shadeVar(env, service); // Colour by Domain: the component's shade of its family, flat grey with no group
  if (fam) return fam;
  const n = slot ?? slotOf(state.envMeta, env, service, kind); return n ? `var(--cmp-${n})` : null;
};
/** A component with a manual colour (the diamond on its header and map node). */
export const isCustom = (service, env = state.env) => !!service && overrideOf(env, service) != null;

/** The colour of a lane column (a service with a slot): its flow slot `c.slot` (set by flow-render) or the stored one, in the column's environment `c.env` (a tab of another env). */
export const colVar = (c) => (c?.kind === 'service' ? cmpVar(c.service, c.serviceKind, c.slot, c.env ?? state.env) : callerOf(c) ? cmpVar(callerOf(c), 'client-app', null, c.env ?? state.env) : null);
/** #146: the one client app that calls an entry (the caller head of flow-sub.js), whose family shade the head takes; null for several callers or any other column. */
export const callerOf = (c) => (c?.kind === 'client' && c.serviceKind === 'client-app' && c.callers?.length === 1 ? c.callers[0] : null);

/** The one colour a set of lifeline columns share (a Squeeze fold of one component), else null. */
export function sharedVar(cols) {
  const v = new Set(cols.map(colVar));
  return v.size === 1 ? [...v][0] : null;
}
