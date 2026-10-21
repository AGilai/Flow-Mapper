// The flow form: name, description, entry point, links (#54) and the steps of the bar's function as a list with ↑ ↓ buttons (keyboard: focus a button,
// Enter or Space). Done sends one `designEdit` {kind:'flow'}; `order` only when the steps were moved (every seq exactly once, renumbered 1..n by the server).

import { api } from '../../api.js';
import { state } from '../../state.js';
import { h } from '../../dom.js';
import { createFields, openForm, input, textarea, tag } from './form-kit.js';
import { linksFields } from './links-fields.js';

/** Move item `i` of `list` by `d` (-1 up, +1 down); the list itself when it cannot move (pure). */
export function moved(list, i, d) {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const out = list.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const stepText = (s) => s.operation || (s.type === 'egress' ? `call ${s.target}` : s.type === 'resource' ? `use ${s.target}` : `${s.type}${s.target ? ` ${s.target}` : ''}`);

/** openFlowForm({ panel, flowsEl, service, ingress, name? }): the steps that can be reordered are the endpoint's handler's. */
export async function openFlowForm({ panel, flowsEl, service, ingress, name = '' }) {
  const [view, desc, info] = await Promise.all([api.service(state.env, service).catch(() => null), api.descriptions(state.env, service, ingress).catch(() => null), api.endpoint(state.env, service, ingress).catch(() => null)]);
  const ep = view?.ingress?.find((i) => i.id === ingress), fnItem = Array.isArray(info?.handler?.steps) ? info.handler : null; // the handler's steps (the service view only counts them)
  const fields = createFields(), nameIn = input(name), text = textarea(desc?.flow?.human?.text ?? '', 4), entry = h('input', { type: 'checkbox', checked: !!ep?.entryPoint });
  let order = (fnItem?.steps ?? []).map((s) => s.seq);
  const steps = h('ol.f-steps', { 'data-qa': 'flow-steps' });
  const byseq = new Map((fnItem?.steps ?? []).map((s) => [s.seq, s]));
  const paint = (focusAt = null) => {
    steps.replaceChildren(...order.map((seq, i) => h('li', h('span.xs.muted', String(i + 1)), h('span.mono', stepText(byseq.get(seq))),
      h('button.btn.ghost', { type: 'button', disabled: i === 0, 'aria-label': `Move step ${i + 1} up`, on: { click: () => { order = moved(order, i, -1); paint(`up${i - 1}`); } }, 'data-k': `up${i}` }, '↑'),
      h('button.btn.ghost', { type: 'button', disabled: i === order.length - 1, 'aria-label': `Move step ${i + 1} down`, on: { click: () => { order = moved(order, i, 1); paint(`dn${i + 1}`); } }, 'data-k': `dn${i}` }, '↓'))));
    if (focusAt) steps.querySelector(`[data-k="${focusAt.replace('up', 'up').replace('dn', 'dn')}"]`)?.focus();
  };
  paint();
  fields.field('name', 'Name', nameIn, 'Shown in the flow list and on the tab. Unnamed flows show their entry key.');
  fields.field('description', 'Description', text, 'What this flow is for.');
  fields.field('entryPoint', 'Entry point', h('label.row', { style: { gap: '6px' } }, entry, 'Listed as a flow start'));
  const links = linksFields(fields, ep?.links);
  if (order.length > 1) fields.field('order', 'Steps', steps, `Order of ${fnItem.id}.`);
  const original = order.slice();
  openForm({ panel, flowsEl, fields, chips: [tag('flow')], title: `Flow · ${nameIn.value || ingress}`, sub: `${service} · ${ingress} · Draft ${state.draft}`,
    build: () => {
      const e = { kind: 'flow', service, ingress, name: nameIn.value.trim(), description: text.value.trim(), entryPoint: entry.checked };
      const l = links.get();
      if (l !== undefined) e.links = l;
      if (!same(order, original)) e.order = { fn: fnItem.id, seqs: order };
      return e;
    } });
}
