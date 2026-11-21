// Which code blocks of a rich text are diagrams. Pure: the reader hands in the attributes it read, no DOM here.
// The contract (docs/API.md): `<pre data-lang="mermaid"><code>source</code></pre>`, or `<pre><code class="language-mermaid">`, or the older `<pre data-mermaid>`.
// There is no guessing from the text: an ordinary code block stays code.

export interface BlockInfo { preLang?: string | null; codeClass?: string | null; legacyMermaid?: boolean }

/** The language a block declares ("mermaid", "javascript", ...), or null when it declares none. */
export function blockLang(b: BlockInfo): string | null {
  if (b.legacyMermaid) return 'mermaid';
  const d = (b.preLang ?? '').trim().toLowerCase();
  if (d) return d;
  const m = /(?:^|\s)language-([a-z0-9-]+)(?:\s|$)/.exec(b.codeClass ?? '');
  return m ? m[1] : null;
}

export const isMermaidBlock = (b: BlockInfo) => blockLang(b) === 'mermaid';
