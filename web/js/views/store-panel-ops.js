// #86 the operation rows of the store panel (access chip, step chips, code links, fields); store-panel.js and the CR #136 cards (store-cards.js) draw them.

import { h, s } from '../dom.js';
import { capSteps } from '../../core/store-panel.js';
import { fieldText } from '../components/step-fields.js';

const ICON = { read: 'M5 1.5v7M2 5.8 5 8.8l3-3', write: 'M5 8.5v-7M2 4.2 5 1.2l3 3', delete: 'M2 2l6 6M8 2 2 8', rw: 'M5 1.5v7M2 5.8 5 8.8l3-3', unknown: 'M2 5h6' };
const WORD = { read: 'read', write: 'write', delete: 'delete', rw: 'read/write', unknown: 'access not reported' };
const CLS = { read: 'r', write: 'w', delete: 'd', rw: 'w', unknown: 'u' };
export const accChip = (a) => h(`span.sp-acc.${CLS[a]}`, s('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true' }, s('path', { d: ICON[a] })), WORD[a]);
const fileIcon = () => s('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true' }, s('path', { d: 'M2 1h4l2 2v6H2zM6 1v2h2', fill: 'none' }));

export function stepsRow(op, ctx) {
  let open = false;
  const box = h('div.sp-steps', { role: 'group', 'aria-label': 'Steps' });
  const draw = () => {
    const chips = op.chips ?? op.steps.map((n) => ({ n })), { shown, more } = capSteps(chips, open);
    box.replaceChildren(...[h('span.lb', 'Steps'),
      ...shown.map(({ n, sub }) => h('button.sp-sc', { type: 'button', 'data-n': n, 'aria-label': sub ? `Go to step ${n}, call ${sub} of the folded run` : `Go to step ${n}`, title: sub ? `Call ${sub} of the folded run at step ${n}` : null, class: ctx.current() === n ? 'cur' : '', on: { click: () => ctx.onStep(n) } }, sub ? `${n}.${sub}` : String(n))),
      more ? h('button.sp-more', { type: 'button', 'aria-expanded': 'false', 'aria-label': `Show ${more} more steps`, on: { click: () => { open = true; draw(); box.querySelector('.sp-more')?.focus(); } } }, `+${more} more`)
        : open && chips.length > 8 ? h('button.sp-more', { type: 'button', 'aria-expanded': 'true', on: { click: () => { open = false; draw(); box.querySelector('.sp-more')?.focus(); } } }, 'Show fewer') : null].filter(Boolean));
  };
  draw();
  return box;
}

export function opRow(op, ctx) {
  const links = op.links.length ? h('ul.sp-code', { 'aria-label': 'Code' }, op.links.map((l) => h('li', fileIcon(),
    l.url ? h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', title: l.url }, l.key) : h('span.mono', l.key),
    h('span.s', l.steps.length === 1 ? `step ${l.steps[0]}` : `steps ${l.steps.join(', ')}`)))) : null;
  const flds = op.fields.length ? h('div.sp-flds', { 'aria-label': 'Fields' }, op.fields.map((g) => h('span.sp-fg', h('i', g.label), g.items.map((f) => h('span.sp-fp', { class: f.inDdl === false ? 'bad' : '', title: f.inDdl === false ? 'Not in the collection schema' : null }, f.inDdl === false ? '! ' : '', fieldText(f)))))) : null;
  return h('div.sp-op', h('div.sp-oph', accChip(op.access), h('span.sp-opn', op.op)), stepsRow(op, ctx), links, flds);
}
