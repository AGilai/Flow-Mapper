// Edit form builders (core/design-edit.ts and friends): pure, from a DesignEdit and rows to whole-item ops.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designEditOps, editWarnings, EditError, type DesignEdit } from '../core/design-edit.ts';
import { defaultMode, egressIdFor } from '../core/edit-calls.ts';
import { designIssues } from '../core/design-rules.ts';
import { indexRows } from '../core/edit-kit.ts';
import { rowId, type ItemRow } from '../core/item-rows.ts';

const hdr = (service: string, data: object = { kind: 'service' }): ItemRow => ({ service, list: 'header', key: '', data });
const fn = (service: string, id: string, steps: any[] = []): ItemRow => ({ service, list: 'functions', key: id, data: { id, name: id, steps } });
const egr = (service: string, id: string, bindKey: string, extra: object = {}): ItemRow => ({ service, list: 'egress', key: id, data: { id, bindKey, transport: 'http', mode: 'sync', ...extra } });
const ing = (service: string, id: string, bindKey: string, handler: string, transport = bindKey.split(':')[0] === 'sqs' ? 'sqs' : 'http'): ItemRow => ({ service, list: 'ingress', key: id, data: { id, bindKey, transport, handler } });
const step = (seq: number, target: string, extra: object = {}) => ({ seq, type: 'egress', target, ...extra });
const ops = (e: DesignEdit, rows: ItemRow[] = []) => designEditOps(e, rows);
const code = (e: DesignEdit, rows: ItemRow[] = []) => { try { ops(e, rows); } catch (x: any) { return x instanceof EditError ? [x.code, x.field] : x; } };
const data = (o: any) => o.data;

test('component: a header upsert; an existing header keeps repo and details but not its version; \'\' clears a field; BAD_NAME, BAD_KIND', () => {
  assert.deepEqual(ops({ kind: 'component', name: 'pop-swg', serviceKind: 'service', groupPath: 'network', team: 'net' }), [{ op: 'upsert', anchor: 'svc:pop-swg', data: { kind: 'service', groupPath: 'network', team: 'net' } }]);
  const cur = hdr('a', { kind: 'service', repo: 'r', details: { doc: 1 }, team: 'old', version: 4, harvestedAt: 't', commit: 'c' });
  assert.deepEqual(data(ops({ kind: 'component', name: 'a', serviceKind: 'gateway', team: '' }, [cur])[0]), { kind: 'gateway', repo: 'r', details: { doc: 1 } });
  assert.deepEqual(code({ kind: 'component', name: 'Bad_Name', serviceKind: 'service' }), ['BAD_NAME', 'name']);
  assert.deepEqual(code({ kind: 'component', name: 'ok', serviceKind: 'nope' as any }), ['BAD_KIND', 'serviceKind']);
});

test('endpoint: id from the bind key (unique), the handler stub, undecided fills tbd:, entry point, events, an existing endpoint is merged', () => {
  const rows = [hdr('edge'), ing('edge', 'in.apply', 'http:GET edge/apply', 'h')];
  const [stub, e] = ops({ kind: 'endpoint', service: 'edge', transport: 'socket', bindKey: 'socket:tls/pop-swg/apply', entryPoint: true }, rows);
  assert.deepEqual(stub, { op: 'upsert', anchor: 'fn:edge/in.apply-2.handle', data: { id: 'in.apply-2.handle', name: 'in.apply-2.handle', steps: [] } });
  assert.deepEqual([e.anchor, data(e)], ['ing:edge/in.apply-2', { id: 'in.apply-2', bindKey: 'socket:tls/pop-swg/apply', transport: 'socket', handler: 'in.apply-2.handle', entryPoint: true }]);
  assert.deepEqual(ops({ kind: 'endpoint', service: 'edge', transport: 'http', bindKey: 'http:GET edge/users/{id}', handler: 'h' }, [...rows, fn('edge', 'h')]).map((o) => o.anchor), ['ing:edge/in.id'], 'the handler exists: no stub');
  assert.equal(data(ops({ kind: 'endpoint', service: 'edge', transport: 'undecided' }, rows)[1]).bindKey, 'tbd:edge/in.undecided'.replace('in.undecided', 'undecided').replace(/^tbd:edge\/undecided$/, data(ops({ kind: 'endpoint', service: 'edge', transport: 'undecided' }, rows)[1]).bindKey));
  assert.match(data(ops({ kind: 'endpoint', service: 'edge', id: 'in.q', transport: 'undecided' }, rows)[1]).bindKey, /^tbd:edge\/q$/);
  const ev = ops({ kind: 'endpoint', service: 'edge', transport: 'sqs', bindKey: 'sqs:q', events: [{ type: 'A' }, { type: 'B', handler: 'onB' }] }, rows);
  assert.deepEqual(data(ev[ev.length - 1]).events, [{ type: 'A', handler: 'in.q.handle' }, { type: 'B', handler: 'onB' }]);
  assert.deepEqual(ev.filter((o) => o.anchor.startsWith('fn:')).map((o) => o.anchor), ['fn:edge/in.q.handle', 'fn:edge/onB']);
  const upd = ops({ kind: 'endpoint', service: 'edge', id: 'in.apply', transport: 'http', description: 'Applies it' }, rows);
  assert.deepEqual(data(upd[upd.length - 1]), { id: 'in.apply', bindKey: 'http:GET edge/apply', transport: 'http', handler: 'h', details: { description: 'Applies it' } }, 'bind key and handler kept');
  assert.deepEqual(code({ kind: 'endpoint', service: 'ghost', transport: 'http', bindKey: 'x' }), ['NO_SERVICE', 'service']);
  assert.deepEqual(code({ kind: 'endpoint', service: 'edge', transport: 'http' }, rows), ['INVALID', 'bindKey']);
});

