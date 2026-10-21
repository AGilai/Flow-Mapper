// The two collapsible description boxes of a flow page (0.20.0): the flow's, under its title, and the current step's, under the walk bar.
// Both are a <details> around a descBlock (Human text editable by click, AI text and its "outdated" flag as in 0.14.0). Open or closed is
// remembered per viewer in localStorage (the same for every flow); the page works without storage.

import { h } from '../dom.js';
import { descBlock, fmtDate } from './flow-desc.js';

const read = (k, dflt) => { try { const v = localStorage.getItem(`flow-mapper.${k}`); return v === null ? dflt : v === '1'; } catch { return dflt; } };
const write = (k, v) => { try { localStorage.setItem(`flow-mapper.${k}`, v ? '1' : '0'); } catch { /* storage unavailable */ } };

/**
 * descDetails(store, root, callee, { cls, remember, summary, title, quiet, onGenerate }) -> { el, dispose }
 * summary: nodes shown on the summary line. status: a span at its right end that says what is there ("Description · Human, edited 21 Oct · AI version available").
 */
const statusText = (d, callee) => {
  const p = d ? (callee ? d.callees[callee] : d.flow) : null;
  if (!p) return '';
  const parts = [p.human ? `Human, edited ${fmtDate(p.human.editedAt)}` : null, p.ai ? (p.ai.outdated ? 'AI version outdated' : 'AI version available') : null].filter(Boolean);
  return parts.length ? `Description · ${parts.join(' · ')}` : 'No description yet';
};
export function descDetails(store, root, callee, { cls, remember, summary, title, quiet = false, onGenerate }) {
  const block = descBlock(store, root, callee, { title, wholeFlow: callee === null, onGenerate, wide: true, quiet });
  const open = read(remember, true);
  const status = h('span.xs.muted.fh-src');
  const el = h(`details.${cls}`, { open, 'aria-label': title }, h('summary', summary, status), block.el);
  const unwatch = store.watch(root, (d) => { status.textContent = statusText(d, callee); });
  el.addEventListener('toggle', () => write(remember, el.open));
  return { el, dispose: () => { unwatch(); block.dispose(); } };
}
