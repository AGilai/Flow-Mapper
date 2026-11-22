// The text of a call arrow in the sequence lane (split out of flow-lane.js).
import { namedPath } from './flow-param-title.js';
import { isRpc, rpcCommand } from './flow-amqp.js';

/** "http:POST orders-svc/orders" -> "POST /orders"; other transports show their event or label. */
export function callLabel(m) {
  if (m.mergedCalls) return m.label; if (isRpc(m)) return rpcCommand(m); // #109: a merged call (Simple) is drawn as its "*3 POST /a, GET /b" text
  if (m.transport === 'undecided' && m.kind !== 'deliver' && !m.event) return m.operation ?? m.label.replace(/^.*?tbd:(?:[^/\s]*\/)?/, ''); // #76: a `tbd:<component>/<operation>` key is never drawn: the operation name, else the key's last part; the key stays in the tooltip and the panel
  if (m.kind === 'deliver') { const hd = m.target?.fn ?? m.label.match(/→\s*(.+)$/)?.[1] ?? ''; return m.event ? `${m.event} → ${hd}` : hd; }
  if (m.operation && m.kind === 'egress' && !m.event) return m.operation; // the call's own words; the key is in the panel and the title
  if (m.transport === 'http' || m.transport === 'rpc') {
    const t = m.label.replace(/^\w+:/, '');
    const k = t.match(/^(\S+) [^/\s]*(\/.*)$/);
    return k ? `${k[1]} ${namedPath(k[2], m.pathParams)}` : t; // #149: the harvested parameter names replace {p1}
  }
  return m.gap && m.kind !== 'deliver' ? m.label : m.event ?? m.label.replace(/^.*→\s*/, '').replace(/^\w+:/, ''); // #99: a gap's text already leads with its event names
}
