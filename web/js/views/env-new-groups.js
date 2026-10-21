// New environment: the subsystems (in order, with labels) and the levels strip.

import { h, fill } from '../dom.js';
import { keyFromLabel } from '../env-info.js';

/** `st.groups` is the ordered list [{key, label}]; `onChange` runs after any edit (the caller refreshes the table and summary). */
export function groupsField(st, onChange) {
  const box = h('div.env-groups');
  const msg = h('span.env-help');
  let adding = false;

  const move = (i, d) => { const [g] = st.groups.splice(i, 1); st.groups.splice(i + d, 0, g); changed(); };
  const remove = (i) => { st.groups.splice(i, 1); changed(); };
  function add(label) {
    const key = keyFromLabel(label);
    if (!label.trim() || !key) return;
    if (st.groups.some((g) => g.key === key)) { msg.textContent = `"${key}" is already listed.`; msg.classList.add('bad'); return; }
    st.groups.push({ key, label: label.trim() });
    adding = false;
    changed();
  }
  function changed() { msg.textContent = 'The order here is the left-to-right order on the map and in flows.'; msg.classList.remove('bad'); draw(); onChange(); }

  function draw() {
    const input = h('input.input', { type: 'text', placeholder: 'Subsystem name', 'aria-label': 'New subsystem name', style: { width: '180px' },
      on: { keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); add(input.value); } else if (e.key === 'Escape') { adding = false; draw(); } } } });
    fill(box,
      st.groups.map((g, i) => h('span.env-gchip',
        h('span.env-gkey', g.key), h('span.env-glabel', g.label),
        h('button', { type: 'button', disabled: i === 0, title: `Move ${g.key} left`, 'aria-label': `Move ${g.key} left`, on: { click: () => move(i, -1) } }, '‹'),
        h('button', { type: 'button', disabled: i === st.groups.length - 1, title: `Move ${g.key} right`, 'aria-label': `Move ${g.key} right`, on: { click: () => move(i, 1) } }, '›'),
        h('button', { type: 'button', title: `Remove ${g.key}`, 'aria-label': `Remove ${g.key}`, on: { click: () => remove(i) } }, '×'))),
      adding
        ? h('span.env-gnew', input, h('button.btn.sm', { type: 'button', on: { click: () => add(input.value) } }, 'Add'), h('button.btn.sm.ghost', { type: 'button', on: { click: () => { adding = false; draw(); } } }, 'Cancel'))
        : h('button.env-gadd', { type: 'button', on: { click: () => { adding = true; draw(); input.focus(); } } }, '+ Add subsystem'));
    if (adding) queueMicrotask(() => input.focus());
  }
  msg.textContent = 'The order here is the left-to-right order on the map and in flows.';
  draw();
  return h('div', box,
    h('div.env-levels', 'Levels', h('span.env-lv', 'Subsystem'), '›', h('span.env-lv.later', { title: 'Later' }, 'Domain (later)'), '›', h('span.env-lv', 'Component')),
    msg);
}
