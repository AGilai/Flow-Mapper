// A Mermaid block in a read-only document, drawn as the diagram (Confluence style) with a Diagram | Source toggle and a copy button. The renderer
// is web/vendor/mermaid/mermaid.min.js, loaded with a <script> tag the first time a document holds a diagram. Only the TEXT of the code block goes
// to Mermaid (securityLevel 'strict'), never the block's HTML. A diagram that does not parse shows its source and the error, never a blank.

import { h } from '../dom.js';
import { isMermaidBlock } from '../../core/diagram-block.js';

const SRC = 'vendor/mermaid/mermaid.min.js';
let loading = null, seq = 0, chain = Promise.resolve(), watching = false;
const live = new Set(); // the diagram blocks on screen, to draw again on a theme change

const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : !!matchMedia?.('(prefers-color-scheme: dark)').matches; };

/** Load Mermaid once; resolves the global, rejects when the file cannot be fetched. */
export function loadMermaid() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  loading ??= new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = SRC; s.async = true;
    s.onload = () => (window.mermaid ? ok(window.mermaid) : no(new Error('Mermaid did not start')));
    s.onerror = () => { loading = null; s.remove(); no(new Error('Could not load the Mermaid renderer')); };
    document.head.append(s);
  });
  return loading;
}

const setup = (m) => m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark() ? 'dark' : 'default' }); // a diagram's own %%{init}%% line still wins

/** Draw `src`: { svg } or throws the parse / render error. One at a time (Mermaid shares state). */
export function drawDiagram(src) {
  const run = async () => {
    const m = await loadMermaid();
    setup(m);
    const id = `ntmm${++seq}`;
    try { await m.parse(src); const { svg } = await m.render(id, src); return svg; }
    finally { document.getElementById(id)?.remove(); document.getElementById(`d${id}`)?.remove(); }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

const watchTheme = () => {
  if (watching) return; watching = true;
  const again = () => { for (const f of [...live]) f.isConnected ? f.paint() : live.delete(f); };
  matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', again);
  new MutationObserver(again).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
};

/** The source text of a <pre>: its text content, with <br> as a newline. */
export const preText = (p) => [...p.querySelectorAll('br')].length ? [...p.childNodes].map((n) => (n.nodeName === 'BR' ? '\n' : n.textContent)).join('') : p.textContent;

/** One block -> a <figure>: toolbar, the diagram, the source (hidden), an error strip. */
export function diagramFigure(src) {
  let mode = 'diagram', ver = 0;
  const view = h('div.nt-dg-view', { 'data-qa': 'nt-diagram-view' }, h('span.nt-dg-wait', 'Drawing the diagram…'));
  const code = h('pre.nt-dg-src', { hidden: true, 'data-qa': 'nt-diagram-source' }, h('code', src));
  const err = h('div.nt-dg-err', { role: 'alert', hidden: true, 'data-qa': 'nt-diagram-error' });
  const bd = h('button', { type: 'button', class: 'on', 'aria-pressed': 'true', 'data-qa': 'nt-dg-diagram', on: { click: () => show('diagram') } }, 'Diagram');
  const bs = h('button', { type: 'button', 'aria-pressed': 'false', 'data-qa': 'nt-dg-source', on: { click: () => show('source') } }, 'Source');
  const copy = h('button.btn.sm.nt-dg-copy', { type: 'button', 'data-qa': 'nt-dg-copy', on: { click: async () => { try { await navigator.clipboard.writeText(src); copy.textContent = 'Copied'; } catch { copy.textContent = 'Not copied'; } setTimeout(() => { copy.textContent = 'Copy'; }, 1400); } } }, 'Copy');
  const fig = h('figure.nt-dg', { 'data-qa': 'nt-mermaid' }, h('div.nt-dg-bar', h('b', 'Mermaid'), h('span.dd-seg', { role: 'group', 'aria-label': 'Diagram or source' }, bd, bs), copy), view, err, code);
  const failed = () => !err.hidden;
  function show(m) {
    mode = m;
    for (const [b, on] of [[bd, m === 'diagram'], [bs, m === 'source']]) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    view.hidden = m !== 'diagram' || failed(); code.hidden = m !== 'source' && !failed();
  }
  const paint = () => {
    const mine = ++ver;
    drawDiagram(src).then((svg) => { if (mine !== ver) return; view.innerHTML = svg; err.hidden = true; show(mode); }, (e) => {
      if (mine !== ver) return;
      view.replaceChildren(); err.hidden = false; err.textContent = `This diagram could not be drawn: ${String(e?.message ?? e).split('\n').filter(Boolean).slice(0, 4).join(' / ')}`;
      bd.disabled = true; show('source'); code.hidden = false;
    });
  };
  fig.paint = paint;
  live.add(fig); watchTheme(); paint();
  return fig;
}

/** `pre[data-lang=mermaid]`, `pre > code.language-mermaid` and the older `pre[data-mermaid]` -> the diagram. Other blocks are left alone. */
export function renderDiagrams(root) {
  root.querySelectorAll('pre').forEach((p) => {
    const code = p.querySelector(':scope > code');
    if (!isMermaidBlock({ preLang: p.getAttribute('data-lang'), codeClass: code?.getAttribute('class'), legacyMermaid: p.hasAttribute('data-mermaid') })) return;
    const src = preText(code ?? p).trim();
    if (src) p.replaceWith(diagramFigure(src));
  });
}

/** Redraw `obj.paint()` whenever the theme changes, as long as `obj` is in the page (the editor's live preview uses it too). */
export const trackTheme = (obj) => { live.add(obj); watchTheme(); };

/** Is this <pre> a Mermaid block (any of the three spellings)? Returns its source text, or null. */
export function mermaidSource(p) {
  const code = p.querySelector(':scope > code');
  return isMermaidBlock({ preLang: p.getAttribute('data-lang'), codeClass: code?.getAttribute('class'), legacyMermaid: p.hasAttribute('data-mermaid') }) ? preText(code ?? p).trim() : null;
}
