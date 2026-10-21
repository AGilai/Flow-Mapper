// Draft ops, pure (QA O1-O5): fold order, overlay, change counts, manifests (full vs delta, replaceHeader).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftChanges, netOps, overlayRows, type DraftOp } from '../core/draft-ops.ts';
import { draftManifests } from '../core/draft-manifests.ts';
import { opRow } from '../core/draft-ops.ts';
import { rawHash } from '../core/diff/normalise.ts';
import { rowId, type ItemRow } from '../core/item-rows.ts';
import { diff, mini, row } from './diff-helpers.ts';

const env = mini();
let seq = 0;
const op = (kind: 'upsert' | 'delete', anchor: string, data?: unknown, extra: Partial<DraftOp> = {}): DraftOp => {
  const r = opRow({ op: kind, anchor, service: extra.service });
  const e = env.find((x) => rowId(x) === rowId(r));
  return { op: kind, anchor, ...r, ...(data !== undefined ? { data } : {}), seq: ++seq, baseHash: e ? rawHash(e.data, r.list) : null, author: 'ana', byAi: false, at: 't', ...extra };
};
const ing = (id: string) => ({ id, transport: 'http', bindKey: `http:GET auth-svc/${id}`, handler: 'Token.issue' });
const get = (rows: ItemRow[], s: string, l: string, k: string) => rows.find((r) => r.service === s && r.list === l && r.key === k);

test('O1 net ops: the last op per item wins, in seq order', () => {
  const ops = [op('upsert', 'ing:auth-svc/a', ing('a')), op('upsert', 'ing:auth-svc/a', { ...ing('a'), transport: 'grpc' }), op('upsert', 'ing:auth-svc/b', ing('b'))];
  const net = netOps([ops[2], ops[0], ops[1]]);
  assert.deepEqual(net.map((o) => o.anchor), ['ing:auth-svc/a', 'ing:auth-svc/b']);
  assert.equal((net[0].data as any).transport, 'grpc');
});

test('O2 delete then re-create gives the re-created item; create then delete leaves nothing in the overlay', () => {
  const net = netOps([op('delete', 'ing:auth-svc/in.token'), op('upsert', 'ing:auth-svc/in.token', ing('in.token'))]);
  assert.equal(net.length, 1); assert.equal(net[0].op, 'upsert');
  const gone = overlayRows(env, netOps([op('upsert', 'ing:auth-svc/new', ing('new')), op('delete', 'ing:auth-svc/new')]));
  assert.equal(get(gone, 'auth-svc', 'ingress', 'new'), undefined);
});

test('O3 deleting a component wipes its earlier ops and every row of it; a re-created one replaces, it does not merge', () => {
  const del = [op('upsert', 'egr:auth-svc/tmp', { id: 'tmp', transport: 'http', bindKey: 'http:GET x/y' }), op('delete', 'svc:auth-svc')];
  assert.deepEqual(netOps(del).map((o) => o.anchor), ['svc:auth-svc']);
  const rows = overlayRows(env, netOps(del));
  assert.equal(rows.some((r) => r.service === 'auth-svc'), false);
  assert.ok(rows.some((r) => r.service === 'users-svc'));
  const again = netOps([...del, op('upsert', 'svc:auth-svc', { kind: 'service', team: 'new' }), op('upsert', 'ing:auth-svc/only', ing('only'))]);
  assert.deepEqual(again.map((o) => `${o.op} ${o.anchor}`), ['delete svc:auth-svc', 'upsert svc:auth-svc', 'upsert ing:auth-svc/only']);
  const re = overlayRows(env, again);
  assert.deepEqual(re.filter((r) => r.service === 'auth-svc').map((r) => r.list).sort(), ['header', 'ingress'], 'the old functions and ingress are gone');
  const m = draftManifests(again, env, 'T', 'd');
  assert.deepEqual([m.manifests[0].kind, m.manifests[0].version, m.deletes], ['full', 8, []]);
});

test('O4 the overlay of an env leaves the env rows alone and carries the version of an edited header', () => {
  const copy = structuredClone(env);
  const rows = overlayRows(copy, netOps([op('upsert', 'svc:auth-svc', { kind: 'service', team: 'x' })]));
  assert.deepEqual(copy, env);
  assert.equal(get(rows, 'auth-svc', 'header', '')!.data.version, 7);
  assert.equal(get(rows, 'auth-svc', 'header', '')!.data.team, 'x');
});

