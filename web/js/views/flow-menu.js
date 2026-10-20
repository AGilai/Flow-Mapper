// Menus in a flow's diagram: right-click a lifeline header (participantMenu) or an activation bar (barMenu).
// Looking inside a service is the drill-down panel; "Zoom in" opens the service's own flow from where this trace enters it.

import { go } from '../router.js';
import { openMenu } from '../components/context-menu.js';
import { servicePath } from './inventory-links.js';

/** ctx: { trace, scope } */
export function participantMenu(p, x, y, ctx) {
  const items = [];
  if (p.kind === 'service') items.push(zoomIn(p.service, ctx.trace));
  if (p.service) items.push('divider', { label: `Open ${p.service}`, icon: 'services', onSelect: () => go(servicePath(p.service)) });
  if (items.length) openMenu(x, y, p.label, items);
}

/** ctx: { trace, inside(), toIndex() | null } */
export function barMenu(bar, x, y, ctx) {
  const { trace } = ctx;
  const src = trace.code?.[`${bar.service}:${bar.msg.target?.fn}`];
  const items = [
    { label: `Show inside ${bar.service}`, icon: 'flow', hint: 'The functions this call runs. Same as double-click.', onSelect: ctx.inside },
    { label: 'Go to its async flows', icon: 'services', disabled: !ctx.toIndex, hint: ctx.toIndex ? 'The list of async flows under the diagram' : 'This flow starts no async flows', onSelect: () => ctx.toIndex?.() },
  ];
  if (src?.url) items.push({ label: 'Open the code', hint: src.file ? `${src.file}${src.line ? ':' + src.line : ''}` : src.repo, icon: 'external', onSelect: () => open(src.url, '_blank', 'noopener') });
  items.push(zoomIn(bar.service, trace), 'divider', { label: 'Open service page', icon: 'services', onSelect: () => go(servicePath(bar.service)) });
  openMenu(x, y, bar.service, items);
}

/** "Zoom in": the flow inside one service, entered where this trace first reaches it. */
function zoomIn(service, trace) {
  const entry = service === trace.start.service ? trace.start : trace.messages.find((m) => m.target?.service === service && m.target.fn)?.target;
  const event = service === trace.start.service ? trace.start.event : trace.messages.find((m) => m.target?.service === service)?.event;
  return {
    label: `Zoom in to ${service}`, icon: 'search', disabled: !entry,
    hint: entry ? `Its own flow, from ${entry.ingress ?? entry.fn}${event ? ` (${event})` : ''}` : 'The flow never enters a handler here',
    onSelect: () => go('/flows', { service, ingress: entry.ingress, fn: entry.ingress ? null : entry.fn, event, scope: 'intra' }),
  };
}
