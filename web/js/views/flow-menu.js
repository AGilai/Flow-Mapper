// Menu for a lifeline in a flow's sequence diagram. For a service: show its function calls here
// (expand the lifeline into one per function), or zoom in to that service on its own, starting from
// where the flow enters it. Functions, queues and data stores get their own shortcuts.

import { go } from '../router.js';
import { openMenu } from '../components/context-menu.js';
import { channelPath, servicePath, storePath } from './inventory-links.js';

/** ctx: { trace, scope, expanded: Set<string>, setExpanded(service, on) } */
export function participantMenu(p, x, y, ctx) {
  const { trace } = ctx;
  const items = [];
  if (p.kind === 'service') {
    const n = p.internalCalls ?? 0;
    const stopsHere = ctx.scope === 'intra' && p.service !== trace.start.service;
    items.push({
      label: 'Show its function calls here', icon: 'flow', disabled: !n || stopsHere,
      hint: stopsHere ? 'Switch to Full flow to follow the call into this service' : n ? `${n} internal ${n === 1 ? 'call' : 'calls'} in this flow` : 'No internal calls on this path',
      onSelect: () => ctx.setExpanded(p.service, true),
    });
    items.push(zoomIn(p.service, trace));
  }
  if (p.kind === 'function') {
    if (ctx.expanded.has(p.service)) items.push({ label: `Collapse ${p.service} to one lifeline`, icon: 'fit', onSelect: () => ctx.setExpanded(p.service, false) });
    else if (p.service !== trace.start.service || ctx.scope !== 'intra') items.push(zoomIn(p.service, trace));
    const src = trace.code?.[`${p.service}:${p.id.split(':').slice(2).join(':')}`];
    if (src?.url) items.push({ label: 'Open the code', hint: src.file ? `${src.file}${src.line ? ':' + src.line : ''}` : src.repo, icon: 'external', onSelect: () => open(src.url, '_blank', 'noopener') });
  }
  if (p.service && (p.kind === 'service' || p.kind === 'function')) items.push('divider', { label: `Open ${p.service}`, icon: 'services', onSelect: () => go(servicePath(p.service)) });
  if (p.kind === 'channel') items.push({ label: 'Open queue / topic details', icon: 'services', onSelect: () => go(channelPath(p.id.slice(3))) });
  if (p.kind === 'resource') items.push({ label: 'Open data store details', icon: 'database', onSelect: () => go(storePath(p.id.slice(4))) });
  if (items.length) openMenu(x, y, p.label, items);
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
