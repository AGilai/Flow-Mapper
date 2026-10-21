// The call form (frame 4): From (fixed), To (components), Endpoint (its endpoints, "+ New endpoint", "Not designed yet"), Transport, Mode, Operation, Condition.
// Opening an existing call reads `GET /call` first; a reference on the other side shows the callout and locks the fields until "Edit the call only".
// One `designEdit` {kind:'call'}; Delete call = {kind:'delete-call'}. A new call is `from: {service, fn}` (the "+ call" under a bar).

import { api } from '../../api.js';
import { state } from '../../state.js';
import { h, fill } from '../../dom.js';
import { createFields, openForm, select, input, tag } from './form-kit.js';
import { endpointFields, TRANSPORTS, keyHint } from './endpoint-form.js';
import { refCallout } from './ref-callout.js';

const NEW = '__new', TBD = '__tbd';

/** The `to` of a call edit (pure): `pick` = an endpoint id, NEW or TBD; `target` = the nested fields' value. */
export function callTo(service, pick, target) {
  if (pick === NEW) return { endpoint: target };
  if (pick === TBD) {
    if (!target.bindKey.trim()) throw Object.assign(new Error('Name what it calls, e.g. http:GET pop-swg/apply.'), { field: 'to' });
    return { bindKey: target.bindKey.trim(), transport: target.transport };
  }
  return { service, ingress: pick };
}

/** openCallForm({ panel, flowsEl, from: {service, fn}, egress?, operation?, onImport(anchor, source) }) */
export async function openCallForm({ panel, flowsEl, from: from0, egress = null, operation = null, onImport }) {
  const view = egress ? await api.call(state.env, from0.service, egress).catch(() => null) : null;
  const step = view?.steps.find((s) => s.operation === operation) ?? view?.steps[0] ?? null, tgt0 = view?.targets?.[0] ?? null, ref = tgt0?.reference ?? null;
  const from = { service: from0.service, fn: step?.fn ?? from0.fn }; // an existing call: the function that holds its step
  const services = (await api.services(state.env).catch(() => [])).map((s) => s.name);
  const fields = createFields(), seg = h('div.fwide'), toSel = select(services.map((n) => [n, n]), tgt0?.service ?? (services.find((n) => n !== from.service) ?? services[0]));
  const mode = select([['', 'Default for the transport'], ['sync', 'sync'], ['async', 'async']], view?.egress.mode ?? ''), op = input(step?.operation ?? operation ?? ''), cond = input('');
  const epSel = select([], '');
  let nested = null, ingress = [];
  const paintEndpoint = async () => { // the endpoints of the chosen component, then the part the choice needs
    ingress = (await api.service(state.env, toSel.value).catch(() => null))?.ingress ?? [];
    fill(epSel, ingress.map((i) => h('option', { value: i.id }, i.bindKey)), h('option', { value: NEW }, '+ New endpoint'), h('option', { value: TBD }, 'Not designed yet'));
    epSel.value = tgt0 && toSel.value === tgt0.service && ingress.some((i) => i.id === tgt0.ingress) ? tgt0.ingress : (view && !tgt0 ? TBD : ingress[0]?.id ?? NEW);
    paintNested();
  };
  function paintNested() {
    const f = createFields(); nested = null;
    if (epSel.value === NEW) { const e = endpointFields(f, { service: toSel.value, withLinks: false }); nested = () => e.get(); }
    else if (epSel.value === TBD) {
      const key = input(view?.egress.bindKey ?? '', { mono: true, placeholder: 'http:GET pop-swg/apply' }), t = select(TRANSPORTS, view?.egress.transport ?? 'http');
      t.addEventListener('change', () => { key.placeholder = keyHint(t.value); });
      f.field('to', 'Calls', key, 'Not designed yet: the call is drawn dashed until an endpoint matches this key.'); f.field('transport', 'Transport', t);
      nested = () => ({ bindKey: key.value, transport: t.value });
    } else { const i = ingress.find((x) => x.id === epSel.value); f.field('transport', 'Transport', h('span.mono', i?.transport ?? ''), 'From the endpoint.'); }
    fill(seg, h('div.fgrid', f.rows));
  }
  toSel.addEventListener('change', paintEndpoint); epSel.addEventListener('change', paintNested);
  fields.field('from', 'From', h('span.mono', `${from.service} · ${from.fn}`));
  fields.field('to', 'To', toSel); fields.field('endpoint', 'Endpoint', epSel); fields.wide(seg);
  fields.field('mode', 'Mode', mode); fields.field('operation', 'Operation', op, 'The call\'s own words on the arrow.'); fields.field('condition', 'Condition', cond, 'Only when…');
  const lock = (on) => fields.rows.forEach((r) => r.classList?.toggle('f-locked', on));
  const top = ref ? refCallout(ref, { onImport: () => onImport?.(`ing:${ref.service}/${ref.ingress}`, ref.source), onEditOnly: () => lock(false) }) : null;
  await paintEndpoint();
  if (ref) lock(true);
  openForm({ panel, flowsEl, fields, top, chips: [tag(egress ? 'call' : 'new call', view?.egress.transport)], title: egress ? `Call · ${from.service} → ${tgt0?.service ?? toSel.value}` : `New call from ${from.service}`,
    sub: egress ? `Draft ${state.draft}` : `Added at the end of ${from.fn}`,
    build: () => ({ kind: 'call', from, ...(step ? { edit: { egress, seq: step.seq } } : {}), to: callTo(toSel.value, epSel.value, nested?.() ?? null), ...(mode.value ? { mode: mode.value } : {}), operation: op.value.trim(), ...(cond.value.trim() ? { condition: cond.value.trim() } : {}) }),
    remove: step ? { label: 'Delete call', title: `Delete this call to ${tgt0?.service ?? 'its target'}?`, body: 'The step goes, and its egress when nothing else in the component uses it.', edit: { kind: 'delete-call', service: from.service, fn: step.fn, seq: step.seq } } : null });
}
