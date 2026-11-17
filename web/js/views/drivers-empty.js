// The Drivers tab when a store type has no client data (frame 29, state 29e): the one-line notice for a redirect,
// and the empty card with where data is (other store types here, other environments).

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { href } from '../router.js';
import { kindLabel } from './drivers-kinds.js';
import { chooseStore } from '../../core/drivers.js';

/** "No MongoDB driver data in sub-bands; showing Redis." */
export const notice = (from, env, to) => h('p.dv-note', { 'data-qa': 'drivers-notice', role: 'status' }, icon('info'), `No ${from} driver data in ${env || 'this environment'}; showing ${to}.`);

const plural = (n) => `${n} ${n === 1 ? 'component' : 'components'}`;

/** `types`: [{id, n}]; `go(id)` opens a store type; `envs`: names of all environments; `dataOf(rows)` is the page's driverData. */
export function emptyNone(label, { types, env, envs, go, dataOf }) {
  const have = types.filter((t) => t.n);
  const elsewhere = h('div.dv-else', { 'data-qa': 'drivers-elsewhere' });
  if (!have.length) lookElsewhere(elsewhere, envs.filter((e) => e !== env), label, dataOf);
  return h('div.dv-card', h('div.dv-empty', icon('info'), h('b', `No ${label} clients reported yet`),
    h('span', `As soon as a harvester sends a client (driver, wrapper library) for a ${label} resource or call, its packages and versions are listed here.`), h('span.s.mu', 'Until then there is nothing to compare: no version is guessed.'),
    have.length ? h('div.dv-acts', have.map((t) => h('button.btn.sm', { type: 'button', 'data-qa': `drivers-show-${t.id}`, on: { click: () => go(t.id) } }, `Show ${kindLabel(t.id)} · ${plural(t.n)}`))) : elsewhere));
}

/** Fills `host` with the other environments that have client data (one /clients read each, after the page is drawn). */
async function lookElsewhere(host, others, label, dataOf) {
  if (!others.length) return;
  host.append(h('span.s.mu', 'Looking for driver data in other environments...'));
  const found = (await Promise.all(others.map(async (e) => {
    try {
      const { counts } = dataOf((await api.clients(e)).rows ?? []);
      const pick = chooseStore(null, counts, [...counts.keys()]);
      return counts.size ? { env: e, store: pick.store, n: counts.get(pick.store) } : null;
    } catch { return null; }
  }))).filter(Boolean);
  host.replaceChildren(found.length
    ? h('span', `Other environments report drivers: `, found.map((f, i) => [i ? ' · ' : null, h('a', { href: href('/inventory', { tab: 'drivers', store: f.store, env: f.env }) }, `Open in ${f.env}`), h('span.s.mu', ` (${kindLabel(f.store)}, ${plural(f.n)})`)]))
    : h('span.s.mu', 'No other environment has driver data either.'));
}
