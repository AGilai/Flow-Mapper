// The legends of the system map: the component level's (services, queues, transports, marks) and the subsystem level's (rolled-up line, abstract link, open end).

import { h } from '../dom.js';
import { isDesign } from '../state.js';
import { markLegend } from './system-marks.js';

const item = (svg, label) => h('span.legend-item', h('span', { html: svg }), label);
const line = (extra, label, w = 22) => item(`<svg width="${w}" height="6"><path d="M1 3h${w - 2}" ${extra}/></svg>`, label);

/** The component level's legend; `regions`: subsystem regions are drawn. */
export function legend(marks, data, { regions = false } = {}) {
  return h('div.legend', { 'aria-hidden': 'true' },
    item('<svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>', 'Service'),
    item('<svg width="14" height="14"><rect x="2" y="2" width="10" height="10" rx="3" fill="currentColor"/></svg>', 'Gateway'),
    item('<svg width="14" height="14"><path d="M7 1l6 6-6 6-6-6z" fill="var(--t-sqs)"/></svg>', 'Queue / topic'),
    item('<svg width="14" height="14"><rect x="3" y="3" width="8" height="8" fill="none" stroke="var(--t-res)" stroke-width="1.6"/></svg>', 'Data store'),
    regions ? item('<svg width="18" height="14"><rect x="1" y="2" width="16" height="10" rx="3" fill="var(--surface-2)" stroke="var(--line-strong)"/></svg>', 'Subsystem (click to open its components in Inventory)') : null,
    line('stroke="var(--ink-2)" stroke-width="1.6"', 'Sync call (waits for the reply)'),
    line('stroke="var(--ink-2)" stroke-width="1.6" stroke-dasharray="4 3"', 'Async (queue, topic, event)'),
    line('stroke="var(--t-socket)" stroke-width="3" stroke-linecap="round"', 'Client socket entry (tls / tcp / ws)'),
    line(`stroke="${isDesign() ? 'var(--ink-2)' : 'var(--t-broken)'}" stroke-width="1.6" stroke-dasharray="4 3"`, isDesign() ? 'Target not in this design' : 'Broken (no target matches)'),
    markLegend(item, marks, data));
}

/** The subsystem level's legend: a rolled-up line (colour = transport, thickness = how many calls), an abstract link and its open end. */
export function subsystemLegend() {
  return h('div.legend', { 'aria-hidden': 'true' },
    line('stroke="var(--t-http)" stroke-width="3"', 'Rolled-up calls: one line per direction and transport; thicker means more calls', 26),
    line('stroke="var(--t-amqp)" stroke-width="2" stroke-dasharray="5 4"', 'Async', 26),
    item('<svg width="34" height="12"><circle cx="6" cy="6" r="4.2" fill="var(--surface)" stroke="var(--ink-2)" stroke-width="1.6"/><path d="M12 6h18" stroke="var(--ink-2)" stroke-width="1.8" stroke-dasharray="5 3"/><circle cx="29" cy="6" r="4.2" fill="var(--surface)" stroke="var(--ink-2)" stroke-width="1.6"/></svg>', 'Abstract link: dashed, open ends (no component there yet)'));
}
