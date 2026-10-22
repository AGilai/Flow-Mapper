// 0.29.0: action items under a flow. REST (list, add, update, delete, counts), numbering that is never reused, creator-only delete, anyone edits,
// validation, events on close / reopen / drop, draft reads, sealed envs, copy modes, MCP, seed data, SSE events.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDesign, SAMPLES } from './helpers.ts';
import { stepKeys } from '../core/description.ts';
import { loadComments } from '../server/store/comments.ts';
import { loadActionItems } from '../server/store/action-items-io.ts';
import { eventFor, isDue, tally } from '../core/action-items.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
let step: string;
before(async () => {
  app = await startDesign();
  const t = (await app.call('GET', '/api/envs/prod/trace?detail=full&service=api-gateway&ingress=in.createOrder&scope=full&maxMessages=2000')).body;
  step = stepKeys(t.messages)[2];
  assert.equal((await app.call('POST', '/api/envs', { name: 'dsn', source: 'prod', mode: 'full' })).status, 201);
});
after(() => app.close());

const A = 'flow:api-gateway/in.createOrder';
const B = 'flow:users-svc/in.getUser';
const list = async (env = 'prod', anchor = A, q = '') => (await app.call('GET', `/api/envs/${env}/action-items?anchor=${encodeURIComponent(anchor)}${q}`)).body;
const post = (b: object, env = 'prod', q = '') => app.call('POST', `/api/envs/${env}/action-items${q}`, { anchor: A, owner: 'Dana', description: 'do it', actor: 'Ana', ...b });
const patch = (id: number, b: object, env = 'prod') => app.call('PATCH', `/api/envs/${env}/action-items/${id}`, { actor: 'Ben', ...b });

test('pure rules: due dates, the events a status change writes, the tally', () => {
  assert.ok(isDue('2026-02-28')); assert.ok(!isDue('2026-02-30')); assert.ok(!isDue('2026-2-3')); assert.ok(!isDue(5));
  assert.equal(eventFor('open', 'progress'), null); assert.equal(eventFor('open', 'done'), 'closed'); assert.equal(eventFor('progress', 'dropped'), 'dropped');
  assert.equal(eventFor('done', 'open'), 'reopened'); assert.equal(eventFor('done', 'dropped'), null);
  assert.deepEqual(tally([{ status: 'open' }, { status: 'progress' }, { status: 'done' }]), { open: 2, all: 3 });
});

test('add, list in number order, counts of open items; sealed and design environments both take items', async () => {
  const one = await post({ description: '  first  ', due: '2030-01-02' });
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.deepEqual([one.body.number, one.body.description, one.body.status, one.body.due, one.body.source, one.body.createdBy], [1, 'first', 'open', '2030-01-02', 'human', 'Ana']);
  const two = (await post({ owner: 'Noa', status: 'progress' })).body;
  assert.equal(two.number, 2);
  const l = await list();
  assert.deepEqual(l.items.map((i: any) => i.number), [1, 2]);
  assert.deepEqual(l.events.map((e: any) => [e.number, e.kind, e.actor]), [[1, 'created', 'Ana'], [2, 'created', 'Ana']]);
  assert.equal((await app.call('GET', '/api/envs/prod/action-items/counts')).body[A], 2);
  const d = await post({ anchor: B }, 'dsn');
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.body.number, 1, 'numbers are per environment and anchor');
  assert.equal((await list('prod', B)).items.length, 0);
});