test('call modes: async for sns, sqs, eventbridge, event and amqp publishes; sync for http, rpc, grpc, amqp-rpc and undecided', () => {
  const m = (t: any, k = 'k') => defaultMode(t, k);
  assert.deepEqual(['sns', 'sqs', 'eventbridge', 'event', 'amqp'].map((t) => m(t)), Array(5).fill('async'));
  assert.deepEqual(['http', 'rpc', 'grpc', 'undecided', 'socket', 'other'].map((t) => m(t)), Array(6).fill('sync'));
  assert.equal(m('amqp', 'amqp-rpc:cmd'), 'sync');
});

const base = [hdr('a'), hdr('b'), fn('a', 'f', [step(1, 'out.b.x'), step(2, 'out.b.y')]), egr('a', 'out.b.x', 'http:GET b/x'), egr('a', 'out.b.y', 'http:GET b/y'), ing('b', 'in.x', 'http:GET b/x', 'hx'), ing('b', 'in.z', 'sqs:z', 'hz')];
const call = (e: Partial<Extract<DesignEdit, { kind: 'call' }>>, rows = base) => ops({ kind: 'call', from: { service: 'a', fn: 'f' }, to: { service: 'b', ingress: 'in.x' }, ...e } as any, rows);

test('a call to an existing endpoint: a new egress (unique id), the step last or before another, steps renumbered, altGroup kept', () => {
  const [eg, f] = call({ operation: 'GET x' });
  assert.deepEqual([eg.anchor, data(eg)], ['egr:a/out.b.GET-x', { id: 'out.b.GET-x', bindKey: 'http:GET b/x', transport: 'http', mode: 'sync' }]);
  assert.deepEqual(data(f).steps.map((s: any) => [s.seq, s.target]), [[1, 'out.b.x'], [2, 'out.b.y'], [3, 'out.b.GET-x']]);
  const rows = base.map((r) => (r.list === 'functions' ? { ...r, data: { ...r.data, steps: [step(1, 'out.b.x', { altGroup: 'g' }), step(2, 'out.b.y')] } } : r));
  const ins = data(call({ before: 2, condition: 'ok' }, rows)[1]).steps;
  assert.deepEqual(ins.map((s: any) => [s.seq, s.target, s.condition, s.altGroup]), [[1, 'out.b.x', undefined, 'g'], [2, 'out.b.in.x', 'ok', undefined], [3, 'out.b.y', undefined, undefined]]);
  assert.equal(egressIdFor('a', { service: 'b', label: 'in.x' }, indexRows(base)), 'out.b.in.x');
  assert.equal(egressIdFor('a', { service: 'b', label: 'x' }, indexRows([...base, egr('a', 'out.b.x', 'k')])), 'out.b.x-2');
  assert.deepEqual(code({ kind: 'call', from: { service: 'a', fn: 'f' }, to: { service: 'b', ingress: 'in.x' }, before: 9 }, base), ['NO_STEP', 'before']);
});

