// 0.50.0 (#104): a channel column (topic, queue, exchange) goes into the band of the component that declares it (core/channel-owner.ts, flow-bands.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-ignore plain JS modules shared with the browser
import { groupColumns, subBands, subSubBands } from '../web/js/views/flow-bands.js';
import { channelOwner } from '../core/channel-owner.ts';
import { buildIndex } from '../core/graph-index.ts';
import { health } from '../core/health.ts';
import { sampleModel } from './helpers.ts';

const svc = (service: string) => ({ id: `svc:${service}`, kind: 'service', service, label: service });
const chan = (id: string, owner: string | null = null) => ({ id: `ch:${id}`, kind: 'channel', label: id, owner });
const names = (cols: any[]) => cols.map((c) => c.service ?? c.id);
const SUB: Record<string, string> = { gcp: 'platform', sdp: 'platform', cons: 'platform', web: 'edge' };
const SUB2: Record<string, string> = { gcp: 'platform/gcp', sdp: 'platform/sdp', cons: 'platform/sdp' };
const subOf = (s: string) => SUB[s] ?? '', sub2Of = (s: string) => SUB2[s] ?? '';
const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('channelOwner: a non-infra declarer is preferred, an infra component owns what only infra declares, nobody: none', () => {
  const g: any = { services: new Map([['gcp', { kind: 'service' }], ['sdp', { kind: 'service' }], ['plat', { kind: 'infra' }]]), model: { channels: [
    { service: 'plat', bindKey: 'sns:a' }, { service: 'gcp', bindKey: 'sns:a' }, { service: 'sdp', bindKey: 'sns:a' }, { service: 'plat', bindKey: 'sqs:shared' }, { service: 'sdp', bindKey: 'sqs:q' }] } };
  assert.equal(channelOwner(g, 'sns:a'), 'gcp', 'non-infra first, in model order');
  assert.equal(channelOwner(g, 'sqs:shared'), 'plat', 'an infra component that declares a shared topic IS its owner');
  assert.equal(channelOwner(g, 'sqs:q'), 'sdp');
  assert.equal(channelOwner(g, 'sqs:nobody'), undefined);
});

test('link health: channels without an owner list who publishes and who consumes, are counted, and the totals agree', () => {
  const g = buildIndex(sampleModel()), h = health(g), x = h.items.channelsWithoutOwner;
  assert.deepEqual(x.find((c) => c.channel === 'sns:audit-events'), { channel: 'sns:audit-events', publishers: ['audit-publisher'], consumers: [] });
  assert.deepEqual(x.find((c) => c.channel === 'sqs:audit-inbox'), { channel: 'sqs:audit-inbox', publishers: [], consumers: ['audit-publisher'] });
  assert.ok(!x.some((c) => c.channel === 'sqs:orders-to-ship' || c.channel === 'sns:catalog-product-events'), 'a declared channel (by a component or by infra) is never listed');
  assert.equal(h.totals.channelsWithoutOwner, x.length);
});

test('groupColumns: an owned channel goes right after its owner, inside its subsystem and sub-subsystem band; an unowned one keeps its place', () => {
  const cols = [svc('web'), chan('sns:t', 'gcp'), svc('sdp'), chan('sqs:q', 'sdp'), svc('gcp'), chan('sqs:free')];
  const out = groupColumns(cols, subOf, sub2Of);
  assert.deepEqual(names(out), ['web', 'sdp', 'ch:sqs:q', 'gcp', 'ch:sns:t', 'ch:sqs:free']);
  assert.deepEqual(subBands(out, new Set(), subOf).map((b: any) => [b.key, b.from, b.to]), [['edge', 0, 0], ['platform', 1, 4]], 'the channels join the Platform run, the free one is outside');
  assert.deepEqual(subSubBands(out, new Set(), sub2Of).map((b: any) => [b.key, b.from, b.to]), [['platform/sdp', 1, 2], ['platform/gcp', 3, 4]]);
});

test('groupColumns: a channel whose owner is not in the flow follows its subsystem; one whose owner has no subsystem stays', () => {
  const out = groupColumns([svc('web'), svc('sdp'), svc('gcp'), chan('sqs:x', 'cons'), chan('sqs:y', 'loose')], subOf, sub2Of);
  assert.deepEqual(names(out), ['web', 'sdp', 'gcp', 'ch:sqs:x', 'ch:sqs:y']);
  assert.deepEqual(subBands(out, new Set(), subOf).map((b: any) => [b.key, b.from, b.to]), [['edge', 0, 0], ['platform', 1, 3]]);
});

test('source: the lane gives a channel column its owner, the trace participant carries it', () => {
  assert.match(src('../web/js/views/flow-lane.js'), /owner: ownerOf\(key\)/);
  assert.match(src('../core/trace.ts'), /channelOwner\(g, key\)/);
});

test('source: a channel head with no owner says so (muted), in a design with "yet"; link health has the tab', () => {
  const heads = src('../web/js/views/flow-draw-heads.js');
  assert.match(heads, /isCh\(c\) && !c\.owner && !c\.fan/);
  assert.match(heads, /'no owner yet' : 'no owner'/);
  assert.match(src('../web/js/views/health.js'), /id: 'channelsWithoutOwner'/);
});
