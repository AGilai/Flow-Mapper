// Redis instance page (#29): identity, the verdict with callouts that open key rows, who connects (service ->
// access -> client and databases, a click docks the client), and the keys, loaded on request and grouped by owner.
// See design/mockups/redis-instance.html.

import { h } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { href } from '../router.js';
import { ago } from '../format.js';
import { pageHead } from '../components/page.js';
import { createPanel } from '../components/panel.js';
import { objectIcon, titled } from '../components/object-icon.js';
import { VERIFIED } from '../components/declaration.js';
import { codeLink } from './detail-parts.js';
import { clientPane, lanes } from './instance-lanes.js';
import { keysSection } from './instance-keys.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] ?? '');

/** The one line under the title: what is known about the instance itself (version and nodes only when harvested). */
function summaryLine(v) {
  const s = v.keys.summary;
  return [v.engineVersion ? `Redis ${v.engineVersion}` : null, v.nodes ? plural(v.nodes, 'node') : null, v.databases ? plural(v.databases, 'db') : null,
    s ? plural(s.templates, 'key template') : null].filter(Boolean).join(' · ');
}

function meta(v) {
  const d = v.definition, at = d?.source;
  const where = at?.url ? codeLink(`${(at.file ?? 'source').split('/').pop()}${at.line ? ':' + at.line : ''}`, at) : null;
  return h('span.meta',
    h('span.key', v.key),
    d ? h('span', 'Defined by ', h('b', d.service), where ? [' in ', where] : null) : h('span', 'Not defined by an infra harvester: found from ', list(v.services)),
    summaryLine(v) ? h('span', summaryLine(v)) : null,
    d?.verified ? h('span', { class: `verified-${d.verified}` }, VERIFIED[d.verified]) : null);
}

/** One sentence: who connects and how, what it holds. */
function lead(v) {
  const n = v.lanes.length, by = (a) => v.lanes.filter((l) => l.access === a).length;
  const how = [by('read_write') ? `${by('read_write')} read and write` : null, by('read') ? `${by('read')} only ${by('read') === 1 ? 'reads' : 'read'}` : null,
    by('write') ? `${by('write')} only ${by('write') === 1 ? 'writes' : 'write'}` : null, by('unknown') ? `${by('unknown')} not reported` : null].filter(Boolean);
  const s = v.keys.summary;
  return [
    n ? [h('b', plural(n, 'service')), ` ${n === 1 ? 'connects' : 'connect'} to ${v.name}: ${list(how)}. `] : `No harvested service connects to ${v.name} yet. `,
    s ? ['It holds ', h('b', plural(s.templates, 'key template')), ` in ${plural(s.dbs.length, 'database')}${s.writers ? `, written by ${plural(s.writers, 'service')}` : ', written by no harvested service'}.`]
      : 'No key templates have been reported for it.',
  ];
}

export async function render({ main, params }) {
  const v = await api.instance(state.env, params.key);
  const host = h('div.panel-host');
  let lane;
  const panel = createPanel(host, { onClose: () => lane?.clear() });
  const keys = keysSection(v);
  lane = lanes(v, { onPick: (l) => panel.open(...clientPane(v, l)) });

  const callouts = v.callouts.map((c) => h('div.callout',
    h('span.dot'), h('span.grow', h('b.ri-mono', c.row.keyTemplate), c.text.slice(c.row.keyTemplate.length)),
    h('a', { href: '#', on: { click: (e) => { e.preventDefault(); keys.show(c.row); } } }, 'Load keys and show the row')));
  const more = (v.keys.summary?.problemCount ?? 0) - v.callouts.length;

  const kind = v.topology === 'cluster' ? 'Redis cluster' : 'Redis instance';
  const head = pageHead(h('span.title-row', titled('store', 'redis', v.name), h('span.ri-kind', objectIcon('store', 'redis', 14), kind)), meta(v),
    h('a.btn', { href: href('/inventory', { type: 'store:redis' }) }, 'All Redis instances'));

  host.prepend(h('div.content', h('div.ri-page',
    h('div.verdict', h('p.lead', lead(v)), v.callouts.length ? h('div.callouts', callouts, more > 0 ? h('p.small.muted', `and ${plural(more, 'more problem')} in the list.`) : null) : null),
    h('section.flow-section',
      h('header', h('h2', 'Who connects ', h('span.muted', { style: { fontWeight: 400 } }, String(v.lanes.length))), h('span.hint', 'service → access → client. Click a row for its client.')),
      v.lanes.length ? lane.el : h('p.lane-note', 'No harvested service has a resource on this instance.'),
      h('div.ri-legend', h('span', 'R reads, W writes, R/W both'), h('span', 'Access, client and databases per service come from the client on its resource and the access it declares or its steps show'))),
    keys.el,
    h('div.ri-foot', h('span', `Used by ${plural(v.services.length, 'service')}`),
      v.keys.pushedAt ? h('span', `Keys pushed ${ago(v.keys.pushedAt)}${v.keys.producer ? ' by ' + v.keys.producer : ''}`) : null,
      v.keys.source === 'inline' ? h('span', 'Keys are the top templates a harvester inlined') : null,
      v.stores.length ? h('span', plural(v.stores.length, 'key pattern'), ' declared by services') : null))));
  main.append(head, host);
  return { dispose: panel.dispose };
}
