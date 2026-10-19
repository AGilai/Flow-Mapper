// Data store page: one collection, table, key pattern or bucket. Who reads and who writes it (down to
// the function and operation, with code links), which entry points reach it, its schemas by source,
// and the other keys in the same cluster or database.

import { h } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { href } from '../router.js';
import { ago } from '../format.js';
import { pageHead } from '../components/page.js';
import { jsonView } from '../components/json-view.js';
import { box, codeLink, empty, fig, problems } from './detail-parts.js';
import { serviceLink, storeLink } from './inventory-links.js';
import { titled } from '../components/object-icon.js';

const SOURCE = { code: 'From code', db: 'From the database', manual: 'Entered by hand' };

export async function render({ main, params }) {
  const v = await api.store(state.env, params.key);
  const fns = v.uses.flatMap((u) => u.functions);
  const issues = [
    v.writers.length > 1 ? `Written by ${v.writers.length} services (${v.writers.join(', ')}). They are coupled through this data.` : null,
    v.keyUnknown ? `Key unknown: ${v.keyUnknown}. The harvester could not say which store this is.` : null,
    !v.used ? 'Declared, but no function uses it.' : null,
  ].filter(Boolean);

  main.append(
    pageHead(titled('store', v.kind, v.name), `${v.kind} in ${v.group}`,
      h('a.btn', { href: href('/system', { stores: 1, sel: `res:${v.key}` }) }, 'Show on map'),
      h('a.btn', { href: href('/inventory', { type: `store:${v.kind}` }) }, `All ${v.kind} stores`)),
    h('div.content', h('div.page-grid',
      h('div.figures', fig(v.services.length, 'Services'), fig(v.readers.length, 'Readers'), fig(v.writers.length, 'Writers', v.writers.length > 1),
        fig(fns.length, 'Functions'), fig(v.entryPoints.length, 'Entry points reach it')),
      problems(issues),
      h('div.two-col',
        h('div.stack', { style: { gap: 'var(--s4)' } },
          box('Who uses it', v.uses.length, v.uses.length ? v.uses.map(use) : empty('No service uses it.')),
          box('Reached from', v.entryPoints.length, v.entryPoints.length
            ? h('div.list', v.entryPoints.map((e) => h('a.list-item', { href: href('/flows', { service: e.service, ingress: e.ingress }) },
                h('span.pill', e.transport), h('span.grow.truncate.key', e.bindKey), h('span.xs.muted', e.service))))
            : empty('No entry point leads here.'))),
        h('div.stack', { style: { gap: 'var(--s4)' } },
          box('Schema', v.schemas.length, v.schemas.length ? v.schemas.map((s) => h('div.stack', { style: { gap: 'var(--s1)' } },
              h('div.row', h('b.small', SOURCE[s.source] ?? s.source), h('span.xs.muted', `updated ${ago(s.updatedAt)}`)), jsonView(s.content)))
            : h('div.ep-empty', h('p', 'No schema yet.'), h('code.key', `PUT /api/envs/${state.env}/schemas/code/${v.key}`))),
          Object.keys(v.details).length ? box('Details', null, jsonView(v.details)) : null,
          box(`Other keys in ${v.group}`, v.siblings.length, v.siblings.length
            ? h('div.list', v.siblings.map((s) => h('div.list-item', storeLink(s.key, s.name), h('span.grow'), h('span.xs.muted', s.services.join(', ')))))
            : empty('None.')))))));
}

function use(u) {
  const accesses = [...new Set(u.functions.flatMap((f) => f.operations.map((o) => o.access)))].filter((a) => a !== 'unknown');
  return h('div.use',
    h('div.use-head', h('b', serviceLink(u.service)), accesses.map((a) => h('span.pill', { class: a }, a)), h('span.xs.muted', `as ${u.resource}`),
      u.verified ? h('span.pill', { class: `verified-${u.verified}` }, u.verified) : null, u.declaredAt?.url ? codeLink('declared here', u.declaredAt) : null),
    u.functions.map((f) => h('div.use-fn', codeLink(f.name, f.source),
      f.operations.map((o) => h('span.pill', { class: o.access, title: o.access }, o.operation)))));
}
