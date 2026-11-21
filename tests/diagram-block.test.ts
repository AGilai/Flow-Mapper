// Mermaid blocks in rich text: the sanitizer keeps a code block's language tokens and drops anything else; the pure block detection; plain code stays code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../core/rich-text.ts';
import { blockLang, isMermaidBlock } from '../core/diagram-block.ts';

const doc = (x: string) => sanitize(x, { notes: true });

test('data-lang on pre and language-xxx on code are kept, in a document and in a comment', () => {
  const a = '<pre data-lang="mermaid"><code>graph TD\n  A--&gt;B</code></pre>', b = '<pre><code class="language-mermaid">a</code></pre>';
  assert.equal(doc(a), a);
  assert.equal(doc(b), b);
  assert.equal(sanitize(a), a);
  assert.equal(doc(doc(a)), doc(a));
  assert.equal(doc('<PRE DATA-LANG="Mermaid"><code>x</code></pre>'), '<pre data-lang="mermaid"><code>x</code></pre>');
});

test('bad language values are dropped', () => {
  assert.equal(doc('<pre data-lang="x y&lt;"><code>a</code></pre>'), '<pre><code>a</code></pre>');
  assert.equal(doc('<pre data-lang="a&quot; onclick=&quot;x"><code>a</code></pre>'), '<pre><code>a</code></pre>');
  assert.equal(doc(`<pre data-lang="${'a'.repeat(21)}"><code>a</code></pre>`), '<pre><code>a</code></pre>');
  assert.equal(doc('<pre><code class="language-javascript onclick">a</code></pre>'), '<pre><code class="language-javascript">a</code></pre>');
  assert.equal(doc('<pre><code class="onclick language-&lt;b">a</code></pre>'), '<pre><code>a</code></pre>');
  assert.equal(doc('<pre><code class="language-js" onclick="x" style="y">a</code></pre>'), '<pre><code class="language-js">a</code></pre>');
  assert.equal(doc('<p><code class="language-js">a</code></p>'), '<p><code>a</code></p>'); // only a code block carries a language
  assert.equal(doc('<p data-lang="mermaid">a</p>'), '<p>a</p>');
});

test('block detection is by declared language only', () => {
  assert.equal(blockLang({ preLang: 'mermaid' }), 'mermaid');
  assert.equal(blockLang({ codeClass: 'language-mermaid' }), 'mermaid');
  assert.equal(blockLang({ codeClass: 'foo language-sql' }), 'sql');
  assert.equal(blockLang({ legacyMermaid: true }), 'mermaid');
  assert.equal(blockLang({}), null);
  assert.equal(isMermaidBlock({ preLang: ' Mermaid ' }), true);
  assert.equal(isMermaidBlock({ preLang: 'javascript' }), false);
  assert.equal(isMermaidBlock({ codeClass: 'language-mermaidx' }), false);
});

test('an ordinary code block is untouched, even when its text looks like Mermaid', () => {
  const x = '<pre><code>sequenceDiagram\n  A-&gt;&gt;B: hi</code></pre>';
  assert.equal(doc(x), x);
  assert.equal(isMermaidBlock({ preLang: null, codeClass: null }), false);
});
