// The controls of the Drivers tab (frame 29): store-type picker, Group by, the query box with its tokens, the
// Component / Package / Version dropdowns that show the same state, and "Only: mixed majors".

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { parseDriverQuery, formatDriverQuery } from '../../core/versions.js';
import { kindLabel } from './drivers-kinds.js';

const OPS = ['<', '<=', '>', '>=', '='];

/** The store-type picker. `types`: [{id, n}] (n = components, 0 = no data); `on(id)`. `idle`: dimmed (Group by Component shows every type). */
export function storePicker(types, current, on, idle) {
  return h('div.dv-segw', h('span.lbl', 'Store type'), h('div.dv-seg2', { role: 'group', 'aria-label': 'Store type', class: idle ? 'idle' : '' },
    types.map((t) => h('button', { type: 'button', 'aria-pressed': String(!idle && t.id === current), class: t.n ? '' : 'off', 'data-qa': `drivers-type-${t.id}`, on: { click: () => on(t.id) } },
      kindLabel(t.id), t.n ? h('i', `${t.n} ${t.n === 1 ? 'component' : 'components'}`) : h('i', 'no data yet')))));
}

export function groupSwitch(current, on) {
  return h('div.dv-segw', h('span.lbl', 'Group by'), h('div.dv-seg2.sm', { role: 'group', 'aria-label': 'Group by' },
    [['package', 'Package'], ['component', 'Component']].map(([id, l]) => h('button', { type: 'button', 'aria-pressed': String(id === current), 'data-qa': `drivers-group-${id}`, on: { click: () => on(id) } }, l))));
}

const tokenEl = (label, text, remove) => h('span.dv-tok', h('em', label), text, h('button', { type: 'button', 'aria-label': `Remove ${text}`, on: { click: remove } }, '×'));

/** `vocab`: {packages, components}; `versions`: [[label, text]] offered by the Version dropdown; `s`: {q, mixed}; `on(patch)` with {q?, mixed?}. */
export function queryBar({ vocab, versions, s, on }) {
  const q = parseDriverQuery(s.q, vocab);
  const set = (patch) => on({ q: formatDriverQuery({ ...q, ...patch }) });
  const input = h('input', { type: 'text', 'aria-label': 'Drivers query', 'data-qa': 'drivers-query', placeholder: s.q ? '' : 'Query: component, package, version... e.g. mongoose < 6, redis 3, orders-svc',
    on: {
      keydown: (e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Backspace' && !input.value) { const parts = s.q.split(/\s+/).filter(Boolean); if (parts.length) on({ q: parts.slice(0, -1).join(' ') }); }
      },
      input: () => { const w = input.value; if (/\s$/.test(w) && !OPS.includes(w.trim().split(/\s+/).pop())) commit(); },
      blur: () => commit(),
    } });
  function commit() { const t = input.value.trim(); if (!t) return; input.value = ''; on({ q: `${s.q} ${t}`.trim() }); }
  const toks = [
    q.component ? tokenEl('Component', q.component, () => set({ component: undefined })) : null,
    q.package ? tokenEl('Package', q.package, () => set({ package: undefined })) : null,
    ...q.versions.map((p, i) => tokenEl('Version', p.text, () => set({ versions: q.versions.filter((_, j) => j !== i) }))),
    ...q.text.map((t, i) => tokenEl('Name', t, () => set({ text: q.text.filter((_, j) => j !== i) }))),
  ];
  const box = h('div.dv-q', { onclick: () => input.focus() }, icon('search'), toks, input);
  box.addEventListener('focusin', () => box.classList.add('focus'));
  box.addEventListener('focusout', () => box.classList.remove('focus'));
  const sel = (label, options, value, change, active) => h('label.dv-fs', { class: active ? 'on' : '' }, label, ' ',
    h('select', { 'aria-label': label, 'data-qa': `drivers-${label.toLowerCase()}`, on: { change: (e) => change(e.target.value) } }, options.map(([v, t]) => h('option', { value: v, selected: v === value }, t))));
  const curVer = q.versions.map((p) => p.text).join(' ');
  const vOpts = [['', 'Any'], ...versions];
  if (curVer && !vOpts.some(([v]) => v === curVer)) vOpts.push([curVer, curVer]);
  const pick = (text) => (text ? parseDriverQuery(text, vocab).versions : []);
  const hasFilter = !!(s.q || s.mixed);
  return {
    box,
    row: h('div.dv-row', box,
      sel('Component', [['', 'Any'], ...vocab.components.map((c) => [c, c])], q.component ?? '', (v) => set({ component: v || undefined }), !!q.component),
      sel('Package', [['', 'Any'], ...vocab.packages.map((c) => [c, c])], q.package ?? '', (v) => set({ package: v || undefined }), !!q.package),
      sel('Version', vOpts, curVer, (v) => set({ versions: pick(v) }), !!curVer),
      h('label.dv-fs', { class: s.mixed ? 'on' : '' }, 'Only: ', h('input', { type: 'checkbox', checked: s.mixed, 'data-qa': 'drivers-mixed', on: { change: (e) => on({ mixed: e.target.checked }) } }), ' mixed majors'),
      hasFilter ? h('button.btn.sm', { type: 'button', 'data-qa': 'drivers-clear', on: { click: () => on({ q: '', mixed: false }) } }, 'Clear') : null),
    input,
  };
}

/** The syntax line under the query box (shown once there is a query, or the box has focus) and the copy-link action. */
export function syntaxHint() {
  const c = (t) => h('code', t);
  return h('div.dv-hint', h('span.lbl', 'Version syntax'), c('< 6'), c('>= 4 < 5'), c('v3'), ' or ', c('3.x'), ' (that major) ', c('4.28.5'), ' (exact)',
    h('span', 'Compared on the numbers, majors first. Tags and git URLs have no major and show as unresolved.'),
    h('a', { href: '#', on: { click: (e) => { e.preventDefault(); navigator.clipboard?.writeText(location.href); e.target.textContent = 'Link copied'; } } }, 'Copy link to this query'));
}
