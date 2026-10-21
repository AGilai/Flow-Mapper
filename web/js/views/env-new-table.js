// New environment: the component table. Picked rows first, then one-hop neighbours (unticked, with the reason),
// then the other components of the source (narrowed by the search box).

import { h, fill } from '../dom.js';
import { carryText } from '../env-info.js';

const SHOWN = 25;

/** `st`: {comps, picked: Set, assign: Map, neighbours, filter, groups}. Returns {el, draw}. */
export function pickTable(st, onChange) {
  const body = h('tbody');
  const note = h('div.env-pick-note');

  const tick = (name, on) => { if (on) st.picked.add(name); else st.picked.delete(name); onChange(); };
  const groupSel = (c) => h('select.select', { 'aria-label': `Subsystem of ${c.name}`, disabled: !st.groups.length, on: { change: (e) => st.assign.set(c.name, e.target.value) } },
    h('option', { value: '', selected: !st.assign.get(c.name) }, st.groups.length ? 'not set' : 'no subsystems'),
    st.groups.map((g) => h('option', { value: g.key, selected: st.assign.get(c.name) === g.key }, g.key)));
  const row = (c, extra, off) => h('tr', { class: off ? 'env-off' : '' },
    h('td', { style: { width: '28px' } }, h('input', { type: 'checkbox', checked: st.picked.has(c.name), 'aria-label': `Copy ${c.name}`, on: { change: (e) => tick(c.name, e.target.checked) } })),
    h('td.svc', c.name), h('td', c.team ?? ''), h('td', groupSel(c)), extra);

  function draw() {
    const by = new Map(st.comps.map((c) => [c.name, c]));
    const q = st.filter.trim().toLowerCase();
    const picked = [...st.picked].map((n) => by.get(n)).filter(Boolean);
    const sugg = st.neighbours.filter((n) => !st.picked.has(n.service) && by.has(n.service));
    const suggNames = new Set(sugg.map((n) => n.service));
    const rest = st.comps.filter((c) => !st.picked.has(c.name) && !suggNames.has(c.name) && (!q || c.name.toLowerCase().includes(q) || (c.team ?? '').toLowerCase().includes(q)));
    const sub = (text) => h('tr.env-sub', h('td'), h('td', { colSpan: 4 }, text));
    fill(body,
      picked.map((c) => row(c, h('td.carry', carryText(c.counts)))),
      sugg.length ? [sub('Suggested neighbours: components that talk to the ones you picked'),
        ...sugg.map((n) => row(by.get(n.service), h('td.why', n.reason), true))] : null,
      rest.length ? [sub(q ? `Matching "${st.filter.trim()}"` : 'Other components'),
        ...rest.slice(0, SHOWN).map((c) => row(c, h('td.carry', carryText(c.counts)), true))] : null);
    note.textContent = rest.length > SHOWN ? `${rest.length - SHOWN} more: type in the search box to narrow.` : !st.comps.length ? 'This environment has no components.' : '';
  }

  const search = h('input.input', { type: 'search', placeholder: 'Find a component to add', 'aria-label': 'Find a component', style: { width: '260px' },
    on: { input: (e) => { st.filter = e.target.value; draw(); } } });
  const el = h('div', h('div', { style: { marginBottom: 'var(--s2)' } }, search),
    h('section.env-pick-table', h('div', { style: { overflowX: 'auto' } },
      h('table.grid', h('thead', h('tr', h('th'), h('th', 'Component'), h('th', 'Team'), h('th', 'Subsystem'), h('th', 'Comes along'))), body)), note));
  draw();
  return { el, draw };
}
