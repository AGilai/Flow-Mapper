// The tokenizer under the comment sanitizer (core/rich-text.ts): HTML text -> tokens, with no DOM and no regex over the whole input.
// It never throws and runs in one pass. Comments, doctypes, processing instructions and the contents of script-like elements are dropped
// here; entities in text and attribute values are decoded here. Nothing it returns is HTML: text tokens are plain text, to be escaped on output.

export type Token =
  | { t: 'text'; v: string }
  | { t: 'start'; name: string; attrs: Record<string, string> }
  | { t: 'end'; name: string };

/** Elements whose contents are never text for a reader: dropped with everything inside, up to the matching end tag (or the end of the input). */
const RAW = new Set(['script', 'style', 'iframe', 'noscript', 'template', 'textarea', 'title', 'xmp', 'noembed', 'noframes', 'object', 'embed', 'applet', 'svg', 'math', 'head', 'xml', 'plaintext']);

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', colon: ':', tab: '\t', newline: '\n' };

/** Characters that never survive: C0 controls except tab / newline, DEL, C1, bidi overrides and isolates, the BOM and non-characters. */
// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩﻿￾￿]/g;
export const cleanText = (s: string) => s.replace(BAD, '');

/** Decode the entities we know (named: amp lt gt quot apos nbsp; numeric); others stay as the literal text they were. Decoded once only. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));?/g, (m, dec, hex, name) => {
    if (name) return Object.prototype.hasOwnProperty.call(NAMED, name.toLowerCase()) && (m.endsWith(';') || ['amp', 'lt', 'gt', 'quot'].includes(name)) ? NAMED[name.toLowerCase()] : m;
    const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    if (!cp || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '';
    return String.fromCodePoint(cp);
  });
}

/** ASCII-only lower-casing: same length as the input, and no Unicode letter ever turns into an ASCII one (the Kelvin sign into k). */
const lc = (s: string) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const isLetter = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

/** Parse the attributes of a start tag from `s` (the text after the tag name, up to but not including the closing '>'). Names are lower-cased; a repeated name keeps its first value. */
function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && (isSpace(s[i]) || s[i] === '/')) i++;
    let a = i;
    while (i < n && !isSpace(s[i]) && s[i] !== '=' && s[i] !== '/') i++;
    const name = lc(s.slice(a, i));
    while (i < n && isSpace(s[i])) i++;
    let val = '';
    if (s[i] === '=') {
      i++;
      while (i < n && isSpace(s[i])) i++;
      if (s[i] === '"' || s[i] === "'") { const q = s[i++]; a = i; while (i < n && s[i] !== q) i++; val = s.slice(a, i); i++; } else { a = i; while (i < n && !isSpace(s[i])) i++; val = s.slice(a, i); }
    }
    if (name && !(name in out)) out[name] = decodeEntities(val);
  }
  return out;
}

/** Find the '>' that ends a tag starting at `from`, skipping quoted attribute values. -1 when the input ends first. */
function tagEnd(html: string, from: number): number {
  let q = '';
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '>') return i;
  }
  return -1;
}

/** Skip the contents of a raw element: the index just after its end tag, or the end of the input. */
function skipRaw(html: string, lower: string, from: number, name: string): number {
  let i = from;
  for (;;) {
    const k = lower.indexOf('</' + name, i);
    if (k < 0) return html.length;
    const after = lower[k + 2 + name.length];
    if (after === undefined || after === '>' || after === '/' || isSpace(after)) { const e = html.indexOf('>', k); return e < 0 ? html.length : e + 1; }
    i = k + 2;
  }
}

export function tokenize(html: string): Token[] {
  const out: Token[] = [];
  const n = html.length;
  let i = 0, text = '', lowered: string | undefined; // lower-cased copy, made once and only when a raw element needs it
  const flush = () => { if (text) { out.push({ t: 'text', v: cleanText(decodeEntities(text)) }); text = ''; } };
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { text += html.slice(i); break; }
    text += html.slice(i, lt);
    const c = html[lt + 1];
    if (html.startsWith('<!--', lt)) { // comment (conditional comments of Word too): to the first '-->'
      const e = html.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3; continue;
    }
    if (c === '!' || c === '?') { const e = html.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; } // doctype, CDATA, <?xml ?>, <![if ...]>
    const closing = c === '/';
    if (!(isLetter(c ?? '') || (closing && isLetter(html[lt + 2] ?? '')))) { text += '<'; i = lt + 1; continue; } // a stray '<' is text
    const end = tagEnd(html, lt + 1);
    if (end < 0) { i = n; break; } // an unfinished tag at the end of the input is dropped
    let j = lt + (closing ? 2 : 1);
    const a = j;
    while (j < end && !isSpace(html[j]) && html[j] !== '/') j++;
    const name = lc(html.slice(a, j));
    i = end + 1;
    flush();
    if (closing) { out.push({ t: 'end', name }); continue; }
    if (RAW.has(name)) { lowered ??= lc(html); i = skipRaw(html, lowered, i, name); continue; }
    out.push({ t: 'start', name, attrs: parseAttrs(html.slice(j, end)) });
  }
  flush();
  return out;
}
