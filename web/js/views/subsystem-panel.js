// Side panel of a rolled-up line at the subsystem level (0.28.1): its calls, and the abstract links refined into it. A box opens the info pane (0.33.0,
// pane/pane-subsystem.js); the abstract link's own panel is design/link-panel.js.

import { h } from '../dom.js';
import { href } from '../router.js';
import { chip } from '../format.js';
import { section } from '../components/panel.js';
import { lineLabel } from '../graph/subsystem-layout.js';

const MAX = 40;
const svcLink = (n) => h('a', { href: href(`/services/${encodeURIComponent(n)}`) }, n);

/** linePanel(line, { map, label, onLink }) -> [head, ...body] for panel.open(). `label(key)`: a subsystem's name. */
export function linePanel(l, { map, label, onLink }) {
  const head = h('div.stack', { style: { gap: '4px' } }, h('h2', `${label(l.from)} ${l.merged ? '↔' : '→'} ${label(l.to)}`),
    h('div.row', l.transports ? l.transports.map((t) => chip(t)) : chip(l.transport), l.merged ? null : h('span.pill', l.mode === 'async' ? 'Async' : 'Sync'), h('span.xs.muted', lineLabel(l))));
  const calls = l.calls.slice(0, MAX).map((c) => h('div.ss-call', { 'data-qa': 'ss-call' },
    h('div', svcLink(c.from.service), h('span.muted', ` · ${c.from.egress} → `), svcLink(c.to.service), h('span.muted', ` · ${c.to.ingress}`)),
    h('div.xs', h('span.key', c.bindKey), ' ', h('a.xs', { href: href('/flows', { tabs: `${c.to.service}/${c.to.ingress}` }) }, 'flow'))));
  const inc = (l.links ?? []).map((id) => map.abstract.find((v) => v.id === id)).filter(Boolean);
  return [head, [
    section('Calls', l.calls.length, h('div.stack', { style: { gap: 'var(--s2)' } }, calls), l.calls.length > MAX ? h('p.xs.muted', `${l.calls.length - MAX} more. Open the service view to see all.`) : null),
    inc.length ? section('Includes', inc.length, h('div.list', inc.map((v) => h('div.list-item', h('span.xs.muted', 'includes: '), h('button.btn.sm.ghost', { type: 'button', 'data-qa': 'includes-link', on: { click: () => onLink(v) } }, v.name), h('span.xs.muted', '(refined)'))))) : null]];
}
