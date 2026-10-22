// 0.33.0 the info pane (docs/plans/info-pane.md): the rules with no DOM (width, sheet snaps, sel=, closing), the About sections and the open-questions
// extractor, the doc links and endpoint text of the Overview, and "Flows through it" (core and HTTP).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sampleManifests, startApp } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { WIDTH, clampWidth, isSheet, sheetHeight, nearestSnap, stepSnap, parseSel, selOf, closesOnClick, currentJump, questionsText, JUMPS, OPEN_DEFAULT, parseOpen, siblingRow, outlineOf, showOutline, expandedParam } from '../web/js/pane/pane-pure.js';
// @ts-ignore
import { endpointText, flowName, firstLine, stepsOfComponent } from '../web/js/pane/pane-parts.js';
import { aboutSections, openQuestions, isQuestions } from '../core/about-sections.ts';

test('the drawer is 420 px, resizable 340 to 640, never more than 60% of the window', () => {
  assert.deepEqual([WIDTH.def, WIDTH.min, WIDTH.max], [420, 340, 640]);
  assert.equal(clampWidth(100, 1600), 340);
  assert.equal(clampWidth(900, 1600), 640);
  assert.equal(clampWidth(500, 1600), 500);
  assert.equal(clampWidth(600, 900), 540); // 60% of 900
  assert.equal(clampWidth(undefined, 1600), 420);
  assert.equal(clampWidth('x', 1600), 420);
});

test('a window of 760 px or less gets the bottom sheet with three snaps', () => {
  assert.equal(isSheet(760), true);
  assert.equal(isSheet(761), false);
  assert.ok(sheetHeight('peek', 800) < sheetHeight('half', 800) && sheetHeight('half', 800) < sheetHeight('full', 800));
  assert.equal(nearestSnap(sheetHeight('full', 800) - 10, 800), 'full');
  assert.equal(nearestSnap(60, 800), 'peek');
  assert.equal(stepSnap('half', 1), 'full');
  assert.equal(stepSnap('full', 1), 'full');
  assert.equal(stepSnap('peek', -1), 'peek');
});

test('sel= names a component (svc:) or a subsystem (grp:), and round-trips', () => {
  assert.deepEqual(parseSel('svc:policy-compiler'), { kind: 'component', name: 'policy-compiler' });
  assert.deepEqual(parseSel('grp:platform'), { kind: 'subsystem', key: 'platform' });
  assert.deepEqual(parseSel('grp:'), { kind: 'subsystem', key: '' }); // "Not set"
  for (const bad of [null, undefined, '', 'svc:', 'ch:topic', 'res:x', 42]) assert.equal(parseSel(bad as any), null);
  assert.equal(selOf('component', 'a b'), 'svc:a b');
  assert.equal(selOf('subsystem', 'platform'), 'grp:platform');
});

test('a click on empty space closes the pane unless it is pinned; a click on an item or inside never does', () => {
  assert.equal(closesOnClick({ pinned: false, onItem: false, insidePane: false }), true);
  assert.equal(closesOnClick({ pinned: true, onItem: false, insidePane: false }), false);
  assert.equal(closesOnClick({ pinned: false, onItem: true, insidePane: false }), false);
  assert.equal(closesOnClick({ pinned: false, onItem: false, insidePane: true }), false);
});

test('the jump bar: a component has Overview, About, Flows, Connections; a subsystem lists components and links on their own', () => {
  assert.deepEqual(JUMPS.component.map((j: any) => j.label), ['Overview', 'About', 'Flows', 'Connections']);
  assert.deepEqual(JUMPS.subsystem.map((j: any) => j.id), ['overview', 'about', 'components', 'links', 'flows']);
  assert.equal(currentJump([0, 300, 700, null], 24), 0);
  assert.equal(currentJump([-400, -10, 300, 800], 24), 1);
  assert.equal(currentJump([-400, -300, -10, 800], 24), 2);
  assert.equal(questionsText(0), '');
  assert.equal(questionsText(1), '1 open question');
  assert.equal(questionsText(2), '2 open questions');
});

test('the Overview texts: endpoint counts by transport, flow name, first line of an about', () => {
  assert.deepEqual(endpointText([], []), { total: 0, text: '' });
  assert.deepEqual(endpointText([{ transport: 'http' }, { transport: 'http' }, { transport: 'http' }], [{ transport: 'amqp' }]), { total: 4, text: '3 in (http), 1 out (amqp)' });
  assert.equal(endpointText([{ transport: 'http' }, { transport: 'sqs' }], []).text, '2 in (1 http, 1 sqs)');
  assert.equal(flowName({ service: 'a', id: 'in.x', name: 'Named' }), 'Named');
  assert.equal(flowName({ service: 'a', id: 'in.x' }), 'a in.x');
  assert.equal(firstLine('## Capabilities\n- Compiles policy into bundles\n- more'), 'Capabilities');
  assert.equal(firstLine('Compiles policy.\n\nMore.'), 'Compiles policy.');
  assert.equal(firstLine(''), '');
  assert.equal(firstLine(undefined), '');
});

const ABOUT = `Intro line.

## Capabilities
- Compiles tenant policy.
- Validates rules.

## Motivation
Why. A \`## not a heading\` inside code is fine.

\`\`\`
## Open questions
- inside a fence: not a question
\`\`\`

## Open questions
- Is the bundle size capped per tenant?
* Who signs a bundle?
1. Numbered one?

Some prose that is not an item.

### Sub heading stays in its section
- still a question item

## Owners
Platform Policy team.
`;

