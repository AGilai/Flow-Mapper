// The "n open questions" link of a pane header (0.33.0): a small warn-coloured button that scrolls to (the drawer) or opens (the expanded page) the Open questions block.

import { h } from '../dom.js';
import { questionsText } from './pane-pure.js';

/** The button, or null when there are no open questions. */
export const questionsButton = (n, onClick) => (n ? h('button.pane-q', { type: 'button', 'data-qa': 'pane-questions', title: 'Go to the open questions', on: { click: () => onClick?.() } }, questionsText(n)) : null);
