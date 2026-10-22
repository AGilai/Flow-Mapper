// "Not in this scenario · Show" (0.38.0, #82 part 3, frame 21h): what a comment, an action item or a note shows in place of "step 5" when the step it is attached to
// is not in the scenario that is drawn. Show switches the decision to the arm that holds the step ("Not in this view": it loads the Full detail). Nothing is deleted.

import { h } from '../dom.js';

/** hid: { text, locked, show() } from walk.hiddenOf(key). */
export function hiddenPill(hid) {
  return h('span.spill.hid', { 'data-qa': 'step-hidden', title: hid.locked ? 'A fixed decision keeps this step out of the flow' : 'The step is on an arm (or in a detail) that is not drawn. Nothing was removed.' },
    hid.text, ' · ', h('button.show', { type: 'button', disabled: !!hid.locked, 'data-qa': 'step-show', title: hid.locked ? 'Fixed by the caller: it cannot be changed here' : 'Show it', on: { click: (e) => { e.stopPropagation(); hid.show(); } } }, 'Show'));
}
