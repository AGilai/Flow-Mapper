// Registers an environment's domain colour families (frame 31): the groups of a GET /subsystems payload, painted by core/domain-colours.ts. Kept apart from
// family-colours.js, which the lane drawing and its node tests import and which must not reach into core/.

import { groupsOf, familyCss, paintFamilies, PALETTE } from '../../core/domain-colours.js';
import { registerFamilies, nextPrefix } from './family-colours.js';

/** Called by subsystems-store.js on every load of an environment's subsystems. */
export function installFamilies(env, payload) {
  const groups = groupsOf(payload);
  if (!groups.length) return registerFamilies(env, null);
  const f = familyCss(nextPrefix(env), groups);
  registerFamilies(env, { prefix: f.css.match(/--f[cds]-(e\d+)-/)?.[1], groups, css: f.css, comp: f.comp, dom: f.dom, sub: f.sub, paint: (t) => paintFamilies(t, groups), grey: { light: PALETTE.light.grey, dark: PALETTE.dark.grey } });
}
