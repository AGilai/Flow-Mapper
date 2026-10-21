// core/flow-relations.ts and core/edit-relations.ts (0.28.2, #50): ids, symmetric ordering, aliases, the rules, the readings, the edit builder. Pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRelation, normType, phraseOf, REL_TYPES, relationCounts, relationItem, relationsOf, relId } from '../core/flow-relations.ts';
import { dependentRelationOps, relationOps } from '../core/edit-relations.ts';
import { EditError } from '../core/edit-kit.ts';
import type { ItemRow } from '../core/item-rows.ts';

const ing = (service: string, id: string, extra: any = {}): ItemRow => ({ service, list: 'ingress', key: id, data: { id, transport: 'http', bindKey: `http:GET ${service}/${id}`, handler: 'h', ...extra } });
const rows = [ing('a', 'i'), ing('b', 'j'), ing('c', 'k'), ing('c', 'hidden', { entryPoint: false })];
const A = 'flow:a/i', B = 'flow:b/j', C = 'flow:c/k';
const rel = (r: any) => { const it = relationItem(r)!; return { service: '', list: 'flowrel', key: it.id, data: it.data } as ItemRow; };

test('the id is deterministic and depends on the ends and the type; a symmetric type is stored with from < to, a directional one as given', () => {
  assert.equal(relId(A, B, 'supersedes'), relId(A, B, 'supersedes'));
  assert.notEqual(relId(A, B, 'supersedes'), relId(B, A, 'supersedes'));
  assert.notEqual(relId(A, B, 'supersedes'), relId(A, B, 'variant-of'));
  assert.match(relId(A, B, 'supersedes'), /^r[0-9a-z]+$/);
  assert.deepEqual([relationItem({ from: B, to: A, type: 'contradicts' })!.data.from, relationItem({ from: B, to: A, type: 'same-topic' })!.data.from], [A, A]);
  assert.equal(relationItem({ from: B, to: A, type: 'contradicts' })!.id, relationItem({ from: A, to: B, type: 'contradicts' })!.id);
  assert.deepEqual([relationItem({ from: B, to: A, type: 'supersedes' })!.data.from, relationItem({ from: B, to: A, type: 'variant-of' })!.data.from], [B, B]);
});

test('aliases for plans: variant, variant_of, same_topic; an unknown type or end is null; ends may be {service, ingress}; the note is trimmed', () => {
  assert.deepEqual(['variant', 'variant_of', 'same_topic', 'supersedes', 'rhymes', 3].map(normType), ['variant-of', 'variant-of', 'same-topic', 'supersedes', null, null]);
  assert.equal(relationItem({ from: A, to: B, type: 'rhymes' }), null);
  assert.equal(relationItem({ from: 'svc:a', to: B, type: 'supersedes' }), null);
  assert.deepEqual(relationItem({ from: { service: 'a', ingress: 'i' }, to: B, type: 'variant', note: '  n ' })!.data, { from: A, to: B, type: 'variant-of', note: 'n' });
  assert.equal('note' in relationItem({ from: A, to: B, type: 'variant', note: '  ' })!.data, false);
});

test('checkRelation: BAD_TYPE, NO_FLOW (not a flow, missing, entryPoint false), SAME_FLOW, note length, BAD_ID; fine otherwise', () => {
  const ok = relationItem({ from: A, to: B, type: 'supersedes' })!;
  assert.deepEqual(checkRelation(ok.id, ok.data, rows), []);
  const code = (data: any, id = ok.id) => checkRelation(id, data, rows).map((i) => `${i.code}:${i.field ?? ''}`);
  assert.deepEqual(code({ ...ok.data, type: 'rhymes' }), ['BAD_TYPE:type']);
  assert.deepEqual(code({ ...ok.data, to: 'svc:b' }), ['NO_FLOW:to']);
  assert.deepEqual(code({ ...ok.data, to: 'flow:b/nope' }), ['NO_FLOW:to']);
  assert.deepEqual(code({ ...ok.data, to: 'flow:c/hidden' }), ['NO_FLOW:to']);
  assert.deepEqual(code({ ...ok.data, to: A }), ['SAME_FLOW:to']);
  assert.deepEqual(code({ ...ok.data, note: 'x'.repeat(1001) }), ['INVALID:note']);
  assert.deepEqual(code(ok.data, 'rwrong'), ['BAD_ID:']);
});