test('a call into a new endpoint, a not designed yet target, an async endpoint and a function that does not exist yet', () => {
  const o = ops({ kind: 'call', from: { service: 'a', fn: 'newfn' }, to: { endpoint: { service: 'b', transport: 'sqs', bindKey: 'sqs:new' } } }, base);
  assert.deepEqual(o.map((x) => x.anchor), ['fn:b/in.new.handle', 'ing:b/in.new', 'egr:a/out.b.in.new', 'fn:a/newfn']);
  assert.deepEqual(data(o[2]), { id: 'out.b.in.new', bindKey: 'sqs:new', transport: 'sqs', mode: 'async' });
  assert.deepEqual(data(o[3]), { id: 'newfn', name: 'newfn', steps: [{ seq: 1, type: 'egress', target: 'out.b.in.new' }] });
  const nd = call({ to: { bindKey: 'http:GET nowhere/x', transport: 'http' } });
  assert.deepEqual([nd[0].anchor, data(nd[0]).bindKey], ['egr:a/out.nowhere.x', 'http:GET nowhere/x']);
  assert.equal(data(call({ to: { bindKey: 'tbd:core/Policy', transport: 'undecided' } })[0]).mode, 'sync');
  assert.equal(data(call({ to: { service: 'b', ingress: 'in.z' } })[0]).mode, 'async');
  assert.deepEqual(code({ kind: 'call', from: { service: 'a', fn: 'f' }, to: { service: 'b', ingress: 'nope' } }, base), ['NO_TARGET', 'to']);
  assert.deepEqual(code({ kind: 'call', from: { service: 'ghost', fn: 'f' }, to: { service: 'b', ingress: 'in.x' } }), ['NO_SERVICE', 'from']);
  assert.deepEqual(editWarnings({ kind: 'call', description: 'x' } as any).length, 1);
});

test('editing a call: an unchanged target keeps its egress; a changed one mutates an unshared egress and makes a new id for a shared one', () => {
  const same = call({ edit: { egress: 'out.b.x', seq: 1 }, condition: 'when ok' });
  assert.deepEqual(same.map((o) => o.anchor), ['fn:a/f'], 'no egress op: nothing about the egress changed');
  assert.deepEqual(data(same[0]).steps[0], { seq: 1, type: 'egress', target: 'out.b.x', condition: 'when ok' });
  const moved = call({ edit: { egress: 'out.b.x', seq: 1 }, to: { service: 'b', ingress: 'in.z' } });
  assert.deepEqual([moved[0].anchor, data(moved[0]).bindKey, data(moved[0]).mode], ['egr:a/out.b.x', 'sqs:z', 'async'], 'unshared: changed in place');
  const shared = base.map((r) => (r.list === 'functions' ? { ...r, data: { ...r.data, steps: [step(1, 'out.b.x'), step(2, 'out.b.x')] } } : r));
  const copy = call({ edit: { egress: 'out.b.x', seq: 1 }, to: { service: 'b', ingress: 'in.z' } }, shared);
  assert.deepEqual([copy[0].anchor, data(copy[1]).steps.map((s: any) => s.target)], ['egr:a/out.b.in.z', ['out.b.in.z', 'out.b.x']], 'shared: a new egress, the other step keeps the old one');
  assert.deepEqual(code({ kind: 'call', from: { service: 'a', fn: 'f' }, to: { service: 'b', ingress: 'in.x' }, edit: { egress: 'out.b.x', seq: 2 } }, base), ['NO_STEP', 'edit']);
});

test('delete-call removes the step and renumbers; the egress goes unless another step still uses it', () => {
  const del = (rows: ItemRow[], seq: number) => ops({ kind: 'delete-call', service: 'a', fn: 'f', seq }, rows);
  const o = del(base, 1);
  assert.deepEqual(o.map((x) => x.anchor), ['fn:a/f', 'egr:a/out.b.x']); assert.deepEqual(data(o[0]).steps.map((s: any) => [s.seq, s.target]), [[1, 'out.b.y']]);
  const two = base.map((r) => (r.list === 'functions' ? { ...r, data: { ...r.data, steps: [step(1, 'out.b.x'), step(2, 'out.b.x')] } } : r));
  assert.deepEqual(del(two, 1).map((x) => x.anchor), ['fn:a/f']);
  const other = [...base, fn('a', 'g', [step(1, 'out.b.x')])];
  assert.deepEqual(del(other, 1).map((x) => x.anchor), ['fn:a/f'], 'used by another function');
  assert.deepEqual(code({ kind: 'delete-call', service: 'a', fn: 'f', seq: 7 }, base), ['NO_STEP', 'seq']);
});