test('numbers are never reused after a delete; only the creator deletes; anyone edits and is recorded', async () => {
  const x = (await post({ anchor: 'flow:orders-svc/in.get', actor: 'Cy' })).body;
  const anchor = x.anchor;
  const y = (await post({ anchor, actor: 'Cy' })).body;
  assert.deepEqual([x.number, y.number], [1, 2]);
  assert.equal((await app.call('DELETE', `/api/envs/prod/action-items/${y.id}?actor=Ben`)).status, 403);
  assert.equal((await app.call('DELETE', `/api/envs/prod/action-items/${y.id}?actor=Ben`)).body.error.code, 'NOT_CREATOR');
  assert.equal((await app.call('DELETE', `/api/envs/prod/action-items/${y.id}`)).status, 400);
  const e = await patch(y.id, { owner: 'Zed', description: 'changed', due: '2031-05-06' });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.deepEqual([e.body.owner, e.body.description, e.body.due, e.body.updatedBy, e.body.createdBy], ['Zed', 'changed', '2031-05-06', 'Ben', 'Cy']);
  assert.equal((await patch(y.id, { due: null })).body.due, null, 'null clears the due date');
  assert.equal((await app.call('DELETE', `/api/envs/prod/action-items/${y.id}?actor=Cy`)).status, 200);
  assert.equal((await patch(y.id, { owner: 'x' })).status, 404, 'a deleted item is gone');
  assert.equal((await list('prod', anchor)).items.length, 1);
  const z = (await post({ anchor })).body;
  assert.equal(z.number, 3, 'the next number is max + 1 over deleted rows too');
  await app.call('DELETE', `/api/envs/prod/action-items/${z.id}?actor=Ana`);
  assert.equal((await post({ anchor })).body.number, 4);
});

test('validation: owner, description, status, due, step, commentId, anchor, flow, environment', async () => {
  const bad = async (b: object, code: number, env = 'prod') => { const r = await post(b, env); assert.equal(r.status, code, JSON.stringify(b)); return r; };
  assert.equal((await bad({ owner: '' }, 400)).body.error.code, 'VALIDATION');
  await bad({ owner: 'a'.repeat(81) }, 400);
  await bad({ description: '   ' }, 400);
  await bad({ description: 'x'.repeat(2001) }, 400);
  await bad({ status: 'finished' }, 400);
  await bad({ due: '2026-13-01' }, 400);
  await bad({ due: 'tomorrow' }, 400);
  await bad({ actor: '' }, 400);
  await bad({ anchor: 'svc:api-gateway' }, 400);
  await bad({ anchor: 'flow:api-gateway/in.nope' }, 404);
  await bad({}, 404, 'nope');
  await bad({ step: '#step:a>b|c|d' }, 400);
  await bad({ step: 'step 3' }, 400);
  await bad({ commentId: 99999 }, 400);
  assert.equal((await post({ description: 'x'.repeat(2000), owner: 'o'.repeat(80), step, status: 'done' })).status, 200);
  const c = (await app.call('POST', '/api/envs/prod/comments', { anchor: B, author: 'Ana', body: 'elsewhere' })).body;
  await bad({ commentId: c.id }, 400);
  const mine = (await app.call('POST', '/api/envs/prod/comments', { anchor: A, author: 'Ana', body: 'here' })).body;
  assert.equal((await post({ commentId: mine.id })).body.commentId, mine.id);
  assert.equal((await patch(1, { status: 'nope' })).status, 400);
  assert.equal((await patch(1, { description: '' })).status, 400);
  assert.equal((await patch(1, { step: 'x' })).status, 400);
  assert.equal((await app.call('GET', '/api/envs/prod/action-items')).status, 400);
  assert.equal((await app.call('GET', `/api/envs/nope/action-items?anchor=${A}`)).status, 404);
  assert.equal((await app.call('PATCH', '/api/envs/prod/action-items/99999', { actor: 'a' })).status, 404);
});

test('events: closed, dropped, reopened across the open/closed line; progress and done to dropped write none', async () => {
  const a = 'flow:payments-svc/in.charge';
  const it = (await post({ anchor: a, actor: 'Ana' })).body;
  await patch(it.id, { status: 'progress' });
  assert.equal((await list('prod', a)).events.length, 1, 'open to progress crosses nothing');
  const done = (await patch(it.id, { status: 'done' })).body;
  assert.ok(done.closedAt);
  await patch(it.id, { status: 'dropped' });
  assert.equal((await list('prod', a)).events.length, 2, 'done to dropped crosses nothing');
  const re = (await patch(it.id, { status: 'open', actor: 'Cy' })).body;
  assert.equal(re.closedAt, null);
  await patch(it.id, { status: 'dropped', actor: 'Dee' });
  assert.deepEqual((await list('prod', a)).events.map((e: any) => [e.kind, e.actor]), [['created', 'Ana'], ['closed', 'Ben'], ['reopened', 'Cy'], ['dropped', 'Dee']]);
  assert.equal((await app.call('GET', '/api/envs/prod/action-items/counts')).body[a], undefined, 'no open item: the anchor is absent');
});

