// Fix #83: a branch that holds only a return keeps its branch, nothing after `end` belongs to the group, and a return sits right after the call it answers.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign } from './helpers.ts';

const SRC = ['sequenceDiagram', 'A->>B: do work', 'alt ok', '  B->>A: GET /x', '  A-->>B: x-data', 'else fail', '  B-->>A: 403 denied', 'end', 'A-)B: notify later', 'A->>U: after async', 'Note over A,B: ...', 'B-->>A: work done'].join('\n');
const CLIENTS = {};
let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => {
  app = await startDesign();
  for (const name of ['r83-a', 'r83-b', 'r83-c']) assert.equal((await app.call('POST', '/api/envs', { name, source: 'prod', mode: 'blank', groups: [{ key: 'platform', label: 'Platform' }] })).status, 201);
});
after(() => app.close());

const run = async (env: string, text: string, matches: any = CLIENTS) => {
  const slug = (await app.call('POST', `/api/envs/${env}/drafts`, { name: 'r83' })).body.slug as string;
  const r = await app.call('POST', `/api/envs/${env}/drafts/${slug}/mermaid`, { text, groupPath: 'platform', matches });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const f = r.body.flow, q = `service=${f.service}&ingress=${f.ingress}&draft=${slug}`;
  const exp = (await app.call('GET', `/api/envs/${env}/flows/mermaid?${q}`)).body as string;
  const trace = (await app.call('GET', `/api/envs/${env}/trace?detail=full&choose=*:both&${q}`)).body;
  const dflt = (await app.call('GET', `/api/envs/${env}/trace?detail=full&${q}`)).body;
  return { exp, trace, dflt, r };
};
const body = (t: string) => t.split('\n').filter((l) => !/^(%%|participant|actor|sequenceDiagram|title)/.test(l));

test('#83: a return-only branch keeps its else; later steps stay outside the group; returns follow their call', async () => {
  const a = await run('r83-a', SRC);
  if (process.env.SHOW) console.log(a.exp);
  const lines = body(a.exp);
  const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
  assert.ok(at(/^alt /) >= 0 && at(/^else /) > at(/^alt /), a.exp);
  assert.ok(at(/^else /) < at(/403 denied/), 'the return is written inside else');
  assert.equal(lines.filter((l) => l === 'end').length, lines.filter((l) => /^alt /.test(l)).length);
  const end = at(/^end$/);
  assert.ok(end > at(/403 denied/) && end < at(/notify later/), 'the group closes before the later steps');
  for (const re of [/notify later/, /after async/, /Note over \S+,\S+: \.\.\./]) assert.ok(at(re) > end, `${re} is after end`);
  // not inside the alt in the trace either
  const later = a.trace.messages.filter((m: any) => /notify later|after async|\.\.\./.test(m.label + (m.note ?? '')));
  assert.ok(later.length >= 2 && later.every((m: any) => !m.alt), JSON.stringify(later.map((m: any) => [m.label, m.alt])));
  // the decision keeps both arms
  const dec = a.trace.decisions.find((d: any) => d.from === 'alt');
  assert.deepEqual(dec.arms.map((x: any) => x.label), ['ok', 'fail']);
  assert.ok(a.trace.messages.some((m: any) => m.kind === 'leaf' && m.label === '403 denied' && m.alt?.condition === 'fail'));
  assert.ok(!a.dflt.messages.some((m: any) => m.label === '403 denied'), 'the default view is the first arm');
  // import the export again: the same model, the same text
  const b = await run('r83-b', a.exp);
  const norm = (t: string) => t.replace(/tbd-a-mermaid-flow/g, 'mermaid-flow');   // the entry endpoint is named after the diagram's title, the export has none
  assert.equal(norm(b.exp), norm(a.exp));
  const shape = (ms: any[]) => ms.map((m) => [m.kind, norm(m.label), m.returns?.label ?? '', m.alt ? `${m.alt.condition}/${m.alt.branch}` : '']);
  assert.deepEqual(shape(b.trace.messages), shape(a.trace.messages));
});

test('#83: a return is written right after the call it answers, not after later steps', async () => {
  const src = ['sequenceDiagram', 'A->>B: do work', 'B->>C: GET /y', 'C-->>B: y-data', 'B->>C: GET /z', 'C-->>B: z-data', 'B-->>A: work done'].join('\n');
  const a = await run('r83-c', src, {});
  const lines = body(a.exp);
  const i = (re: RegExp) => lines.findIndex((l) => re.test(l));
  assert.equal(i(/c-->>b: y-data/), i(/->>c: GET \/y/) + 1, a.exp);
  assert.equal(i(/c-->>b: z-data/), i(/->>c: GET \/z/) + 1, a.exp);
  assert.ok(i(/b-->>a: work done/) > i(/z-data/));
});

test('#83: the demo file samples/mermaid/return-branch.mmd imports without warnings, with both arms', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(new URL('../samples/mermaid/return-branch.mmd', import.meta.url), 'utf8');
  const a = await run('r83-c', text);
  if (process.env.SHOW) console.log(a.r.body.flow);
  assert.deepEqual(a.r.body.warnings ?? [], []);
  assert.deepEqual(a.trace.decisions.find((d: any) => d.from === 'alt').arms.map((x: any) => x.label), ['ok', 'fail']);
  assert.match(a.exp, /^else fail\nb-->>a: 403 denied\nend$/m);
});
