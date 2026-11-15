import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GROUPS, renderMcpTools } from '../scripts/gen-mcp-tools.ts';
import { TOOLS } from '../server/mcp/tools.ts';
import { startDesign } from './helpers.ts';

test('docs/MCP-TOOLS.md is current (run npm run docs:mcp)', () => {
  assert.equal(readFileSync(new URL('../docs/MCP-TOOLS.md', import.meta.url), 'utf8'), renderMcpTools());
});

test('every registered tool is in exactly one catalogue group', () => {
  const listed = GROUPS.flatMap(([, n]) => n);
  assert.deepEqual([...listed].sort(), TOOLS.map((t) => t.name).sort());
});

test('a tool that takes env errors without it and lists the readable envs (no default)', async () => {
  const app = await startDesign();
  try {
    for (const t of TOOLS.filter((x) => (x.inputSchema as any).required.includes('env'))) {
      const r = await app.mcp(t.name, {});
      assert.equal(r.isError, true, t.name);
      assert.match(r.text, /env is required.*\(.*prod/s, t.name);
    }
    assert.equal((await app.mcp('list_services', { env: 'prod' })).isError, false);
  } finally { await app.close(); }
});

test('the worked example of docs/DESIGN-FROM-SCRATCH.md replays: create, draft, edit, apply, export', async () => {
  const app = await startDesign();
  try {
    const ops = JSON.parse(readFileSync(new URL('../docs/examples/orders-demo-ops.json', import.meta.url), 'utf8'));
    const groups = [{ key: 'storefront', label: 'Storefront' }, { key: 'fulfillment', label: 'Fulfillment' }];
    assert.equal((await app.mcp('create_env', { name: 'orders-demo', mode: 'blank', groups })).isError, false);
    assert.equal((await app.mcp('open_draft', { env: 'orders-demo', name: 'First design', slug: 'first' })).isError, false);
    const e = await app.mcp('edit_in_draft', { env: 'orders-demo', draft: 'first', ops });
    assert.equal(e.isError, false, e.text);
    const flow = { env: 'orders-demo', service: 'orders-svc', ingress: 'in.createOrder' };
    assert.match((await app.mcp('export_mermaid', { ...flow, draft: 'first' })).text, /POST \/reserve/);
    assert.equal((await app.mcp('apply_draft', { env: 'orders-demo', draft: 'first', dryRun: true })).json.applied, false);
    assert.equal((await app.mcp('apply_draft', { env: 'orders-demo', draft: 'first' })).json.applied, true);
    assert.equal((await app.mcp('list_entry_points', { env: 'orders-demo' })).json[0].id, 'in.createOrder');
  } finally { await app.close(); }
});
