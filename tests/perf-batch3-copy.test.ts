// Perf batch 3, F7: the set-wise Full copy of comments and action items against the per-row copy it replaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tx } from '../server/db/connection.ts';
import { syncMentions, markSeen } from '../server/store/mentions.ts';
import { copyComments } from '../server/store/comments.ts';
import { copyActionItems } from '../server/store/action-items-io.ts';
import { startDesign } from './helpers.ts';

function oldCopyComments(db: any, from: string, to: string): Map<number, number> {
  const ids = new Map<number, number>();
  const ins = db.prepare('INSERT INTO comments (env, anchor, step, parent_id, author, author_id, body, created_at, edited_at, deleted_at, external_id, external_source, author_external_id, resolved_at, resolved_by, steps_from, steps_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  tx(db, () => { for (const r of db.prepare('SELECT * FROM comments WHERE env = ? ORDER BY id').all(from) as any[]) {
    const nid = Number(ins.run(to, r.anchor, r.step, r.parent_id == null ? null : ids.get(r.parent_id) ?? null, r.author, r.author_id, r.body, r.created_at, r.edited_at, r.deleted_at, r.external_id, r.external_source, r.author_external_id, r.resolved_at, r.resolved_by, r.steps_from, r.steps_to).lastInsertRowid);
    ids.set(r.id, nid);
    if (!r.deleted_at) { syncMentions(db, nid, r.body, r.author_id); for (const u of (db.prepare('SELECT user_id FROM comment_mentions WHERE comment_id = ?').all(nid) as any[])) markSeen(db, u.user_id, [nid]); }
  } });
  return ids;
}
function oldCopyItems(db: any, from: string, to: string, commentIds: Map<number, number>) {
  const ins = db.prepare('INSERT INTO action_items (env, anchor, number, owner, owner_id, created_by_id, description, status, due, step, comment_id, source, created_by, updated_by, created_at, updated_at, closed_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const evs = db.prepare('SELECT kind, actor, at FROM action_item_events WHERE item_id = ? ORDER BY id'), insEv = db.prepare('INSERT INTO action_item_events (item_id, kind, actor, at) VALUES (?, ?, ?, ?)');
  tx(db, () => { for (const r of db.prepare('SELECT * FROM action_items WHERE env = ? ORDER BY id').all(from) as any[]) {
    const id = Number(ins.run(to, r.anchor, r.number, r.owner, r.owner_id, r.created_by_id, r.description, r.status, r.due, r.step, r.comment_id == null ? null : commentIds.get(r.comment_id) ?? null, r.source, r.created_by, r.updated_by, r.created_at, r.updated_at, r.closed_at, r.deleted_at).lastInsertRowid);
    for (const e of evs.all(r.id) as any[]) insEv.run(id, e.kind, e.actor, e.at);
  } });
}
const dump = (db: any, env: string) => {
  const cs = db.prepare('SELECT * FROM comments WHERE env = ? ORDER BY rowid').all(env) as any[], rank = new Map(cs.map((c, i) => [c.id, i]));
  const items = db.prepare('SELECT * FROM action_items WHERE env = ? ORDER BY rowid').all(env) as any[], irank = new Map(items.map((c, i) => [c.id, i]));
  return {
    comments: cs.map((c) => ({ ...c, id: rank.get(c.id), env: 0, parent_id: c.parent_id == null ? null : rank.get(c.parent_id) })),
    mentions: cs.flatMap((c) => (db.prepare('SELECT user_id FROM comment_mentions WHERE comment_id = ? ORDER BY rowid').all(c.id) as any[]).map((m) => [rank.get(c.id), m.user_id])),
    seen: cs.flatMap((c) => (db.prepare('SELECT user_id FROM mention_seen WHERE comment_id = ? ORDER BY rowid').all(c.id) as any[]).map((m) => [rank.get(c.id), m.user_id])),
    items: items.map((c) => ({ ...c, id: irank.get(c.id), env: 0, comment_id: c.comment_id == null ? null : rank.get(c.comment_id) ?? 'gone' })),
    events: items.flatMap((c) => (db.prepare('SELECT kind, actor, at FROM action_item_events WHERE item_id = ? ORDER BY id').all(c.id) as any[]).map((e) => ({ ...e, item: irank.get(c.id), at: 0 }))),
  };
};

test('F7: copyComments / copyActionItems write the same rows and the same id remapping as the per-row copy', async () => {
  const app = await startDesign();
  try {
    const A = 'flow:api-gateway/in.createOrder', db = app.ctx.db as any;
    const post = (b: object, anchor = A) => app.call('POST', '/api/envs/prod/comments', { anchor, author: 'Ana', body: '<p>x</p>', ...b });
    const c1 = (await post({ body: '<p>hi @{Zed} and @{Amy} and @{Ana}</p>' })).body;
    await post({ body: '<p>reply @{Zed}</p>', parentId: c1.id, author: 'Zed' });
    const c3 = (await post({ body: '<p>to delete @{Amy}</p>' })).body;
    await app.call('DELETE', `/api/envs/prod/comments/${c3.id}?author=Ana`);
    const c4 = (await post({ body: '<p>@{Bob} @{Zed} @{Amy}</p>', author: 'Bob' })).body;
    const bob = db.prepare("SELECT id FROM users WHERE name = 'Bob'").get().id, amy = db.prepare("SELECT id FROM users WHERE name = 'Amy'").get().id;
    assert.equal((await app.call('POST', `/api/users/${bob}/merge`, { into: amy })).status, 200); // a merged id inside a body resolves to the user it went into
    await post({ body: '<p>plain</p>' }, 'flow:api-gateway/in.getOrder');
    for (const k of [null, c1.id, c4.id]) {
      const r = await app.call('POST', '/api/envs/prod/action-items', { anchor: A, actor: 'Ana', owner: 'Ben', description: 'item ' + k, commentId: k });
      assert.ok(r.status < 300, JSON.stringify(r.body));
      if (k === c1.id) assert.ok((await app.call('PATCH', `/api/envs/prod/action-items/${r.body.id}`, { actor: 'Ben', status: 'done' })).status < 300);
    }
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM comment_mentions').get().n >= 5, 'the fixture has mentions');
    const idsOld = oldCopyComments(db, 'prod', 'ref7'), idsNew = copyComments(db, 'prod', 'new7');
    oldCopyItems(db, 'prod', 'ref7', idsOld); copyActionItems(db, 'prod', 'new7', idsNew);
    const a = dump(db, 'ref7'), b = dump(db, 'new7');
    assert.ok(a.comments.length >= 5 && a.items.length === 3 && a.events.length >= 4 && a.seen.length >= 3);
    assert.deepEqual(b.comments, a.comments);
    assert.deepEqual(b.mentions, a.mentions);
    assert.deepEqual(b.seen, a.seen);
    assert.deepEqual(b.items, a.items);
    assert.deepEqual(b.events, a.events);
    const rel = (m: Map<number, number>) => { const base = [...m.values()][0]; return [...m.entries()].map(([k, v]) => [k, v - base]); };
    assert.deepEqual(rel(idsNew), rel(idsOld));
  } finally { await app.close(); }
});
