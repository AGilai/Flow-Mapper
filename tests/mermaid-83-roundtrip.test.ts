// Fix #83 (QA): round-trip stability (import -> export -> import -> export) on every Mermaid sample and on the unanswered-call stack cases.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { startDesign } from './helpers.ts';

const DIR = new URL('../samples/mermaid/', import.meta.url);
const CASES: Record<string, string> = {
  nested: ['sequenceDiagram', 'A->>B: one', 'B->>C: two', 'C->>D: three', 'D-->>C: r3', 'C-->>B: r2', 'B->>C: two again', 'C-->>B: r2b', 'B-->>A: r1'].join('\n'),
  selfcall: ['sequenceDiagram', 'A->>B: one', 'B->>B: think', 'B->>C: two', 'C-->>B: r2', 'B-->>A: r1'].join('\n'),
  async: ['sequenceDiagram', 'A->>B: one', 'B-)C: fire', 'C->>D: later', 'D-->>C: rl', 'B-->>A: r1', 'A->>B: next'].join('\n'),
  missing: ['sequenceDiagram', 'A->>B: one', 'B->>C: two', 'C->>D: three', 'D-->>C: r3', 'B-->>A: r1', 'A->>B: next'].join('\n'),
  twoReturns: ['sequenceDiagram', 'A->>B: one', 'B->>C: two', 'C-->>B: first', 'C-->>B: second', 'B-->>A: r1', 'B-->>A: r1 again'].join('\n'),
  altBoth: ['sequenceDiagram', 'A->>B: one', 'alt ok', 'B->>C: x', 'C-->>B: xr', 'else bad', 'B-->>A: nope', 'end', 'B-->>A: done'].join('\n'),
  returnOnlyThenMore: ['sequenceDiagram', 'A->>B: one', 'alt ok', 'B-->>A: fine', 'else bad', 'B-->>A: nope', 'end', 'A->>B: two', 'B-->>A: r2'].join('\n'),
};
for (const f of readdirSync(DIR)) if (f.endsWith('.mmd')) CASES[`sample:${f}`] = readFileSync(new URL(f, DIR), 'utf8');
let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => {
  app = await startDesign();
  for (const name of Object.keys(CASES).flatMap((k, i) => [`rt${i}a`, `rt${i}b`, `rt${i}c`])) assert.equal((await app.call('POST', '/api/envs', { name, source: 'prod', mode: 'blank', groups: [{ key: 'platform', label: 'Platform' }] })).status, 201);
});
after(() => app.close());

const run = async (env: string, text: string) => {
  const slug = (await app.call('POST', `/api/envs/${env}/drafts`, { name: 'rt' })).body.slug as string;
  const r = await app.call('POST', `/api/envs/${env}/drafts/${slug}/mermaid`, { text, groupPath: 'platform', matches: {} });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const f = r.body.flow, q = `service=${f.service}&ingress=${f.ingress}&draft=${slug}`;
  const exp = (await app.call('GET', `/api/envs/${env}/flows/mermaid?${q}`)).body as string;
  const trace = (await app.call('GET', `/api/envs/${env}/trace?detail=full&choose=*:both&${q}`)).body;
  return { exp, trace };
};
const norm = (t: string) => t.replace(/(tbd-a-)+/g, "tbd-a-");
const shape = (ms: any[]) => ms.map((m) => [m.kind, m.depth, norm(m.label), m.returns?.label ?? '', m.returnTo ?? '', m.alt ? `${m.alt.condition}/${m.alt.branch}` : '']);

for (const [i, name] of Object.keys(CASES).entries()) {
  test(`#83 round trip: ${name}`, async () => {
    // a step's own note comes back as a note step on the second pass (documented in mermaid-full); from the second export on the text is a fixed point
    const a0 = await run(`rt${i}a`, CASES[name]), a = await run(`rt${i}b`, a0.exp), b = await run(`rt${i}c`, a.exp);
    if (process.env.SHOW) console.log(`--- ${name}\n${a.exp}`);
    assert.equal(norm(b.exp), norm(a.exp));
    assert.deepEqual(shape(b.trace.messages), shape(a.trace.messages));
    const l = a.exp.split('\n');
    assert.equal(l.filter((x) => x === 'end').length, l.filter((x) => /^(alt|opt|loop|par|critical|break|rect)\b/.test(x.trim())).length);
  });
}
