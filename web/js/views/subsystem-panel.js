// Side panels of the subsystem level (0.28.1): a rolled-up line (its calls, and the abstract links refined into it) and a box (its components with
// "go down" links, what goes in and out, the links that end in it). The abstract link's own panel is design/link-panel.js.

import { h } from '../dom.js';
import { href } from '../router.js';
import { chip } from '../format.js';
import { section } from '../components/panel.js';
import { glyph } from '../components/status-mark.js';
import { subIcon } from '../icons.js';
import { lineLabel } from '../graph/subsystem-layout.js';
import { aboutBlock } from '../components/about.js';

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

/** boxPanel(box, { map, marks, label, onGo, onLink, onEdit? }) -> [head, ...body]. `onEdit`: a draft is open (the About block gets an Edit button; a derived subsystem has no settings row to hold it). */
export function boxPanel(box, { map, marks, label, onGo, onLink, onEdit = null }) {
  const m = marks.markOf(`grp:${box.key}`), links = map.abstract.filter((v) => v.from.subsystem === box.key || v.to.subsystem === box.key);
  const head = h('div.stack', { style: { gap: '4px' } }, h('h2.titled', box.icon ? subIcon(box.icon, 22) : null, h('span', box.label)),
    h('div.row', h('span.small.muted', `${box.components.length} ${box.components.length === 1 ? 'component' : 'components'}${box.derived ? ' · named by a groupPath only' : ''}`),
      m ? h(`span.mark.${m.mark === 'new' ? 'new' : 'chg'}`, glyph(m.mark), m.what ?? (m.mark === 'new' ? 'New' : 'Changed')) : null));
  const comp = (c) => { const cm = marks.markOf(`svc:${c.name}`)?.mark; return h('div.list-item', h('button.btn.ghost.sm.grow', { type: 'button', style: { justifyContent: 'flex-start' }, 'data-qa': 'go-down', title: `Open ${c.name} at component level`, on: { click: () => onGo(c.name) } }, c.name), cm ? h(`span.mark.${cm === 'new' ? 'new' : 'chg'}`, glyph(cm), cm === 'new' ? 'New' : 'Changed') : null, h('span.xs.muted', c.kind)); };
  return [head, [
    aboutBlock(box.about, { onEdit: onEdit && !box.derived ? () => onEdit(box) : null }),
    h('dl.kv', h('dt', 'Calls inside'), h('dd', String(box.internal)), h('dt', 'Calls out'), h('dd', String(box.out)), h('dt', 'Calls in'), h('dd', String(box.in)), h('dt', 'Calls to nothing'), h('dd', { style: { color: box.dangling ? 'var(--bad)' : '' } }, String(box.dangling))),
    h('div.row', h('a.btn.primary', { href: href('/inventory', { subsystem: box.key || '-' }) }, 'Open in Inventory')),
    section('Components', box.components.length, h('div.list', box.components.slice(0, MAX).map(comp))),
    links.length ? section('Abstract links', links.length, h('div.list', links.map((v) => h('div.list-item', h('button.btn.sm.ghost.grow', { type: 'button', style: { justifyContent: 'flex-start' }, on: { click: () => onLink(v) } }, v.name), h('span.pill', v.state))))) : null]];
}
