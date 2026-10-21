// The endpoint form: transport (incl. "Not decided yet": `undecided`, the server fills `tbd:`), bind key with a placeholder per transport, handler,
// entry point, event consumers, links (#54), DTO links (they open the DTO form). `endpointFields` is shared with the call form's "+ New endpoint".

import { api } from '../../api.js';
import { state } from '../../state.js';
import { h } from '../../dom.js';
import { createFields, openForm, select, input, textarea, tag } from './form-kit.js';
import { linksFields } from './links-fields.js';

export const TRANSPORTS = [['http', 'http'], ['rpc', 'rpc'], ['grpc', 'grpc'], ['sns', 'sns'], ['sqs', 'sqs'], ['amqp', 'amqp'], ['eventbridge', 'eventbridge'], ['cron', 'cron'], ['socket', 'socket'], ['event', 'event'], ['undecided', 'Not decided yet']];
const HINT = { http: 'http:POST orders-svc/orders', rpc: 'rpc:orders-svc/Order.get', grpc: 'grpc:orders-svc/Orders/Get', sns: 'sns:order-events', sqs: 'sqs:order-queue', amqp: 'amqp-queue:order-events', eventbridge: 'eventbridge:bus/OrderPlaced', cron: 'cron:0 3 * * *', socket: 'socket:tls/orders-svc/connect', event: 'event:OrderPlaced', undecided: 'Filled in as tbd:<component>/<name>' };
export const keyHint = (t) => HINT[t] ?? '';

/** The EndpointEdit of the fields (pure): `v` = { service, id?, transport, bindKey, handler, entryPoint, events: string }. Events: one per line, "type" or "type handler". */
export function endpointEdit(v) {
  if (v.transport !== 'undecided' && !v.bindKey.trim()) throw Object.assign(new Error('The bind key is what links this endpoint to its callers.'), { field: 'bindKey' });
  const events = v.events.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [type, handler] = l.split(/\s+/); return handler ? { type, handler } : { type }; });
  return { service: v.service, ...(v.id ? { id: v.id } : {}), transport: v.transport, ...(v.bindKey.trim() ? { bindKey: v.bindKey.trim() } : {}), ...(v.handler.trim() ? { handler: v.handler.trim() } : {}), entryPoint: !!v.entryPoint, ...(events.length ? { events } : {}) };
}

/** endpointFields(fields, { service, ep?, links? }) -> { get() -> EndpointEdit, transport (the select) }; registers the rows on `fields`. */
export function endpointFields(fields, { service, ep = null, evs = [], withLinks = true }) {
  const transport = select(TRANSPORTS, ep?.transport ?? 'http'), key = input(ep?.bindKey ?? '', { mono: true, placeholder: keyHint(ep?.transport ?? 'http') });
  const handler = input(ep?.handler ?? '', { mono: true, placeholder: 'default: <id>.handle' }), entry = h('input', { type: 'checkbox', checked: !!ep?.entryPoint });
  const events = textarea(evs.map((e) => (e.handler ? `${e.type} ${e.handler}` : e.type)).join('\n'), 2);
  transport.addEventListener('change', () => { key.placeholder = keyHint(transport.value); });
  fields.field('transport', 'Transport', transport);
  fields.field('bindKey', 'Bind key', key, 'What its callers name. Leave it empty when the transport is not decided.');
  fields.field('handler', 'Handler', handler, 'A function of this component; an empty one is created.');
  fields.field('entryPoint', 'Entry point', h('label.row', { style: { gap: '6px' } }, entry, 'A flow starts here'));
  fields.field('events', 'Events', events, 'Consumers: one per line, "type" or "type handler".');
  const links = withLinks ? linksFields(fields, ep?.links) : { get: () => undefined };
  return { transport, get: () => { const l = links.get(), e = endpointEdit({ service, id: ep?.id, transport: transport.value, bindKey: key.value, handler: handler.value, entryPoint: entry.checked, events: events.value }); return l === undefined ? e : { ...e, links: l }; } };
}

/** openEndpointForm({ panel, flowsEl, service, ingress? , onDto(role) }): a new endpoint of `service`, or the one `ingress` names. */
export async function openEndpointForm({ panel, flowsEl, service, ingress = null, onDto = null }) {
  const view = ingress ? await api.service(state.env, service).catch(() => null) : null, ep = view?.ingress?.find((i) => i.id === ingress) ?? null;
  const info = ingress ? await api.endpoint(state.env, service, ingress).catch(() => null) : null;
  const fields = createFields(), f = endpointFields(fields, { service, ep, evs: info?.events ?? [] });
  const dtos = ingress && onDto ? h('div.row', { style: { gap: '6px', flexWrap: 'wrap' } }, h('span.xs.muted', 'Messages'), ['request', 'response'].map((r) => h('button.btn.sm', { type: 'button', on: { click: () => onDto(r) } }, `${r[0].toUpperCase()}${r.slice(1)} DTO`))) : null;
  openForm({ panel, flowsEl, fields, top: dtos, chips: [tag(ep?.transport ?? 'endpoint', ep?.transport)], title: ingress ? `Endpoint · ${service} ${ep?.bindKey ?? ingress}` : `New endpoint in ${service}`, sub: `Draft ${state.draft}`,
    build: () => ({ kind: 'endpoint', ...f.get() }),
    remove: ingress ? { label: 'Delete endpoint', title: `Delete ${ep?.bindKey ?? ingress}?`, body: 'Its request and response messages and flow text go with it.', edit: { kind: 'delete', anchor: `ing:${service}/${ingress}` } } : null });
}
