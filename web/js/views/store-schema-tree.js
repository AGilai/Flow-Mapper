// CR #136: a schema as a readable field tree (core/store-cards.ts schemaTree): name, type by kind, required star, notes, nested objects that collapse,
// a dot on the fields the flow touches. First level open, deeper shut; Expand all / Collapse all.

import { h, s } from '../dom.js';
import { countFields } from '../../core/store-cards.js';

const tg = (li) => h('button.cc-tg', { type: 'button', 'aria-label': 'Toggle', 'aria-expanded': 'false', on: { click: () => flip(li) } }, s('svg', { viewBox: '0 0 12 12', 'aria-hidden': 'true' }, s('path', { d: 'M4 2l4 4-4 4' })));
const flip = (li, shut = !li.classList.contains('shut')) => { li.classList.toggle('shut', shut); li.querySelector(':scope > .cc-fr > .cc-tg')?.setAttribute('aria-expanded', String(!shut)); };

function list(nodes, depth) {
  return h('ul.cc-tr', nodes.map((n) => {
    const li = h('li', { class: n.children.length && depth > 0 ? 'shut' : '' });
    li.append(h('div.cc-fr', { class: n.used ? 'used-r' : '' }, n.children.length ? tg(li) : h('span.cc-tg.none'), h(`span.cc-fn${n.required ? '.req' : ''}`, n.name), h(`span.cc-ft${n.kind ? `.${n.kind}` : ''}`, n.type),
      n.used ? h('span.cc-dot', { title: 'This flow reads or writes it' }) : null, n.note ? h('span.cc-fx', n.note) : null));
    if (n.children.length) { li.append(list(n.children, depth + 1)); li.querySelector('.cc-tg').setAttribute('aria-expanded', String(depth === 0)); }
    return li;
  }));
}

/** schemaTreeView(tree, label) -> the element: a header (field count, Expand all, Collapse all), the tree and a legend. */
export function schemaTreeView(tree, label = null) {
  const root = h('div.cc-sch'), all = (shut) => root.querySelectorAll('li').forEach((li) => li.querySelector(':scope > ul') && flip(li, shut));
  root.append(h('div.cc-sh', h('span', `${countFields(tree)} fields`, label ? ` · ${label}` : ''), h('span.sp'), h('button', { type: 'button', on: { click: () => all(false) } }, 'Expand all'), h('button', { type: 'button', on: { click: () => all(true) } }, 'Collapse all')),
    list(tree, 0),
    h('div.cc-legend', h('span', h('span.cc-dot'), ' touched by this flow'), h('span', h('b.star', '*'), ' required'), h('span', h('span.cc-ft.arr', '[]'), ' array'), h('span', h('span.cc-ft.ref', 'Name'), ' reference')));
  return root;
}
