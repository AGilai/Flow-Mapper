// JSON Schema DTOs: detection and the flat field rows behind the field table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isJsonSchema, schemaRows } from '../core/json-schema.ts';

test('isJsonSchema tells schemas from example JSON', () => {
  assert.equal(isJsonSchema({ $schema: 'http://json-schema.org/draft-07/schema#' }), true);
  assert.equal(isJsonSchema({ type: 'object', properties: { a: { type: 'string' } } }), true);
  assert.equal(isJsonSchema({ type: 'OrderPlaced', orderId: 'o1', total: 3 }), false);
  assert.equal(isJsonSchema({ orderId: 'o1', properties: 'x' }), false);
  assert.equal(isJsonSchema([1, 2]), false);
  assert.equal(isJsonSchema(null), false);
});

test('rows: type, required, description, enum, format and nesting', () => {
  const rows = schemaRows({
    type: 'object', required: ['id', 'address'],
    properties: {
      id: { type: 'string', format: 'uuid', description: 'Order id' },
      status: { type: 'string', enum: ['open', 'closed'] },
      address: { type: 'object', required: ['zip'], properties: { zip: { type: 'string' }, line: { type: ['string', 'null'] } } },
      items: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' } } } },
      tags: { type: 'array', items: { type: 'string' } },
    },
  });
  assert.deepEqual(rows.map((r) => [r.path, r.type, r.required, r.depth]), [
    ['id', 'string', true, 0], ['status', 'string', false, 0], ['address', 'object', true, 0], ['address.zip', 'string', true, 1],
    ['address.line', 'string | null', false, 1], ['items', 'object[]', false, 0], ['items[].sku', 'string', false, 1], ['tags', 'string[]', false, 0],
  ]);
  assert.equal(rows[0].description, 'Order id');
  assert.equal(rows[0].format, 'uuid');
  assert.deepEqual(rows[1].enum, ['open', 'closed']);
});

test('$ref resolves from $defs and definitions, keeps the ref name, and stops on cycles', () => {
  const rows = schemaRows({
    type: 'object', required: ['tenant'],
    properties: { tenant: { $ref: '#/$defs/tenantId' }, owner: { $ref: '#/definitions/Person' }, node: { $ref: '#/$defs/Node' }, ext: { $ref: 'https://x/y.json' } },
    $defs: { tenantId: { type: 'string', description: 'Tenant', pattern: '^t' }, Node: { type: 'object', properties: { next: { $ref: '#/$defs/Node' } } } },
    definitions: { Person: { type: 'object', properties: { name: { type: 'string' } } } },
  });
  const by = Object.fromEntries(rows.map((r) => [r.path, r]));
  assert.deepEqual([by.tenant.type, by.tenant.ref, by.tenant.required, by.tenant.description], ['string', 'tenantId', true, 'Tenant']);
  assert.equal(by.owner.ref, 'Person');
  assert.equal(by['owner.name'].type, 'string');
  assert.equal(by['node.next'].ref, 'Node');
  assert.ok(!by['node.next.next'], 'a cyclic ref is not expanded forever');
  assert.deepEqual([by.ext.type, by.ext.ref], ['any', 'y.json'], 'an unresolvable ref still shows its name');
});

test('allOf merges, oneOf shows the alternatives', () => {
  const rows = schemaRows({
    type: 'object', allOf: [{ properties: { a: { type: 'string' } }, required: ['a'] }],
    properties: { b: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
  });
  assert.deepEqual(rows.map((r) => [r.path, r.type, r.required]), [['a', 'string', true], ['b', 'string | number', false]]);
});
