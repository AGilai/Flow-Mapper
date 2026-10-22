// The fuller Mermaid import (0.33.1, #71): every construct of samples/mermaid/hld-full.mmd read into a blank design (steps, nested groups,
// spanning notes, changed marks, `%% real:`, flow name and links), written back by the export, and the round trip import -> export -> import -> export.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMermaid } from '../core/mermaid-parse.ts';
import { startDesign } from './helpers.ts';

const SAMPLE = readFileSync(join(import.meta.dirname, '../samples/mermaid/hld-full.mmd'), 'utf8');
let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => {
  app = await startDesign();
  for (const name of ['blank-a', 'blank-b', 'blank-c']) assert.equal((await app.call('POST', '/api/envs', { name, source: 'prod', mode: 'blank', groups: [{ key: 'platform', label: 'Platform' }] })).status, 201);
});
after(() => app.close());

const draft = async (env: string) => (await app.call('POST', `/api/envs/${env}/drafts`, { name: 'full' })).body.slug as string;
const imp = (env: string, slug: string, text: string, path = '/mermaid') => app.call('POST', `/api/envs/${env}/drafts/${slug}${path}`, { text, groupPath: 'platform' });
const exp = async (env: string, slug: string, f: { service: string; ingress: string }) => (await app.call('GET', `/api/envs/${env}/flows/mermaid?service=${f.service}&ingress=${f.ingress}&draft=${slug}`)).body as string;
const traceOf = async (env: string, slug: string, f: { service: string; ingress: string }) => (await app.call('GET', `/api/envs/${env}/trace?service=${f.service}&ingress=${f.ingress}&draft=${slug}`)).body;

test('parser: the sample gives frames, marks, notes, returns, links and directives', () => {
  const p = parseMermaid(SAMPLE);
  assert.deepEqual(p.warnings, []);
  assert.equal(p.flow, 'Device onboarding and first sync (from Confluence)'); assert.equal(p.title, 'Device onboarding');
  assert.deepEqual(p.links.map((l) => l.label), ['Confluence page', 'Threat model']);
  assert.match(p.description ?? '', /enrols, gets a certificate/);
  const by = (label: string) => p.messages.find((m) => m.label.includes(label))!;
  assert.equal(by('register the device').real, 'http:POST device-registry/v2/devices');      // the line before
  assert.equal(by('fetch the first policy').real, 'http:GET policy-engine/policies/{tenantId}/default');   // the end of the line
  assert.equal(by('register the device').response, 'existing device');
  assert.equal(by('fetch the first policy').mark, 'changed'); assert.equal(by('sign policy bundle').mark, 'changed'); assert.equal(by('register the device').mark, undefined);
  assert.deepEqual(by('check the revocation list').groups?.map((g) => [g.kind, g.condition]), [['loop', 'for each pending sync batch'], ['opt', 'batch is not empty'], ['par', 'verify the batch'], ['critical', 'certificate is valid']]);
  assert.deepEqual(by('revoked certificate used').groups?.at(-1), { id: by('check the revocation list').groups!.at(-1)!.id, kind: 'critical', condition: 'certificate is revoked' });
  assert.deepEqual(p.notes.map((n) => n.over), [['GW'], ['REG', 'CA'], ['GW'], ['GW', 'POL'], ['AUD']]);
});

