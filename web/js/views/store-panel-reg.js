// #86 store panel: the keys registry, loaded lazily the first time a Redis panel opens (one request per env, instance and service, cached for the life of the tab)
// and drawn as the block under a key card. The panel never waits for it, and a failed request draws nothing.

import { h, s } from '../dom.js';
import { api } from '../api.js';
import { matchRegistry } from '../../core/store-panel.js';

const cache = new Map();
const one = (env, instance, service) => {
  const k = `${env}|${instance}|${service}`;
  if (!cache.has(k)) {
    cache.set(k, api.instanceKeys(env, instance, { service }).then((r) => (r?.source === 'none' ? { none: true } : { groups: r?.groups ?? [], templates: r?.summary?.templates ?? null }))
      .catch((e) => { cache.delete(k); return e?.status === 404 ? { none: true } : null; })); // 404: no such list; any other failure: nothing is shown
  }
  return cache.get(k);
};

/** loadRegistry(env, instance, services) -> Promise<{ groups, templates } | { none: true } | null> (null: the request failed). */
export async function loadRegistry(env, instance, services) {
  const all = await Promise.all([...new Set(services)].map((sv) => one(env, instance, sv)));
  if (all.some((r) => r === null) && !all.some((r) => r?.groups)) return null;
  const ok = all.filter((r) => r?.groups);
  return ok.length ? { groups: ok.flatMap((r) => r.groups), templates: ok[0].templates } : { none: true };
}

const tick = () => s('svg', { viewBox: '0 0 12 12', 'aria-hidden': 'true' }, s('path', { d: 'M2.5 6.5 5 9l4.5-5.5' }));
const info = () => s('svg', { viewBox: '0 0 12 12', 'aria-hidden': 'true' }, s('circle', { cx: 6, cy: 6, r: 4.5 }), s('path', { d: 'M6 5.5v3M6 3.6v.1' }));

/** The block under a Redis key card: a one-line skeleton until `reg` (a promise of loadRegistry) settles, then the row, "Not in the keys registry", or nothing. */
export function registryBlock(reg, template, dbs) {
  const el = h('div.sp-reg.load', { 'aria-live': 'polite' }, h('div.rh', 'Loading registry...'));
  reg.then((r) => {
    if (!r) return el.remove();
    const m = r.groups ? matchRegistry(r.groups, template, dbs) : null;
    el.className = m ? 'sp-reg' : 'sp-reg no';
    el.replaceChildren(...(m
      ? [h('div.rh', tick(), 'Keys registry', h('small', m.shared ? 'shared' : `owner ${m.owner}`)), m.description ? h('p', m.description) : null,
        h('dl', m.ttl ? [h('dt', 'TTL'), h('dd', m.ttl)] : null, m.usedBy ? [h('dt', 'Used by'), h('dd', m.usedBy)] : null)]
      : [h('div.rh', info(), 'Not in the keys registry'), h('p', 'No row for this key template. The harvester pushed none, or it is spelled differently.')]).filter(Boolean));
  }).catch(() => el.remove());
  return el;
}
