// #109: the toolbar checkbox "One arrow per target" (Simple only), remembered per viewer (flow-prefs.js). A change reloads every trace: the server merges.

import { h } from '../dom.js';
import { mergeSave } from './flow-prefs.js';

/** createMergeCheck(opts, reload) -> { el, setSimple(bool) } (opts.merge is the state; the box is disabled outside Simple). */
export function createMergeCheck(opts, reload) {
  const input = h('input', { type: 'checkbox', checked: opts.merge, on: { change: (e) => { opts.merge = e.target.checked; mergeSave(opts.merge); reload(); } } });
  const el = h('label.check', { 'data-qa': 'merge-check', title: 'Simple: all calls of one service to one target inside one activation are one arrow, whatever lies between them. Off: only calls to one store that follow each other.' }, input, 'One arrow per target');
  return { el, setSimple: (on) => { input.disabled = !on; el.classList.toggle('disabled', !on); } };
}