test('parser: hostile input stays linear and never throws', () => {
  const t0 = Date.now();
  for (const text of ['sequenceDiagram\n' + 'A' + '-'.repeat(1900) + '>' + 'B'.repeat(50), 'sequenceDiagram\n' + 'Note over ' + 'a,'.repeat(900) + ': x', ('%% real: ' + 'x'.repeat(1900) + '\nA->>B: m\n').repeat(100),
    'sequenceDiagram\n' + 'A->>B: ' + '%% real: '.repeat(200), 'sequenceDiagram\n' + 'alt x\n'.repeat(3000) + 'end\n'.repeat(3000), '%% link: ' + ' '.repeat(1900) + 'x', ('A->>B: x\nB-->>A: y\n').repeat(20000)]) {
    parseMermaid(text);
  }
  assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0} ms`);
  const bad = parseMermaid('sequenceDiagram\n%% link: bad javascript:alert(1)\n%% link: ok http://x.example/a\n%% link: nolabel');
  assert.deepEqual(bad.links, [{ label: 'ok', url: 'http://x.example/a' }]); assert.equal(bad.warnings.length, 2);
});

test('import: the sample into a blank design: steps, nested groups, spanning notes, changed marks, real, flow name and links', async () => {
  const d = await draft('blank-a');
  const pv = await imp('blank-a', d, SAMPLE, '/mermaid/preview');
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.deepEqual(pv.body.warnings, []); assert.equal(pv.body.counts.components, 6);
  const r = await imp('blank-a', d, SAMPLE);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.flow.name, 'Device onboarding and first sync (from Confluence)');
  const t = await traceOf('blank-a', d, r.body.flow), ms: any[] = t.messages;
  const labelled = (re: RegExp) => ms.find((m) => re.test(m.label));
  // returns are the response of the call they answer, never steps; self messages are internal steps; notes are leaf steps with `over`
  assert.ok(!ms.some((m) => /^(certificate|registered|ok)$/.test(m.label)));
  assert.equal(labelled(/device-registry.*devices|register the device/)?.returns?.label, 'existing device');
  assert.equal(labelled(/device-registry.*devices|register the device/)?.real, 'http:POST device-registry/v2/devices');
  const selfs = ms.filter((m) => m.self); assert.deepEqual(selfs.map((m) => m.label), ['validate serial number', 'sign policy bundle']);
  const notes = ms.filter((m) => m.kind === 'leaf' && !m.self);
  assert.deepEqual(notes.map((m) => m.over), [['onboarding-gw'], ['device-registry', 'cert-authority'], ['onboarding-gw'], ['onboarding-gw', 'policy-engine'], ['audit-trail']]);
  // changed marks: the three steps of the rect block (the call, the note and the self step), nothing else
  assert.deepEqual(ms.filter((m) => m.mark === 'changed').map((m) => m.label.replace(/^.*\/ ?/, '')).length, 3);
  assert.deepEqual(ms.filter((m) => m.mark === 'new').map((m) => m.label.slice(0, 22)), ['http:POST audit-trail/'], 'the green rect (#71 gap b): one new step');   // a green rect reads back as new
  assert.ok(ms.filter((m) => m.mark).every((m) => ['fetch the first policy', 'the policy is signed', 'sign policy bundle', 'events'].some((x) => m.label.includes(x) || (m.note ?? '').includes(x))), JSON.stringify(ms.filter((m) => m.mark).map((m) => m.label)));
  // nested frames: critical in par in opt in loop (outermost first), and the sections of an alt
  const deep = ms.find((m) => m.alt?.kind === 'critical' && m.alt.condition === 'certificate is valid');
  const chain: string[] = []; for (let a = deep.alt; a; a = a.parent) chain.unshift(`${a.kind ?? 'alt'}:${a.condition}`);
  assert.deepEqual(chain, ['par:verify the batch', 'critical:certificate is valid']);   // the loop and the opt are declared by the call that starts the sync worker: its subtree is inside them
  const starter = ms.find((m) => m.mode === 'async' && m.to.includes('sync-worker'));
  assert.deepEqual([starter.alt.parent?.kind, starter.alt.kind, starter.alt.condition, starter.alt.parent?.condition], ['loop', 'opt', 'batch is not empty', 'for each pending sync batch']);
  assert.ok(ms.some((m) => !m.alt?.kind && m.alt?.condition === 'device is new'), 'the alt of the registry call');
  assert.ok(ms.some((m) => m.alt?.kind === 'break' && m.alt.condition === 'batch is rejected'));
  // the flow's links and the whole thing again: nothing new
  const text = await exp('blank-a', d, r.body.flow);
  assert.match(text, /^%% link: Confluence page https:\/\/wiki\.example\.com\/display\/SASE\/Device\+onboarding$/m);
  assert.match(text, /^%% link: Threat model https:\/\/wiki\.example\.com\/display\/SASE\/Onboarding\+threat\+model$/m);
  const again = await imp('blank-a', d, SAMPLE);
  assert.equal(again.body.added, 0, JSON.stringify(again.body.counts));
});

test('export writes the same constructs back, and import -> export -> import -> export is stable', async () => {
  const a = await draft('blank-a'), first = await imp('blank-a', a, SAMPLE);
  const e1 = await exp('blank-a', a, first.body.flow);
  if (process.env.SHOW) console.log(e1);
  for (const re of [/^%% flow: Device onboarding and first sync/m, /^%% real: http:POST device-registry\/v2\/devices$/m, /^ *rect rgb\(/m, /^loop for each pending sync batch$/m, /^opt batch is not empty$/m, /^par audit the batch$/m,
    /^critical certificate is valid$/m, /^option certificate is revoked$/m, /^break batch is rejected$/m, /^alt device is new$/m, /^and verify the batch$/m, /^Note over \S+,\S+: the certificate is valid for 90 days$/m, /->>onboarding_gw: validate serial|->>device_registry: validate serial number/m]) assert.match(e1, re);
  assert.equal(e1.split('\n').filter((l) => /^(alt|opt|loop|par|critical|break|rect)\b/.test(l)).length, e1.split('\n').filter((l) => l === 'end').length, 'every frame is closed');
  // A step's own note (the text after `: ` of a message) comes back as a note step on the next pass, after the callee's work; from there on the text is a fixed point.
  const b = await draft('blank-b'), second = await imp('blank-b', b, e1);
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.deepEqual(second.body.warnings, [], JSON.stringify(second.body.warnings));
  const e2 = await exp('blank-b', b, second.body.flow);
  const c = await draft('blank-c'), third = await imp('blank-c', c, e2), e3 = await exp('blank-c', c, third.body.flow);
  if (e3 !== e2) { const a2 = e2.split('\n'), a3 = e3.split('\n'); const i = a2.findIndex((l, k) => l !== a3[k]); assert.fail(`line ${i + 1}: ${a2[i]}  <>  ${a3[i]}`); }
  const strip = (t: string) => t.split('\n').filter((l) => !/^Note over|^end$/.test(l)).join('\n');
  assert.equal(strip(e2), strip(e1), 'the same participants, arrows, frames and directives');
  // and the steps survive: the marks, the spans, the groups
  const t2 = (await traceOf('blank-b', b, second.body.flow)).messages, t3 = (await traceOf('blank-c', c, third.body.flow)).messages;
  const shape = (ms: any[]) => ms.map((m) => [m.kind, m.label, m.mark ?? '', (m.over ?? []).join(), m.real ?? '', m.returns?.label ?? '', m.alt ? `${m.alt.kind ?? 'alt'}/${m.alt.condition ?? ''}/${m.alt.branch}` : '']);
  assert.deepEqual(shape(t3).filter((x) => x[0] !== 'entry'), shape(t2).filter((x) => x[0] !== 'entry'));
  assert.ok(t2.some((m: any) => m.mark === 'changed') && t2.some((m: any) => m.over?.length > 1));
});
