// "Drivers" section of the component page (#130, frame 29): the same per-component view as the Inventory drawer.
// Loaded after the page, hidden when the component has no client data.

import { h, fill } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import { driverData } from './drivers.js';
import { componentDrivers } from './drivers-drawer.js';
import { typeOf } from './drivers-kinds.js';

export function driversSection(service) {
  const body = h('div.dv-section'), count = h('span.s.mu');
  const box = h('details.dv-card.dv-svc', { open: true, hidden: true, 'data-qa': 'service-drivers' },
    h('summary.dv-sech', icon('package'), h('h3', 'Drivers'), count, h('span.grow'), icon('chevdown')), h('div.dv-pad', body));
  api.clients(state.env).then(({ rows }) => {
    if (!rows.some((r) => r.service === service)) return;
    const d = driverData(rows);
    count.textContent = 'Client packages and versions, per store type';
    fill(body, componentDrivers(service, { ...d, showInTable: (kind) => go('/inventory', { tab: 'drivers', store: typeOf(kind), q: service }) }));
    box.hidden = false;
  }).catch(() => {});
  return box;
}