test('O5 counts equal the items listed (top level only), children of an added component are `under`, stale flags a moved base', () => {
  const ops = [
    op('upsert', 'svc:pop', { kind: 'service' }), op('upsert', 'ing:pop/i', { ...ing('i'), handler: 'H' }), op('upsert', 'fn:pop/H', { id: 'H', name: 'H', steps: [] }),
    op('upsert', 'ing:auth-svc/in.token', { ...ing('in.token'), transport: 'grpc' }),          // changed
    op('upsert', 'ing:auth-svc/same', ing('same')),                                              // added
    op('delete', 'egr:users-svc/out.pub'),                                                       // removed
    op('delete', 'egr:users-svc/never-was'),                                                     // nothing
    op('upsert', 'ing:users-svc/in.getUser', row(env, 'users-svc', 'ingress', 'in.getUser').data), // equal: nothing
  ];
  const c = draftChanges(env, netOps(ops), ops);
  assert.deepEqual(c.counts, { added: 2, removed: 1, changed: 1 });
  assert.equal(c.items.filter((i) => !i.under).length, 4);
  assert.deepEqual(c.items.filter((i) => i.under).map((i) => i.anchor), ['fn:pop/H', 'ing:pop/i']);
  assert.deepEqual(c.authors, ['ana']);
  assert.equal(c.items.some((i) => i.stale), false);
  const moved = structuredClone(env);
  row(moved, 'auth-svc', 'ingress', 'in.token').data.transport = 'sqs';
  assert.equal(draftChanges(moved, netOps(ops), ops).items.find((i) => i.anchor === 'ing:auth-svc/in.token')!.stale, true);
});

test('O5 removing a component counts one removal, its children are listed under it', () => {
  const ops = [op('delete', 'svc:users-svc')];
  const c = draftChanges(env, netOps(ops), ops);
  assert.deepEqual(c.counts, { added: 0, removed: 1, changed: 0 });
  assert.ok(c.items.length > 5 && c.items.filter((i) => !i.under).length === 1);
});

test('manifests: a new service is full v1, an existing one a delta v+1 with only the changed items, deletes and DTOs aside', () => {
  const ops = [
    op('upsert', 'svc:pop', { kind: 'service', groupPath: 'agent' }), op('upsert', 'ing:pop/i', { ...ing('i'), handler: 'H' }), op('upsert', 'fn:pop/H', { id: 'H', name: 'H', steps: [] }),
    op('upsert', 'ing:auth-svc/n', ing('n')), op('delete', 'egr:users-svc/out.pub'),
    op('upsert', 'ing:users-svc/in.getUser', row(env, 'users-svc', 'ingress', 'in.getUser').data),
    op('upsert', 'dto:users-svc/response/-/in.getUser', { content: { a: 1 }, meta: null }), op('upsert', 'flow:users-svc/in.getUser', { name: 'N' }),
  ];
  const m = draftManifests(netOps(ops), env, 'T', 'd');
  const by = Object.fromEntries(m.manifests.map((x) => [x.service.name, x]));
  assert.deepEqual([by.pop.kind, by.pop.version, by.pop.service.groupPath, by.pop.ingress.length, by.pop.functions.length, by.pop.env, by.pop.harvestedAt], ['full', 1, 'agent', 1, 1, 'd', 'T']);
  assert.deepEqual([by['auth-svc'].kind, by['auth-svc'].baseVersion, by['auth-svc'].version, Object.keys(by['auth-svc'].upsert)], ['delta', 7, 8, ['ingress']]);
  assert.deepEqual([by['users-svc'].baseVersion, by['users-svc'].upsert, by['users-svc'].delete], [3, undefined, { egress: ['out.pub'] }], 'an equal upsert is not sent');
  assert.deepEqual(m.side.map((o) => o.list), ['dto', 'flow']);
  assert.equal(m.replaceHeader.size, 0);
});

test('manifests: a header op replaces the stored header (replaceHeader) and a delete of a component goes to deletes', () => {
  const ops = [op('upsert', 'svc:users-svc', { kind: 'service', team: 'identity' }), op('delete', 'svc:auth-svc')];
  const m = draftManifests(netOps(ops), env, 'T', 'd');
  assert.deepEqual([...m.replaceHeader], ['users-svc']);
  assert.equal(m.manifests[0].service.description, undefined, 'description was dropped: the whole header is the draft\'s');
  assert.deepEqual(m.deletes, ['auth-svc']);
  assert.equal(diff(env, overlayRows(env, netOps(ops))).marks['svc:auth-svc'].mark, 'removed');
});
