// The mark-step menu of the author (Unreleased, frame 28f, f3): while the flow doc is edited, a click on a step number in the diagram offers Key step, Watch
// and Risk; the choice adds a callout for that step (after the block the caret is in) and the badge appears on save. The step is still selected as usual.

import { openMenu } from '../components/context-menu.js';
import { CALLOUT_LABEL } from '../../core/callouts.js';
import { insertCallout } from './insert.js';

const ICON = { key: 'info', watch: 'warn', risk: 'warn' };
const HINT = { key: 'The call that matters', watch: 'Something to look at', risk: 'Something that can go wrong' };

/** markMenu(ed, { n, key }, ev): the menu at the pointer; `key` is the step's stable key (the callout follows it across scenarios). */
export function markMenu(ed, { n, key }, ev) {
  openMenu(ev?.clientX ?? 0, ev?.clientY ?? 0, `Mark step ${n}`, ['key', 'watch', 'risk'].map((k) => ({ label: CALLOUT_LABEL[k], icon: ICON[k], hint: `${HINT[k]}: add a callout for step ${n}`, onSelect: () => insertCallout(ed, k, n, key) })));
}
