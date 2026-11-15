// Unreleased (frame 28d-f): the document mode of the sanitizer (Notes: the design doc and a flow's doc): h1-h3, nested lists, tables, code blocks,
// Mermaid blocks, reference chips and callouts, plus the attacks that must stay out; and the pure callout / badge / reference readers (core/callouts.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../core/rich-text.ts';
import { callouts, badges, parseRef, refText } from '../core/callouts.ts';
import { headings } from '../core/notes.ts';

const doc = (x: string) => sanitize(x, { notes: true });

test('headings h1, h2, h3 stay; h4 to h6 are h3; a comment has none', () => {
  assert.equal(doc('<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4><h6>E</h6>'), '<h1>A</h1><h2>B</h2><h3>C</h3><h3>D</h3><h3>E</h3>');
  assert.equal(sanitize('<h1>A</h1>'), '<p>A</p>');
  assert.deepEqual(headings('<h1>Title</h1><h2>Sub</h2><h3>Deep</h3>').map((h) => h.level), [1, 2, 3]);
});

test('nested lists, tables and code blocks survive', () => {
  assert.equal(doc('<ul><li>a<ul><li>b<ol><li>c</li></ol></li></ul></li><li>d</li></ul>'), '<ul><li>a<ul><li>b<ol><li>c</li></ol></li></ul></li><li>d</li></ul>');
  assert.equal(doc('<table><thead><tr><th colspan="2">H</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>'), '<table><thead><tr><th colspan="2">H</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>');
  assert.equal(doc('<pre><code>if (a &lt; b) {\n  go();\n}</code></pre>'), '<pre><code>if (a &lt; b) {\n  go();\n}</code></pre>');
});

test('a Mermaid block: pre[data-mermaid] keeps its source as text, only in a document', () => {
  const src = 'sequenceDiagram\n  A->>B: hi <b>x</b>';
  assert.equal(doc(`<pre data-mermaid="whatever" onclick="x()">${src}</pre>`), '<pre data-mermaid="1">sequenceDiagram\n  A-&gt;&gt;B: hi <b>x</b></pre>');
  assert.equal(doc('<pre data-mermaid>a</pre>'), '<pre data-mermaid="1">a</pre>');
  assert.equal(sanitize('<pre data-mermaid="1">a</pre>'), '<pre>a</pre>', 'a comment keeps a plain pre');
  assert.equal(doc('<pre><script>alert(1)</script>ok</pre>'), '<pre>ok</pre>');
});

test('reference chips: svc, flow and step shapes only; other values lose the chip', () => {
  assert.equal(doc('<p><span data-ref="svc:catalog-svc">catalog-svc</span></p>'), '<p><span data-ref="svc:catalog-svc">catalog-svc</span></p>');
  assert.equal(doc('<p><span data-ref="flow:catalog-svc/in.get.products">f</span> <span data-ref="step:catalog-svc/in.get.products#2">s</span></p>'),
    '<p><span data-ref="flow:catalog-svc/in.get.products">f</span> <span data-ref="step:catalog-svc/in.get.products#2">s</span></p>');
  for (const bad of ['javascript:alert(1)', 'http://evil', 'flow:nosplit', 'step:a/b', 'step:a/b#x', 'step:/b#1', 'svc:', 'SVC:x']) assert.equal(doc(`<p><span data-ref="${bad}">t</span></p>`), '<p>t</p>', bad);
  assert.equal(doc('<p><span data-ref="svc:a&quot; onmouseover=&quot;x">t</span></p>'), '<p><span data-ref="svc:a&quot; onmouseover=&quot;x">t</span></p>', 'a quote in the value is escaped, never an attribute');
  assert.equal(sanitize('<p><span data-ref="svc:a">t</span></p>'), '<p>t</p>', 'a comment has no chips');
});

test('callouts: key, watch, risk with one step; others are plain paragraphs', () => {
  assert.equal(doc('<div data-callout="key" data-step="2"><p>find is the hot call</p></div>'), '<div data-callout="key" data-step="2"><p>find is the hot call</p></div>');
  assert.equal(doc('<div data-callout="WATCH" data-step="1" class="x" style="color:red">text</div>'), '<div data-callout="watch" data-step="1">text</div>');
  assert.equal(doc('<div data-callout="risk">no step</div>'), '<div data-callout="risk">no step</div>');
  assert.equal(doc('<div data-callout="key" data-step="2-5">a range is not one step</div>'), '<div data-callout="key">a range is not one step</div>');
  assert.equal(doc('<div data-callout="note" data-step="2">x</div>'), '<p>x</p>');
  assert.equal(doc('<div>plain</div>'), '<p>plain</p>');
  assert.equal(doc('<div data-callout="key" data-step="2"><div data-callout="risk" data-step="3">inner</div></div>'), '<div data-callout="key" data-step="2"><p>inner</p></div>', 'callouts do not nest');
  assert.equal(doc('<ul><li><div data-callout="key" data-step="1">in a list</div></li></ul>'), '<ul><li><p>in a list</p></li></ul>', 'a callout is a top-level block');
  assert.equal(doc('<p>before<div data-callout="key" data-step="1">in</div>after</p>'), '<p>before</p><div data-callout="key" data-step="1">in</div>after');
});