test('relationsOf: both ends see a relation with the phrase of their end; none given = all, read from the from end; the type filters; sorted by type then flow', () => {
  const rs = [rel({ from: A, to: B, type: 'supersedes' }), rel({ from: C, to: A, type: 'variant-of' }), rel({ from: B, to: A, type: 'contradicts', note: 'n' }), rows[0]];
  const a = relationsOf(rs, { service: 'a', ingress: 'i' });
  assert.deepEqual(a.map((v) => [v.type, v.direction, v.phrase, `${v.other.service}/${v.other.ingress}`]), [
    ['contradicts', 'out', 'contradicts', 'b/j'], ['variant-of', 'in', 'has a variant', 'c/k'], ['supersedes', 'out', 'supersedes', 'b/j']].sort((x, y) => REL_TYPES.indexOf(x[0] as any) - REL_TYPES.indexOf(y[0] as any)));
  assert.deepEqual(relationsOf(rs, { service: 'b', ingress: 'j' }).map((v) => [v.type, v.phrase]), [['contradicts', 'contradicts'], ['supersedes', 'is superseded by']]);
  assert.equal(relationsOf(rs).length, 3);
  assert.deepEqual(relationsOf(rs, null, 'variant-of').map((v) => v.id), [rs[1].key]);
  assert.deepEqual(relationsOf(rs, { service: 'c', ingress: 'k' }).map((v) => v.phrase), ['is a variant of']);
  assert.equal(phraseOf('same-topic', 'in'), 'same topic as');
  assert.equal(relationsOf(rs, { service: 'a', ingress: 'i' })[0].note, 'n');
});

test('relationCounts: per flow and type, for the Flows list', () => {
  const m = relationCounts([rel({ from: A, to: B, type: 'supersedes' }), rel({ from: A, to: C, type: 'supersedes' }), rel({ from: B, to: C, type: 'contradicts' })]);
  assert.deepEqual(m.get('a/i'), { supersedes: 2 }); assert.deepEqual(m.get('c/k'), { supersedes: 1, contradicts: 1 });
});

test('relationOps: one upsert; an edit with a new type or end also deletes the old row; errors carry code and field; dependents of a component or an endpoint', () => {
  const e = { kind: 'flow-relation' as const, from: { service: 'a', ingress: 'i' }, to: { service: 'b', ingress: 'j' }, type: 'supersedes', note: 'n' };
  const ops = relationOps(e, rows);
  assert.deepEqual(ops.map((o) => [o.op, o.anchor.slice(0, 4)]), [['upsert', 'rel:']]);
  const have = [...rows, { service: '', list: 'flowrel', key: ops[0].anchor.slice(4), data: ops[0].data } as ItemRow];
  const moved = relationOps({ ...e, id: ops[0].anchor.slice(4), type: 'variant-of' }, have);
  assert.deepEqual(moved.map((o) => o.op), ['upsert', 'delete']);
  assert.equal(relationOps({ ...e, id: ops[0].anchor.slice(4), note: 'other' }, have).length, 1, 'the same id: the note only');
  assert.throws(() => relationOps({ ...e, id: 'rgone', type: 'variant-of' }, rows), (x: any) => x instanceof EditError && x.code === 'NO_ITEM');
  assert.throws(() => relationOps({ ...e, type: 'x' }, rows), (x: any) => x.code === 'BAD_TYPE' && x.field === 'type');
  assert.throws(() => relationOps({ ...e, to: e.from }, rows), (x: any) => x.code === 'SAME_FLOW' && x.field === 'to');
  assert.throws(() => relationOps({ ...e, to: { service: 'b' } as any }, rows), (x: any) => x.code === 'NO_FLOW' && x.field === 'to');
  const rs = [...have, rel({ from: B, to: C, type: 'contradicts' })];
  assert.equal(dependentRelationOps(rs, 'b').length, 2); assert.equal(dependentRelationOps(rs, 'b', 'j').length, 2); assert.equal(dependentRelationOps(rs, 'a', 'x').length, 0); assert.equal(dependentRelationOps(rs, 'c').length, 1);
});
