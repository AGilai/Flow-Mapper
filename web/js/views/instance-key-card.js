// The keys card of one service on the instance page: opens under its "Who connects" row and loads that service's
// key templates on demand (`?service=`). "Writes N": the templates it writes. "Reads N": the ones it only reads, with
// their owner. Rows with a problem start open. Pure grouping is serviceKeys() in core/keys.ts.

import { h, fill } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { serviceKeys } from '../../core/keys.js';
import { keyHead, keyRow } from './instance-key-row.js';

const CAP = 200; // rows drawn at once per section
const rowId = (r) => `${r.dbIndex}\u0000${r.keyTemplate}`;

/** `onOpen(service, row)` opens another service's card (the owner of a key this service reads). */
export function keyCard(v, service, { onOpen }) {
  const body = h('div');
  const el = h('div.ri-card', { 'data-service': service }, body);
  let loaded = null;
  const shown = { writes: CAP, reads: CAP };

  async function load() {
    fill(body, h('p.ri-lazy', 'Loading keys…'));
    try {
      const d = await api.instanceKeys(state.env, v.key, { service });
      loaded = serviceKeys(d.groups.flatMap((g) => g.rows), service);
    } catch (err) {
      loaded = null;
      fill(body, h('div.ri-lazy', h('p', `Could not load the keys: ${err.message}`), h('button.btn', { type: 'button', on: { click: load } }, 'Try again')));
      return;
    }
    draw();
  }

  function section(kind, rows, title, hint) {
    const list = h('div');
    const draw1 = () => {
      fill(list, rows.slice(0, shown[kind]).map((r) => keyRow(r, { service, mode: kind, onOpen })),
        rows.length > shown[kind] ? h('div.ri-more', `Showing ${shown[kind]} of ${rows.length} key templates.`, h('button.btn', { type: 'button', on: { click: () => { shown[kind] += CAP; draw1(); } } }, 'Show more')) : null);
    };
    draw1();
    return h('section.ri-sec', h('div.ri-sech', h('h3', title, h('span.muted', ` ${rows.length}`)), h('span.xs', hint)), keyHead(kind), list);
  }

  function draw() {
    const { writes, reads, problems } = loaded;
    fill(body,
      h('div.ri-cardhead', h('span.xs', writes.length + reads.length
        ? `${service} uses ${writes.length + reads.length} key templates${problems.length ? `, ${problems.length} with a problem` : ''}.` : `No key templates reported for ${service}.`),
      h('button.btn', { type: 'button', on: { click: load } }, 'Reload')),
      writes.length ? section('writes', writes, 'Writes', 'templates this service writes (bold commands write)') : null,
      reads.length ? section('reads', reads, 'Reads', 'templates it only reads, with the service that writes them') : null);
  }

  /** Open and flash one row (loading the keys first if needed). */
  async function focus({ keyTemplate, dbIndex }) {
    if (!loaded) await load();
    if (!loaded) return;
    let again = false;
    for (const kind of ['writes', 'reads']) {
      const i = loaded[kind].findIndex((r) => rowId(r) === `${dbIndex}\u0000${keyTemplate}`);
      if (i >= shown[kind]) { shown[kind] = i + 1; again = true; }
    }
    if (again) draw();
    const row = [...el.querySelectorAll('details.ri-k')].find((d) => d.dataset.key === keyTemplate && d.dataset.db === String(dbIndex));
    if (!row) return;
    row.open = true;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 2500);
  }

  return { el, load: () => loaded || load(), focus };
}
