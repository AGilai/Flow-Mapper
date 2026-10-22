// The partial-flow line (frame 10), under the step bar of a design flow that runs into references: a neutral note that says which steps
// continue into a reference, with an "Import step k" link for each (Edit with a draft) or "Open in <source>" (View). Absent when the trace has no `partial`.
// Step numbers are the walk's own (flow-steps.js), so they match the tiles; pure text in flow-refs.js.

import { h } from '../dom.js';
import { href } from '../router.js';
import { partialItems, partialLead, partialLabel } from './flow-refs.js';

/** createPartial({ trace, editing, onImport(anchor, source), onStep(n) }) -> { el, update(steps) } */
export function createPartial({ trace: traceOf, editing = false, onImport, onStep }) {
  const trace = { get partial() { return (typeof traceOf === 'function' ? traceOf() : traceOf).partial; }, get messages() { return (typeof traceOf === 'function' ? traceOf() : traceOf).messages; } }; // 0.38.0: a function: the tab's view changes
  const el = h('div.info.partial', { role: 'note', 'data-qa': 'partial-line', hidden: true });
  function update(steps) {
    const items = partialItems(trace.partial, trace.messages, steps);
    el.hidden = !items.length;
    if (!items.length) { el.replaceChildren(); return; }
    const acts = items.flatMap((it, i) => [i ? ' · ' : null, editing
      ? h('a', { href: '#', 'data-qa': 'import-step', on: { click: (e) => { e.preventDefault(); if (it.n) onStep?.(it.n); onImport(it.anchor, it.source); } } }, it.n ? `Import step ${it.n}` : `Import ${it.service}`)
      : h('a', { href: href('/flows', { env: it.source, tabs: `${it.service}/${it.ingress}` }) }, `Open ${it.n ? `step ${it.n} ` : ''}in ${it.source}`)]);
    el.replaceChildren(h('span', h('b', 'Partial flow:'), partialLead(items.length).replace('Partial flow:', ''), ' ',
      items.map((it, i) => [i ? ', ' : null, h('span.mono', partialLabel(it))]), '.'), h('span.acts', acts));
  }
  return { el, update };
}