test('deleting the source comment keeps the item; events carry the comment id', async () => {
  const a = 'flow:orders-svc/in.touch';
  const c = (await app.call('POST', '/api/envs/prod/comments', { anchor: a, author: 'Ana', body: 'x' })).body;
  const it = (await post({ anchor: a, commentId: c.id })).body;
  await app.call('DELETE', `/api/envs/prod/comments/${c.id}?author=Ana`);
  const l = await list('prod', a);
  assert.equal(l.items[0].commentId, c.id); assert.equal(l.events[0].commentId, c.id); assert.equal(l.events[0].number, it.number);
});

test('a draft makes a flow that only exists there carry items; unknown drafts are refused', async () => {
  const dr = (await app.call('POST', '/api/envs/dsn/drafts', { name: 'ai' })).body;
  assert.equal((await post({ anchor: B }, 'dsn', `?draft=${dr.slug}`)).status, 200);
  assert.equal((await post({ anchor: B }, 'dsn', '?draft=nope')).status, 404);
  assert.equal((await app.call('GET', `/api/envs/dsn/action-items?anchor=${encodeURIComponent(B)}&draft=${dr.slug}`)).status, 200);
  assert.equal((await app.call('GET', `/api/envs/dsn/action-items?anchor=${encodeURIComponent(B)}&draft=nope`)).status, 404);
});

test('push events: action_item.created / updated / deleted with env, anchor, id, number, status, actor', async () => {
  const last = (await app.call('GET', '/api/events/recent')).body.lastId;
  const it = (await post({ anchor: 'flow:payments-svc/in.legacyRefund', actor: 'Ana' })).body;
  await patch(it.id, { status: 'done' });
  await app.call('DELETE', `/api/envs/prod/action-items/${it.id}?actor=Ana`);
  const ev = (await app.call('GET', `/api/events/recent?types=action_item.*&since=${last}`)).body.events.filter((e: any) => e.data.id === it.id);
  assert.deepEqual(ev.map((e: any) => e.type), ['action_item.created', 'action_item.updated', 'action_item.deleted']);
  assert.deepEqual([ev[1].env, ev[1].data.anchor, ev[1].data.number, ev[1].data.status, ev[1].data.actor], ['prod', 'flow:payments-svc/in.legacyRefund', 1, 'done', 'Ben']);
});

test('copy modes: Full carries items, events and comment links (remapped); Blank and Components do not', async () => {
  const c = (await app.call('POST', '/api/envs/prod/comments', { anchor: B, author: 'Ana', body: 'src' })).body;
  const it = (await post({ anchor: B, commentId: c.id, description: 'copied' })).body;
  await patch(it.id, { status: 'done' });
  const gone = (await post({ anchor: B, description: 'deleted' })).body;
  await app.call('DELETE', `/api/envs/prod/action-items/${gone.id}?actor=Ana`);
  assert.equal((await app.call('POST', '/api/envs', { name: 'cp-full', source: 'prod', mode: 'full' })).status, 201);
  assert.equal((await app.call('POST', '/api/envs', { name: 'cp-blank', source: 'prod', mode: 'blank' })).status, 201);
  assert.equal((await app.call('POST', '/api/envs', { name: 'cp-comp', source: 'prod', mode: 'components', groups: [{ key: 'g', label: 'G' }], services: [{ name: 'users-svc', groupPath: 'g' }] })).status, 201);
  const src = await list('prod', B), full = await list('cp-full', B);
  const shape = (l: any) => l.items.map((i: any) => [i.number, i.owner, i.description, i.status, i.createdAt, i.closedAt]);
  assert.deepEqual(shape(full), shape(src));
  assert.deepEqual(full.events.map((e: any) => [e.number, e.kind, e.actor]), src.events.map((e: any) => [e.number, e.kind, e.actor]));
  const newComment = (await app.call('GET', `/api/envs/cp-full/comments?anchor=${encodeURIComponent(B)}`)).body.comments.find((x: any) => x.body === '<p>src</p>' || x.body === 'src');
  assert.ok(newComment && newComment.id !== c.id, 'its own comment rows');
  assert.equal(full.items.find((i: any) => i.description === 'copied').commentId, newComment.id, 'the link follows the copied comment');
  assert.equal((await post({ anchor: B }, 'cp-full')).body.number, src.items.at(-1).number + 2, 'numbers continue past deleted rows in the copy too');
  assert.deepEqual(Object.keys((await app.call('GET', '/api/envs/cp-blank/action-items/counts')).body), []);
  assert.deepEqual(Object.keys((await app.call('GET', '/api/envs/cp-comp/action-items/counts')).body), []);
  assert.equal((await app.call('DELETE', '/api/envs/cp-full')).status, 200);
  const n = (t: string) => app.ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()!.n as number;
  assert.equal(app.ctx.db.prepare("SELECT COUNT(*) AS n FROM action_items WHERE env = 'cp-full'").get()!.n, 0, 'deleting an environment deletes its items');
  assert.equal(app.ctx.db.prepare("SELECT COUNT(*) AS n FROM action_item_events WHERE item_id NOT IN (SELECT id FROM action_items)").get()!.n, 0, 'and its events');
  assert.ok(n('action_items') > 0);
});

