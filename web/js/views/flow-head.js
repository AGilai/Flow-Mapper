// The two collapsible description boxes of a flow page (0.20.0): the flow's, under its title, and the current step's, under the walk bar.
// Both are a <details> around a descBlock (Human text editable by click, AI text and its "outdated" flag as in 0.14.0). Open or closed is
// remembered per viewer in localStorage (the same for every flow); the page works without storage.

import { h } from '../dom.js';
import { descBlock } from './flow-desc.js';

const read = (k, dflt) => { try { const v = localStorage.getItem(`flow-mapper.${k}`); return v === null ? dflt : v === '1'; } catch { return dflt; } };
const write = (k, v) => { try { localStorage.setItem(`flow-mapper.${k}`, v ? '1' : '0'); } catch { /* storage unavailable */ } };

/**
 * descDetails(store, root, callee, { cls, remember, summary, title, quiet, onGenerate }) -> { el, dispose }
 * summary: nodes shown on the summary line.
 */
export function descDetails(store, root, callee, { cls, remember, summary, title, quiet = false, onGenerate }) {
  const block = descBlock(store, root, callee, { title, wholeFlow: callee === null, onGenerate, wide: true, quiet });
  const open = read(remember, true);
  const el = h(`details.${cls}`, { open, 'aria-label': title }, h('summary', summary), block.el);
  el.addEventListener('toggle', () => write(remember, el.open));
  return { el, dispose: block.dispose };
}