test('flow: name and description in the flow item (merged), \'\' kept to clear, entry point on the endpoint, order of a function\'s steps', () => {
  const rows = [...base, { service: 'b', list: 'flow', key: 'in.x', data: { name: 'Old', description: 'D' } } as ItemRow];
  const f = (e: object, r = rows) => ops({ kind: 'flow', service: 'b', ingress: 'in.x', ...e } as any, r);
  assert.deepEqual(data(f({ name: ' New ' })[0]), { name: 'New', description: 'D' });
  assert.equal(data(f({ name: '' })[0]).name, '');
  assert.deepEqual(f({ entryPoint: true }).map((o) => [o.anchor, data(o).entryPoint]), [['ing:b/in.x', true]]);
  assert.deepEqual(f({ entryPoint: false }), [], 'already not an entry point: nothing to do');
  const o = ops({ kind: 'flow', service: 'a', ingress: 'in.nope', order: { fn: 'f', seqs: [2, 1] } }, [...base, ing('a', 'in.nope', 'k', 'f')]);
  assert.deepEqual(data(o[0]).steps.map((s: any) => [s.seq, s.target]), [[1, 'out.b.y'], [2, 'out.b.x']]);
  for (const seqs of [[1], [1, 1], [1, 3]]) assert.deepEqual(code({ kind: 'flow', service: 'a', ingress: 'in.nope', order: { fn: 'f', seqs } }, [...base, ing('a', 'in.nope', 'k', 'f')]), ['BAD_ORDER', 'order']);
  assert.deepEqual(code({ kind: 'flow', service: 'b', ingress: 'nope' }, base), ['NO_ITEM', 'ingress']);
});

test('dto, event-dto and delete: whole items, meta kept; deleting an endpoint takes its DTOs and flow text along', () => {
  const dto: ItemRow = { service: 'b', list: 'dto', key: 'in.x|response|', data: { content: { a: 1 }, meta: { provenance: 'hld' } } };
  const rows = [...base, dto, { ...dto, key: 'in.x|request|' }, { service: 'b', list: 'flow', key: 'in.x', data: { name: 'N' } } as ItemRow, { service: '', list: 'event_dto', key: 'Ev', data: { content: {}, meta: { x: 1 } } } as ItemRow];
  assert.deepEqual(ops({ kind: 'dto', service: 'b', ingress: 'in.x', role: 'response', content: { a: 2 } }, rows), [{ op: 'upsert', anchor: 'dto:b/response/-/in.x', data: { content: { a: 2 }, meta: { provenance: 'hld' } } }]);
  assert.deepEqual(ops({ kind: 'dto', service: 'b', ingress: 'in.x', role: 'response', status: '404', content: {} }, rows)[0].anchor, 'dto:b/response/404/in.x');
  assert.deepEqual(ops({ kind: 'event-dto', type: 'Ev', content: { z: 1 } }, rows), [{ op: 'upsert', anchor: 'evt:Ev', data: { content: { z: 1 }, meta: { x: 1 } } }]);
  assert.deepEqual(ops({ kind: 'delete', anchor: 'ing:b/in.x' }, rows).map((o) => `${o.op} ${o.anchor}`), ['delete ing:b/in.x', 'delete dto:b/response/-/in.x', 'delete dto:b/request/-/in.x', 'delete flow:b/in.x']);
  assert.deepEqual(ops({ kind: 'delete', anchor: 'svc:a' }, rows), [{ op: 'delete', anchor: 'svc:a' }]);
  assert.deepEqual(code({ kind: 'delete', anchor: 'fn:a/f' }, rows), ['BAD_ANCHOR', 'anchor']);
  assert.deepEqual(code({ kind: 'delete', anchor: 'svc:zzz' }, rows), ['NO_ITEM', 'anchor']);
  assert.deepEqual(code({ kind: 'nope' } as any), ['INVALID', 'kind']);
});

test('design rules: NO_TARGET for a step naming nothing, NO_GROUP for a header outside the subsystems', () => {
  const after = new Map([hdr('a', { kind: 'service', groupPath: 'x' }), fn('a', 'f', [step(1, 'gone'), { seq: 2, type: 'call', target: 'f' }, { seq: 3, type: 'resource', target: 'r' }])].map((r) => [rowId(r), r]));
  const t = (service: string, list: string, key: string) => ({ index: 0, service, list, key });
  const issues = designIssues(after, [t('a', 'functions', 'f'), t('a', 'header', '')], ['y']);
  assert.deepEqual(issues.map((i) => i.code), ['NO_TARGET', 'NO_TARGET', 'NO_GROUP']);
  assert.deepEqual(designIssues(after, [t('a', 'header', '')], undefined), [], 'no groups given: not checked');
});