test('the attack cases stay out in document mode', () => {
  const attacks = [
    '<script>alert(1)</script><p>x</p>', '<p onclick="a()">x</p>', '<a href="javascript:alert(1)">x</a>', '<a href="data:text/html,<b>">x</a>', '<img src=x onerror=alert(1)>',
    '<div data-callout="key" data-step="1" onmouseover="a()" style="background:url(javascript:a())">x</div>', '<span style="x" data-ref="svc:a" onclick="b()">t</span>',
    '<pre data-mermaid onclick="a()"><img src=x onerror=a()></pre>', '<h1 onclick="a()" style="x">h</h1>', '<svg onload=a()></svg><iframe src="x"></iframe>', '<style>p{}</style><form action="x"><input></form>',
  ];
  for (const x of attacks) {
    const o = doc(x), live = o.replace(/&lt;[^]*?(?:&gt;|$)/g, '');
    assert.ok(!/<(?:script|img|svg|iframe|style|form|input)/i.test(live), `live tag in ${o}`);
    assert.ok(!/\son[a-z]+\s*=|style=|href="(?!https?:\/\/)/i.test(live), `live attribute in ${o}`);
    assert.equal(doc(o), o, `canonical: ${x}`);
  }
});

test('document mode is canonical and idempotent on messy input', () => {
  for (const x of ['<div data-callout="key" data-step="2"><p>a<div>b</div>c</div>d', '<h1>a<h2>b<div data-callout="risk">c', '<pre data-mermaid><p>x</p></pre>', '<ul><li>a<ul><li>b</li></ul></ul>', '<div data-callout="watch" data-step="3"><ul><li>x</li></ul></div>']) {
    const once = doc(x);
    assert.equal(doc(once), once, x);
    assert.equal((once.match(/<div/g) ?? []).length, (once.match(/<\/div>/g) ?? []).length, `balanced ${once}`);
  }
});

test('a document is not cut at the comment limit', () => {
  const big = `<p>${'word '.repeat(60000)}</p>`;
  assert.ok(doc(big).length > 200000);
});

test('callouts() reads them in order with their step and text; callouts nested in other blocks or other divs are not counted', () => {
  const html = '<h2>A</h2><div data-callout="key" data-step="2"><p>find <b>is</b> hot</p></div><p>x</p><div data-callout="watch" data-step="1"><p>one</p><p>two</p></div><div data-callout="risk"><ul><li>no step</li></ul></div>';
  assert.deepEqual(callouts(html).map((c) => [c.index, c.kind, c.step, c.text]), [[0, 'key', 2, 'find is hot'], [1, 'watch', 1, 'one two'], [2, 'risk', null, 'no step']]);
  assert.deepEqual(callouts(''), []);
  assert.deepEqual(callouts('<div data-callout="nope">x</div>'), []);
});

test('badges(): a star for key, a bang for watch and risk; key beats risk beats watch on one step; a gone step has none', () => {
  const list = callouts('<div data-callout="key" data-step="2">a</div><div data-callout="watch" data-step="1">b</div><div data-callout="risk" data-step="2">c</div><div data-callout="key" data-step="9">d</div><div data-callout="key">e</div>');
  assert.deepEqual(badges(list, 3), [
    { step: 1, badge: 'bang', kind: 'watch', kinds: ['watch'], callouts: [1] },
    { step: 2, badge: 'star', kind: 'key', kinds: ['key', 'risk'], callouts: [0, 2] },
  ]);
  assert.deepEqual(badges(list, 0).map((b) => [b.step, b.badge]), [[1, 'bang'], [2, 'star'], [9, 'star']], 'steps not known yet: nothing is judged');
  assert.equal(badges(callouts('<div data-callout="watch" data-step="3">a</div><div data-callout="risk" data-step="3">b</div>'), 5)[0].kind, 'risk');
  assert.deepEqual(badges(callouts('<div data-callout="key" data-step="4">x</div>'), 5), [{ step: 4, badge: 'star', kind: 'key', kinds: ['key'], callouts: [0] }]);
});

test('parseRef / refText round trip; bad shapes are null', () => {
  for (const v of ['svc:catalog-svc', 'flow:catalog-svc/in.get.products.id', 'step:catalog-svc/in.get.products#2']) assert.equal(refText(parseRef(v)!), v);
  assert.deepEqual(parseRef('step:a/b.c#12'), { kind: 'step', service: 'a', ingress: 'b.c', step: 12 });
  for (const v of ['', 'x:y', 'flow:a', 'flow:/b', 'step:a/b', 'step:a/b#0', null, undefined]) assert.equal(parseRef(v as any), null, String(v));
});
