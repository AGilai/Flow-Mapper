// The comment sanitizer: the trust boundary for rich text (0.27.0). An allowlist written with no DOM and no dependency. It tokenizes
// (core/rich-text-tokens.ts), keeps the tags below with the few attributes they may carry, escapes every piece of text and drops all
// other markup. The output is canonical, well-formed HTML made only of what this file writes, so sanitize(sanitize(x)) === sanitize(x).
// The server runs it on every write; the browser runs it again before it sets innerHTML, and on everything pasted into the editor.

import { tokenize, cleanText } from './rich-text-tokens.ts';
import type { Token } from './rich-text-tokens.ts';
export { plainText } from './rich-text-text.ts';

export const MAX_BODY = 20000; // characters, after sanitizing
export const MAX_DEPTH = 20, MAX_ROWS = 50, MAX_COLS = 20, MAX_SPAN = 20;
const MAX_INPUT = 400000; // what is read at all; the rest is ignored
const MAX_STACK = 60;
export const PALETTE = ['cc-coral', 'cc-ochre', 'cc-sage', 'cc-cyan', 'cc-sky', 'cc-violet'];

const ALLOWED = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 's', 'del', 'strike', 'u', 'ul', 'ol', 'li', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'code', 'pre', 'blockquote']);
/** Containers that paste brings (Word, Confluence, web pages) become paragraphs, so their line breaks survive. */
const AS_P = new Set(['div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const BLOCK = new Set(['p', 'ul', 'ol', 'table', 'blockquote', 'pre']);
const INLINE = new Set(['b', 'strong', 'i', 'em', 's', 'del', 'strike', 'u', 'span', 'a', 'code']);
const FOSTER = new Set(['table', 'thead', 'tbody', 'tr', 'ul', 'ol']); // elements whose only children are their own parts: text and other tags in them are dropped
const CHILD: Record<string, string[]> = { table: ['thead', 'tbody', 'tr'], thead: ['tr'], tbody: ['tr'], tr: ['td', 'th'], ul: ['li'], ol: ['li'] };

/** A tag name the sanitizer knows (kept, or turned into a paragraph): what makes a text count as HTML. */
export const isMarkupTag = (name: string) => ALLOWED.has(name.toLowerCase()) || AS_P.has(name.toLowerCase());

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/`/g, '&#96;');

/** An http(s) URL, or null. Tabs, newlines and the like are removed first, as a browser does before it reads the scheme; anything else (javascript:, data:, vbscript:, mailto:, relative) is refused. */
export function safeHref(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const u = cleanText(raw).replace(/[\t\n\r\f]/g, '').trim();
  if (u.length > 2000 || !/^https?:\/\/[^\s/?#]/i.test(u)) return null;
  return u.replace(/\s/g, '%20');
}

const span = (v: string | undefined) => { const n = Math.floor(Number(v)); return n >= 2 && n <= MAX_SPAN ? n : 0; }; // 1 is the default and is not written

interface Open { name: string; emit: boolean; skip: boolean; at: number } // at: where in the output its start tag ended

/** sanitize(html): the allowed subset only. Text is escaped, other markup is dropped; the result is not longer than MAX_BODY's check says (see `tooLong`). */
export function sanitize(html: string): string {
  if (typeof html !== 'string' || !html) return '';
  const toks: Token[] = tokenize(html.length > MAX_INPUT ? html.slice(0, MAX_INPUT) : html);
  let out = '';
  const st: Open[] = [];
  let skipping = 0, emitted = 0, rows = 0, cols = 0;

  const top = () => st[st.length - 1]?.name;
  const pop = () => { const o = st.pop()!; if (o.emit) { if (o.name === 'p' && out.length === o.at) out = out.slice(0, out.lastIndexOf('<p>')); else out += `</${o.name}>`; emitted--; } if (o.skip) skipping--; if (o.name === 'tr') cols = 0; };
  /** Pop through the nearest open `names` element, unless a `barrier` element comes first. */
  const popThrough = (names: string[], barrier: string[]) => {
    for (let k = st.length - 1; k >= 0; k--) {
      if (names.includes(st[k].name)) { while (st.length > k) pop(); return; }
      if (barrier.includes(st[k].name)) return;
    }
  };
  const push = (name: string, emit: boolean, skip = false) => { st.push({ name, emit, skip, at: out.length }); if (emit) emitted++; if (skip) skipping++; };

  function start(name: string, attrs: Record<string, string>) {
    if (AS_P.has(name)) name = 'p';
    if (!ALLOWED.has(name)) return;
    if (name === 'br') { if (!skipping && !FOSTER.has(top() ?? '')) out += '<br>'; return; }
    if (st.length >= MAX_STACK) return;
    // Implied ends and parents, as a browser would read them: li closes li, td closes td, a block closes an open p.
    if (name === 'li') popThrough(['li'], ['ul', 'ol']);
    else if (name === 'td' || name === 'th') popThrough(['td', 'th'], ['tr', 'table']);
    else if (name === 'tr') popThrough(['tr'], ['table']);
    else if (name === 'thead' || name === 'tbody') popThrough(['thead', 'tbody'], ['table']);
    else if (BLOCK.has(name)) popThrough(['p'], ['li', 'td', 'th', 'blockquote', 'table', 'ul', 'ol']);
    const parent = top();
    if (parent && FOSTER.has(parent) && !CHILD[parent].includes(name)) return;
    if ((name === 'td' || name === 'th') && parent !== 'tr') return;
    if (name === 'li' && parent !== 'ul' && parent !== 'ol') return;
    if ((name === 'thead' || name === 'tbody') && parent !== 'table') return;
    let skip = false, extra = '';
    if (name === 'tr' && ++rows > MAX_ROWS) skip = true; // a table is at most 50 x 20: what is beyond is dropped, with its contents
    if (name === 'tr') cols = 0;
    if ((name === 'td' || name === 'th') && ++cols > MAX_COLS) skip = true;
    let emit = !skipping && !skip && emitted < MAX_DEPTH;
    if (name === 'a') {
      const href = safeHref(attrs.href);
      emit = emit && !!href && !st.some((o) => o.name === 'a' && o.emit); // links do not nest
      if (emit) extra = ` href="${escAttr(href!)}" rel="noopener noreferrer" target="_blank"`;
    } else if (name === 'span') {
      const c = (attrs.class ?? '').split(/\s+/).find((x) => PALETTE.includes(x));
      emit = emit && !!c; // a span with no palette colour is nothing: its contents stay
      if (emit) extra = ` class="${c}"`;
    } else if (name === 'td' || name === 'th') {
      const cs = span(attrs.colspan), rs = span(attrs.rowspan);
      extra = (cs ? ` colspan="${cs}"` : '') + (rs ? ` rowspan="${rs}"` : '');
    }
    if (emit) out += `<${name}${extra}>`;
    push(name, emit, skip);
  }

  function end(name: string) {
    if (AS_P.has(name)) name = 'p';
    if (!ALLOWED.has(name) || name === 'br') return;
    // an end tag closes the nearest open element of its name, and what is open inside it; with no such element it is ignored.
    // It never reaches out of the cell, item or table it is in (a stray </b> in a cell does not close a <b> outside the table).
    const stops = name === 'li' ? ['ul', 'ol'] : name === 'td' || name === 'th' ? ['tr', 'table'] : name === 'tr' ? ['table'] : INLINE.has(name) ? ['td', 'th', 'li', 'blockquote', 'table', 'tr'] : [];
    for (let k = st.length - 1; k >= 0; k--) {
      if (st[k].name === name) { while (st.length > k) pop(); return; }
      if (stops.includes(st[k].name)) return;
    }
  }

  function text(v: string) {
    if (skipping || !v) return;
    const p = top();
    if (p && FOSTER.has(p)) return; // text between a table's rows, or a list's items, has no place
    out += esc(v);
  }

  for (const t of toks) { if (t.t === 'text') text(t.v); else if (t.t === 'start') start(t.name, t.attrs); else end(t.name); }
  while (st.length) pop();
  return out.trim();
}

/** The reason a sanitized body cannot be stored, or null. */
export const tooLong = (body: string) => (body.length > MAX_BODY ? `the comment is longer than ${MAX_BODY} characters` : null);