test('MCP: list_action_items, add_action_item (source ai), update_action_item; errors are tool errors', async () => {
  const add = await app.mcp('add_action_item', { env: 'prod', service: 'api-gateway', ingress: 'in.createOrder', owner: 'Bot', description: 'by an agent', due: '2031-01-01', step, author: 'assistant' });
  assert.equal(add.isError, false, add.text);
  assert.deepEqual([add.json.source, add.json.status, add.json.step, add.json.createdBy], ['ai', 'open', step, 'assistant']);
  const upd = await app.mcp('update_action_item', { env: 'prod', id: add.json.id, author: 'assistant', status: 'done', due: null });
  assert.deepEqual([upd.json.status, upd.json.due, upd.json.source], ['done', null, 'ai']);
  const l = await app.mcp('list_action_items', { env: 'prod', service: 'api-gateway', ingress: 'in.createOrder' });
  assert.equal(l.json.count, (await list()).items.length);
  assert.ok(l.json.items.some((i: any) => i.id === add.json.id) && l.json.events.some((e: any) => e.kind === 'closed' && e.itemId === add.json.id));
  assert.equal((await app.mcp('add_action_item', { service: 'api-gateway', ingress: 'in.nope', owner: 'a', description: 'x', author: 'a' })).isError, true);
  assert.equal((await app.mcp('add_action_item', { env: 'prod', service: 'api-gateway', ingress: 'in.createOrder', owner: 'a', description: 'x', author: '' })).isError, true);
  assert.equal((await app.mcp('update_action_item', { env: 'prod', id: 99999, author: 'a' })).isError, true);
});

test('seed data: samples/action-items/prod.json loads once: 5 items, one overdue, one from a comment, one with a step', async () => {
  const cf = JSON.parse(readFileSync(join(SAMPLES, 'comments/prod.json'), 'utf8'));
  loadComments(app.ctx.db, app.ctx.graph(cf.env), cf.env, cf.comments);
  const f = JSON.parse(readFileSync(join(SAMPLES, 'action-items/prod.json'), 'utf8'));
  const sub = f.items.map((i: any) => ({ ...i, service: 'api-gateway', ingress: 'in.createOrder' }));
  const have = (await list()).items.length;
  assert.equal(loadActionItems(app.ctx.db, app.ctx.graph(f.env), f.env, sub), 5);
  assert.equal(loadActionItems(app.ctx.db, app.ctx.graph(f.env), f.env, sub), 0, 'seeding twice adds nothing');
  const l = await list();
  const seeded = l.items.slice(have);
  assert.deepEqual(seeded.map((i: any) => i.status).sort(), ['done', 'dropped', 'open', 'open', 'progress']);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(seeded.filter((i: any) => i.due && i.due < today && (i.status === 'open' || i.status === 'progress')).length, 1);
  assert.equal(seeded.filter((i: any) => i.commentId).length, 1);
  assert.equal(seeded.filter((i: any) => i.step).length, 1);
});
