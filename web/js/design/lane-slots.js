// The colour slots of one flow (0.28.1): the stored slots of its components, de-clashed (core/colors.ts declash). Kept apart from component-colors.js, which the
// lane drawing (and its node tests) import and which must not reach into core/.

import { state } from '../state.js';
import { declash } from '../../core/colors.js';
import { slotOf } from './component-colors.js';

/** The slots of the service columns of one lane, in column order, de-clashed for this flow: Map<service, slot>. The stored colours are not changed. */
export function laneSlots(columns, meta = state.envMeta, env = state.env) {
  return declash(columns.filter((c) => c.kind === 'service').map((c) => ({ name: c.service, slot: slotOf(meta, env, c.service, c.serviceKind) })));
}
