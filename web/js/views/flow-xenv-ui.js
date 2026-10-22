// The DOM of tabs of different environments (0.36.0): the read-only note under a foreign tab's strip and the body of an "unavailable" tab. Texts and the
// env chips are in flow-xenv.js (no DOM, tested).

import { h } from '../dom.js';
import { paintEnv } from '../components/env-chip.js';
import { noteText, goneText } from './flow-xenv.js';

/** The line under a foreign tab's strip: it is read only; the button makes `env` the page's. A design env shows its committed state (no draft). */
export const foreignNote = (env, design, onSwitch) => paintEnv(h('div.xenv-note', { role: 'note', 'data-qa': 'xenv-note' },
  h('span.xn-t', noteText(env)), design ? h('span.xn-s', 'Committed state, no draft.') : null,
  h('span.grow'), onSwitch ? h('button.btn.sm', { type: 'button', 'data-qa': 'xenv-switch', on: { click: onSwitch } }, `Switch to ${env}`) : null), env);

/** The body of a tab whose env was deleted (or never existed): no request is made for it. */
export const unavailableBox = (env, onClose) => h('div.content', h('div.xenv-gone', { role: 'note', 'data-qa': 'tab-unavailable' },
  h('b', goneText(env)),
  h('p', 'It was deleted, or the link names one that does not exist. Close this tab, or choose another environment.'),
  h('button.btn', { type: 'button', 'data-qa': 'tab-unavailable-close', on: { click: onClose } }, 'Close this tab')));
