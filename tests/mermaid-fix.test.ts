// Mermaid, the QA fix round (0.27.4): a linear parser, keyword-prefixed names, init blocks, export escapes, UNKNOWN_COMPONENT,
// entry reuse, the dryRun check on every MCP tool, and the undo line derived from the ops after a reload.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseMermaid } from '../core/mermaid-parse.ts';
import { exportMermaid } from '../core/mermaid-export.ts';
import { startDesign } from './helpers.ts';
// @ts-ignore plain JS module shared with the browser
import { batchText, latestBatch } from '../web/js/design/mermaid-pure.js';

test('parser is linear: a 200k-character line, and worst-case lines under the cap, parse in under 100 ms', () => {
  const t0 = performance.now();
  const huge = parseMermaid(`sequenceDiagram\nA${' '.repeat(50_000)}x\n${'A' + ' '.repeat(200_000) + 'x'}\nA->>B: ok`);
  assert.ok(performance.now() - t0 < 100, `took ${performance.now() - t0} ms`);
  assert.equal(huge.messages.length, 1);
  assert.equal(huge.warnings.filter((w) => /longer than 2000/.test(w.text)).length, 2);
  const t1 = performance.now();
  parseMermaid('sequenceDiagram\n' + Array.from({ length: 200 }, () => 'A' + ' -x'.repeat(600) + 'x').join('\n'));
  assert.ok(performance.now() - t1 < 100, `many near-misses took ${performance.now() - t1} ms`);
});

test('parser: names that start with a keyword are components; a keyword needs a space or the end of the line', () => {
  const p = parseMermaid(['sequenceDiagram', 'title_svc->>B: 1', 'link-svc->>B: 2', 'alt-svc->>B: 3', 'break-glass->>B: 4', 'loop->>B: 5', 'activate_svc->>B: 6', 'details-svc->>B: 7', 'Note over A,B: a->>b: kept as a note', 'title Real title', 'alt open', 'A->>B: inside', 'end'].join('\n'));
  assert.deepEqual(p.messages.map((m) => m.from), ['title_svc', 'link-svc', 'alt-svc', 'break-glass', 'loop', 'activate_svc', 'details-svc', 'A']);
  assert.equal(p.title, 'Real title'); assert.equal(p.notes.length, 1); assert.equal(p.messages[7].block, 'alt: open'); assert.equal(p.warnings.length, 0);
});

test('parser: a multi-line %%{ init }%% block is skipped cleanly', () => {
  const p = parseMermaid(['%%{', '  init: {', '    "theme": "dark"', '  }', '}%%', 'sequenceDiagram', '%%{init: {"a": 1}}%%', 'A->>B: x'].join('\n'));
  assert.equal(p.warnings.length, 0); assert.equal(p.messages.length, 1);
});

test('export: %% is an entity, an id that starts with a reserved word and an underscore is prefixed', () => {
  const t: any = { start: { service: 'a', ingress: 'in.x', fn: 'h', name: 'Cut %% here' }, participants: [{ id: 'svc:alt_gateway', label: 'alt_gateway', kind: 'service', service: 'alt_gateway' }, { id: 'svc:b', label: 'b', kind: 'service', service: 'b' }],
    messages: [{ from: 'svc:alt_gateway', to: 'svc:b', label: 'do 100%% of it', mode: 'sync', kind: 'call', depth: 0, note: 'x %% y' }] };
  const text = exportMermaid(t);
  assert.ok(!text.split('\n').slice(1).some((l) => l.includes('%%')), text);
  assert.match(text, /participant p_alt_gateway as alt_gateway/); assert.match(text, /title Cut %#37; here/);
  assert.equal(parseMermaid(text).title, 'Cut %% here');
});

test('the undo line after a reload comes from the latest batch in the ops', () => {
  const ops = [{ list: 'header', op: 'upsert', origin: { env: 'prod', version: 1 } }, { list: 'header', op: 'upsert', origin: { kind: 'mermaid', batch: 'aaaaaaaa' } },
    { list: 'header', op: 'upsert', origin: { kind: 'mermaid', batch: 'bbbbbbbb' } }, { list: 'fn', op: 'upsert', origin: { kind: 'mermaid', batch: 'bbbbbbbb' } }, { list: 'fn', op: 'upsert' }];
  assert.deepEqual(latestBatch(ops), { batch: 'bbbbbbbb', ops: 2, components: 1 });
  assert.equal(latestBatch([{ list: 'fn', op: 'upsert' }]), null);
  assert.match(batchText({ ops: 2, components: 1 }), /^Imported from Mermaid: 2 changes, 1 new component/);
});

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());
const open = async (name: string) => (await app.call('POST', '/api/envs/hld/drafts', { name })).body.slug as string;
const D = (slug: string) => `/api/envs/hld/drafts/${slug}`;
const ops = async (slug: string) => (await app.call('GET', D(slug))).body.ops as any[];

test('an unknown component in matches is 422 UNKNOWN_COMPONENT, in preview and import', async () => {
  const d = await open('mm-unknown');
  const text = 'sequenceDiagram\nactor Agent\nparticipant S as users-svc\nAgent->>S: GET /x';
  for (const path of [`${D(d)}/mermaid/preview`, `${D(d)}/mermaid`]) {
    const r = await app.call('POST', path, { text, matches: { S: 'no-such-svc' } });
    assert.deepEqual([r.status, r.body.error.code], [422, 'UNKNOWN_COMPONENT']);
  }
  assert.equal((await ops(d)).length, 0);
});

test('a flow that starts from a component: the same title reuses its entry, a new title makes one named after it', async () => {
  const d = await open('mm-entry');
  const imp = (title: string) => app.call('POST', `${D(d)}/mermaid`, { text: `sequenceDiagram\n${title ? `title ${title}\n` : ''}participant U as users-svc\nparticipant A as auth-svc\nU->>A: POST /verify` });
  assert.equal((await imp('')).body.flow.ingress, 'in.mermaid-flow');
  assert.equal((await imp('')).body.added, 0);
  assert.equal((await imp('Verify flow')).body.flow.ingress, 'in.verify-flow');
  assert.equal((await imp('Verify flow')).body.added, 0);
  const entries = (await ops(d)).filter((o) => o.anchor.startsWith('ing:users-svc/in.')).map((o) => o.anchor.split('/')[1]);
  assert.deepEqual([...new Set(entries)].sort(), ['in.mermaid-flow', 'in.verify-flow']);
});

test('MCP: a dryRun that is not a boolean is an invalid-params error, for every tool that takes dryRun', async () => {
  for (const name of ['import_mermaid', 'ingest_manifest', 'load_dtos', 'load_schemas', 'apply_import_plan', 'apply_draft']) {
    for (const dryRun of ['false', 0, 'true']) {
      const x = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { env: 'hld', draft: 'x', text: 'sequenceDiagram\nA->>B: x', dryRun } } });
      assert.equal(x.body.error?.code, -32602, `${name} ${JSON.stringify(dryRun)}`);
    }
  }
  const ok = await app.mcp('import_mermaid', { env: 'hld', draft: await open('mm-dry'), text: 'sequenceDiagram\nA->>B: x', dryRun: true });
  assert.ok(!ok.isError, ok.text);
});