test('about is split at ## headings; the text before the first one has no title; code fences are never headings', () => {
  const s = aboutSections(ABOUT);
  assert.deepEqual(s.map((x) => x.title), ['', 'Capabilities', 'Motivation', 'Open questions', 'Owners']);
  assert.equal(s[0].body, 'Intro line.');
  assert.ok(s[2].body.includes('inside a fence'));
  assert.ok(s[3].body.includes('Sub heading stays'));
  assert.deepEqual(aboutSections(''), []);
  assert.deepEqual(aboutSections(undefined), []);
  assert.deepEqual(aboutSections('Just text.').map((x) => x.title), ['']);
  assert.equal(isQuestions('Open questions'), true);
  assert.equal(isQuestions(' open question '), true);
  assert.equal(isQuestions('Owners'), false);
});

test('open questions are the list items of the "Open questions" section, with their line', () => {
  const q = openQuestions(ABOUT);
  assert.deepEqual(q.map((x) => x.text), ['Is the bundle size capped per tenant?', 'Who signs a bundle?', 'Numbered one?', 'still a question item']);
  const lines = ABOUT.split('\n');
  for (const x of q) assert.ok(lines[x.line].includes(x.text), `${x.line}: ${lines[x.line]}`);
  assert.deepEqual(openQuestions('## Capabilities\n- a'), []);
  assert.deepEqual(openQuestions(undefined), []);
  assert.deepEqual(openQuestions('## Open questions\nnone yet'), []);
});

test('the expanded page: default open rows, remembered open rows, [ ] navigation, the outline, expanded=1', () => {
  assert.deepEqual([...parseOpen(null)], OPEN_DEFAULT);
  assert.deepEqual([...parseOpen('not json')], OPEN_DEFAULT);
  assert.deepEqual([...parseOpen('{"a":1}')], OPEN_DEFAULT);
  assert.deepEqual([...parseOpen('[1,2]')], OPEN_DEFAULT);
  assert.deepEqual([...parseOpen('["flows","q"]')], ['flows', 'q']);
  assert.deepEqual([...parseOpen('[]')], []); // everything folded is a valid remembered state
  const ids = ['overview', 'about', 'q', 'flows'];
  assert.equal(siblingRow(ids, 'about', 1), 'q');
  assert.equal(siblingRow(ids, 'about', -1), 'overview');
  assert.equal(siblingRow(ids, 'overview', -1), 'overview');
  assert.equal(siblingRow(ids, 'flows', 1), 'flows');
  assert.equal(siblingRow(ids, null, 1), 'overview');
  assert.equal(siblingRow([], null, 1), null);
  const out = outlineOf([{ id: 'about', title: 'About', count: 4, children: [{ id: 'about-s1', title: 'Capabilities' }] }, { id: 'q', title: 'Open questions', count: 2, q: true }]);
  assert.deepEqual(out.map((o: any) => [o.id, o.depth, o.q]), [['about', 0, false], ['about-s1', 1, false], ['q', 0, true]]);
  assert.equal(showOutline(1280), true);
  assert.equal(showOutline(1279), false);
  assert.equal(expandedParam(true), '1');
  assert.equal(expandedParam(false), null);
});

test('"In this flow": the steps of the flow a pane was opened from that touch the component, with the direction', () => {
  const steps = [{ n: 1, from: 'client', to: 'policy-compiler', label: 'POST /compile' }, { n: 2, from: 'policy-compiler', to: 'pop-policy-cache', label: 'bundle.published' }, { n: 3, from: 'pop-policy-cache', to: 'pop-edge', label: 'pull' }];
  assert.deepEqual(stepsOfComponent(steps, 'policy-compiler'), [{ n: 1, label: 'POST /compile', how: 'receives', other: 'client' }, { n: 2, label: 'bundle.published', how: 'sends', other: 'pop-policy-cache' }]);
  assert.deepEqual(stepsOfComponent(steps, 'nobody'), []);
  assert.deepEqual(stepsOfComponent(undefined, 'x'), []);
});

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201); });
after(() => app.close());

test('flows through a component: the entry points whose flows run through it, and those that start in it', async () => {
  const r = await app.call('GET', '/api/envs/prod/flows-through?service=orders-svc');
  assert.equal(r.status, 200);
  const keys = r.body.map((e: any) => `${e.service}/${e.id}`);
  assert.ok(keys.length >= 2, keys.join());
  assert.ok(keys.some((k: string) => k.startsWith('orders-svc/')), 'a flow that starts in it');
  assert.ok(keys.some((k: string) => !k.startsWith('orders-svc/')), 'a flow that only passes through it');
  const all = await app.call('GET', '/api/envs/prod/entry-points');
  assert.ok(keys.length < all.body.length, 'not every flow runs through one component');
  const two = await app.call('GET', '/api/envs/prod/flows-through?service=orders-svc,billing-api');
  assert.ok(two.body.length >= r.body.length, 'a subsystem is the union of its components');
  assert.deepEqual((await app.call('GET', '/api/envs/prod/flows-through')).body, []);
  assert.deepEqual((await app.call('GET', '/api/envs/prod/flows-through?service=nope')).body, []);
});
