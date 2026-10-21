// A small design as ItemRows for the subsystem tests: three subsystems (agent, network, platform with settings rows), six components,
// a few calls between them, one call that goes nowhere. `rows()` returns a fresh copy each time.

import { buildIndex } from '../core/graph-index.ts';
import { rowId, rowsToModel, type ItemRow } from '../core/item-rows.ts';

const r = (service: string, list: string, key: string, data: any): ItemRow => ({ service, list, key, data });
const head = (name: string, groupPath?: string, kind = 'service') => r(name, 'header', '', { kind, ...(groupPath ? { groupPath } : {}), version: 1, harvestedAt: 't' });
const ing = (s: string, id: string, bindKey: string, handler: string) => [r(s, 'ingress', id, { id, transport: 'http', bindKey, handler }), r(s, 'functions', handler, { id: handler, name: handler, steps: [] })];
const egr = (s: string, id: string, bindKey: string, extra: any = {}) => r(s, 'egress', id, { id, transport: 'http', bindKey, ...extra });
const fn = (s: string, id: string, targets: string[]) => r(s, 'functions', id, { id, name: id, steps: targets.map((t, i) => ({ seq: i + 1, type: 'egress', target: t })) });

const all = (): ItemRow[] => [
  r('', 'subsystem', 'agent', { label: 'Agent', icon: 'agent', order: 0 }),
  r('', 'subsystem', 'network', { label: 'Network (POP)', icon: 'network', order: 1 }),
  r('', 'subsystem', 'platform', { label: 'Platform', icon: 'platform', order: 2 }),
  head('sase-agent', 'agent', 'client-app'), head('pop-edge', 'network'), head('auth-svc', 'platform'), head('users-svc', 'platform'), head('billing-svc', 'platform'), head('loose'),
  ...ing('pop-edge', 'in.tunnel', 'http:POST pop-edge/tunnel', 'Tunnel.open'),
  ...ing('auth-svc', 'in.token', 'http:POST auth-svc/token', 'Token.issue'),
  ...ing('users-svc', 'in.users', 'http:GET users-svc/users', 'Users.list'),
  ...ing('billing-svc', 'in.usage', 'http:POST billing-svc/usage', 'Usage.record'),
  r('loose', 'functions', 'Loose.run', { id: 'Loose.run', name: 'Loose.run', steps: [{ seq: 1, type: 'egress', target: 'out.users' }] }),
  r('sase-agent', 'egress', 'out.pop', { id: 'out.pop', transport: 'http', bindKey: 'http:POST pop-edge/tunnel', mode: 'sync' }),
  fn('sase-agent', 'Agent.start', ['out.pop']),
  egr('pop-edge', 'out.auth', 'http:POST auth-svc/token'), egr('pop-edge', 'out.users', 'http:GET users-svc/users'), egr('pop-edge', 'out.void', 'http:GET nobody/x'),
  fn('pop-edge', 'Tunnel.open', ['out.auth', 'out.users', 'out.void']),
  egr('auth-svc', 'out.users', 'http:GET users-svc/users'), fn('auth-svc', 'Token.issue', ['out.users']),
  egr('loose', 'out.users', 'http:GET users-svc/users'),
];

/** A fresh copy: the last row of a key wins (a stub function of an endpoint is replaced by the one with steps). */
export const rows = (): ItemRow[] => [...new Map(structuredClone(all()).map((x) => [rowId(x), x])).values()];

/** The graph of `rows` (header rows carry no `name`: rowsToModel adds it). */
export const graphOf = (rs: ItemRow[]) => buildIndex(rowsToModel('t', rs));
export const subRows = (rs: ItemRow[]) => rs.filter((x) => x.list === 'subsystem');
export const linkRows = (rs: ItemRow[]) => rs.filter((x) => x.list === 'link');
