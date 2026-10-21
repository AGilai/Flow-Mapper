// Mermaid UI, the logic with no DOM (0.27.2): the selects of the matching table, the amber bar, the chips, the preview tiles and warnings;
// the export file name; the sample file the demos import.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-ignore plain JS modules shared with the browser
import { afterText, barText, chipOf, choiceOf, copiedNames, createdNames, hintOf, optionsFor, previewWarnings, tiles, valueOf } from '../web/js/design/mermaid-pure.js';
// @ts-ignore
import { fileName } from '../web/js/design/mermaid-export.js';
import { parseMermaid } from '../core/mermaid-parse.ts';
import { matchParticipants } from '../core/mermaid-match.ts';

const row = (o: any) => ({ id: 'X', label: 'X', actor: false, match: null, how: 'none', candidates: [], createName: 'x', ...o });

test('select options: an actor can be the client, a source-only name can be copied, infra can be skipped; values map to choices and back', () => {
  const vals = (r: any) => optionsFor(r, ['a', 'b'], 'prod').map((o: any) => o.value);
  assert.deepEqual(vals(row({})), ['new', 'c:a', 'c:b']);
  assert.deepEqual(vals(row({ actor: true, how: 'actor' })), ['client', 'new', 'c:a', 'c:b']);
  assert.deepEqual(vals(row({ how: 'in-prod', source: 'orders-svc' })), ['new', 'src', 'c:a', 'c:b']);
  assert.deepEqual(vals(row({ how: 'infra' })), ['skip', 'new', 'c:a', 'c:b']);
  const r = row({ createName: 'policy-engine' });
  for (const c of [{ component: 'a' }, { create: true, name: 'policy-engine' }, { fromSource: true }, { client: true }, { skip: true }]) assert.deepEqual(choiceOf(valueOf(c), r), c);
});

test('the amber bar counts what is created, never what exists or is copied; wording of chips and hints', () => {
  const rows = [row({ id: 'A', createName: 'a-new' }), row({ id: 'B', createName: 'b-new' }), row({ id: 'C', createName: 'exists' }), row({ id: 'D', source: 'orders-svc', how: 'in-prod', createName: 'orders-svc' })];
  const choices: any = { A: { create: true, name: 'a-new' }, B: { create: true, name: 'b-new' }, C: { create: true, name: 'exists' }, D: { fromSource: true } };
  assert.deepEqual(createdNames(rows, choices, ['exists']), ['a-new', 'b-new']);
  assert.deepEqual(copiedNames(rows, choices), ['orders-svc']);
  assert.equal(barText(['a-new', 'b-new'], 'Platform'), '2 components will be created: a-new, b-new in Platform');
  assert.equal(barText([], ''), null); assert.equal(barText(['x'], ''), '1 component will be created: x');
  assert.deepEqual(chipOf(row({ how: 'alias' }), null), ['exact', 'exact']); assert.deepEqual(chipOf(row({ how: 'in-prod' }), null), ['in prod', 'prod']);
  assert.deepEqual(chipOf(row({ how: 'exact', match: 'a' }), { component: 'b' }), ['changed', 'norm']);
  assert.match(hintOf(row({ how: 'in-prod' }), { create: true }, 'prod') ?? '', /import it from prod/);
  assert.equal(hintOf(row({ how: 'similar', match: 'a', note: 'check it' }), { component: 'a' }, 'prod'), 'check it');
});

test('preview: tiles and warnings from the server shape', () => {
  const p = { counts: { components: 2, endpoints: 3, calls: 5, notes: 4, reused: 0 }, flow: { name: 'Agent' }, imports: [], creates: ['a', 'b'], undecided: ['Evaluate'], warnings: [{ line: 12, text: 'rect ignored' }] };
  assert.deepEqual(tiles(p), [['+2', 'components'], ['+3', 'endpoints'], ['+5', 'calls'], ['4', 'step descriptions'], ['Flow name', "'Agent'"]]);
  const w = previewWarnings(p, [row({ id: 'S', label: 'AuthSvc', how: 'similar', match: 'auth-svc' })], { S: { component: 'auth-svc' } }, 'Platform').map((x: any) => x.text);
  assert.deepEqual(w, ['rect ignored', 'a and b are new components in Platform, with no endpoints known beyond the calls below.', '1 message Evaluate has no METHOD /path: its endpoint is created as undecided.', 'AuthSvc was matched to auth-svc by close spelling.']);
  assert.match(afterText({ counts: { calls: 6, components: 3, notes: 3 }, undecided: ['x'] }, 'Platform'), /^Imported from Mermaid: 6 calls, 3 new components in Platform, 3 step descriptions\. Undecided/);
});

test('the export file is named after the flow', () => {
  assert.equal(fileName('Agent connects to POP'), 'agent-connects-to-pop.mmd'); assert.equal(fileName(''), 'flow.mmd'); assert.equal(fileName('in.tunnel.open'), 'in-tunnel-open.mmd');
});

test('the demo sample parses with one warning (the rect block) and matches the way DEMOS.md says', () => {
  const p = parseMermaid(readFileSync(join(import.meta.dirname, '../samples/mermaid/agent-tunnel.mmd'), 'utf8'));
  assert.deepEqual(p.warnings.map((w) => w.line), [17]);
  assert.equal(p.title, 'Agent opens a tunnel (from Mermaid)'); assert.match(p.description ?? '', /nearest POP/);
  const m = matchParticipants(p.participants, ['pop-edge', 'auth-svc', 'users-svc', 'cp-middleware', 'sase-agent'], ['audit-log-svc', 'pop-edge']);
  assert.deepEqual(m.map((r) => r.how), ['actor', 'alias', 'normalized', 'normalized', 'similar', 'none', 'none', 'in-prod']);
});
