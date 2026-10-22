// The env colour as chrome (UI-GUIDE 8b): a round swatch and a chip with the env name. The colour never carries meaning alone: the name is always there.

import { h } from '../dom.js';
import { state } from '../state.js';
import { envVars, envSlotOf } from '../env-info.js';
import { envColorName } from '../../core/env-colors.js';

const envColorLabel = (list, name) => envColorName(envSlotOf(list, name));

/** Put the env's `--ec` / `--ei` on an element (the CSS reads them). */
export function paintEnv(el, name = state.env, list = state.envMeta) {
  for (const [k, v] of Object.entries(envVars(list, name))) el.style.setProperty(k, v);
  return el;
}
/** A small round swatch of the env's colour (decorative: the name is next to it). */
export const envDot = (name = state.env, list = state.envMeta) => paintEnv(h('span.env-dot', { 'aria-hidden': 'true' }), name, list);
/** A chip: tinted ground, coloured ink, the env name. `title` carries the colour name. */
export const envChip = (name = state.env, list = state.envMeta) => paintEnv(h('span.env-chip', { title: `Environment ${name} (${envColorLabel(list, name)})` }, h('i.env-dot', { 'aria-hidden': 'true' }), name), name, list);
