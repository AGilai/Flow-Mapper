// Call notes (frame 28g, Unreleased): a short description kept per CALL (one arrow between two components), not per flow, so the same call reads the same in every flow
// that uses it. They live in the Notes storage (`flow_notes`: versions, History) under the anchor `call:<from>|<to>|<op>`; `from` / `to` are the names the step shows
// (service, queue, data store) and `op` its label ("GET /products/{id}/reviews", "find reviews"): never the step number, which renumbers.
// The body is a full sanitized Notes document (edited with the flow doc's rich editor); a note written from fields (MCP {body, contract, watch}) has this shape:
//   <h2>What it does</h2><p>…</p><h2>Contract</h2><p>…</p><div data-callout="watch"><p>…</p></div>
// `parseCall` reads it back as fields, `serializeCall` writes it from fields. Pure: runs on the server and in the browser.

import { tokenize } from './rich-text-tokens.ts';
import { esc } from './rich-text.ts';

export const CALL_PREFIX = 'call:';
export interface CallParts { from: string; to: string; op: string }
/** The fields of a call note, read back from its body. `watch.on`: the body holds a Watch callout. */
export interface CallNote { what: string; contract: string; first: string; risk: boolean; watch: { on: boolean; text: string }; other: boolean }
export const CALL_MAX = { what: 2000, contract: 500, watch: 500, part: 200, body: 12000 } as const;

const part = (s: string) => s.replace(/%/g, '%25').replace(/\|/g, '%7C');
const unpart = (s: string) => s.replace(/%7C/gi, '|').replace(/%25/g, '%');

/** `call:<from>|<to>|<op>`, the parts escaped so a `|` in a label stays in its part. */
export const callAnchor = (from: string, to: string, op: string) => `${CALL_PREFIX}${part(from)}|${part(to)}|${part(op)}`;
export const isCallAnchor = (a: unknown): a is string => typeof a === 'string' && parseCallAnchor(a) !== null;
/** The three parts of a call anchor, or null (a part empty or too long, or not three parts). */
export function parseCallAnchor(a: unknown): CallParts | null {
  if (typeof a !== 'string' || !a.startsWith(CALL_PREFIX)) return null;
  const p = a.slice(CALL_PREFIX.length).split('|');
  if (p.length !== 3 || p.some((x) => !x || x.length > CALL_MAX.part * 3)) return null;
  const [from, to, op] = p.map(unpart);
  return { from, to, op };
}

const paras = (t: string) => t.replace(/\r\n?/g, '\n').split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('');

/** The body of a call note from its fields (text is escaped; blank fields are left out; nothing at all gives ''). */
export function serializeCall(n: Partial<CallNote> & { watch?: Partial<CallNote['watch']> }): string {
  const what = (n.what ?? '').trim().slice(0, CALL_MAX.what), contract = (n.contract ?? '').trim().slice(0, CALL_MAX.contract), watch = (n.watch?.on === false ? '' : n.watch?.text ?? '').trim().slice(0, CALL_MAX.watch);
  return [what ? `<h2>What it does</h2>${paras(what)}` : '', contract ? `<h2>Contract</h2>${paras(contract.replace(/\n+/g, ' '))}` : '', watch ? `<div data-callout="watch">${paras(watch)}</div>` : ''].join('');
}

/** The fields of a body (a body that is not in this shape: all of its text is "What it does"). `first` is the first paragraph outside a callout and a heading (the collapsed card's line);
 * `watch.on` / `risk` are true when the body holds a Watch / Risk callout (even an empty one): the diagram's markers come from them, not from the text. */
export function parseCall(html: string): CallNote {
  const out: CallNote = { what: '', contract: '', first: '', risk: false, other: false, watch: { on: false, text: '' } };
  let sec: 'what' | 'contract' | null = null, head = false, hd = '', depth = 0, co: string | null = null, para = '', shaped = false;
  const lines: Record<string, string[]> = { what: [], contract: [], watch: [], loose: [], other: [] }, plain: string[] = [];
  const flush = (to: string) => { const t = para.replace(/\s+/g, ' ').trim(); para = ''; if (t) { lines[to].push(t); if (to !== 'watch' && to !== 'other') plain.push(t); } };
  for (const t of tokenize(typeof html === 'string' ? html : '')) {
    if (t.t === 'start') {
      if (t.name === 'h2' || t.name === 'h3') { head = true; hd = ''; }
      else if (t.name === 'div' && !co && ['watch', 'risk', 'key'].includes((t.attrs['data-callout'] ?? '').toLowerCase())) { flush(sec ?? 'loose'); co = t.attrs['data-callout'].toLowerCase(); depth = 1; if (co === 'watch') { out.watch.on = true; shaped = true; } else if (co === 'risk') out.risk = true; }
      else if (t.name === 'div' && co) depth++;
    } else if (t.t === 'end') {
      if ((t.name === 'h2' || t.name === 'h3') && head) { head = false; const k = hd.trim().toLowerCase(); sec = k === 'what it does' ? 'what' : k === 'contract' ? 'contract' : null; shaped ||= sec !== null; }
      else if (t.name === 'div' && co) { flush(co === 'watch' ? 'watch' : 'other'); if (--depth === 0) co = null; }
      else if (['p', 'li'].includes(t.name)) flush(co ? (co === 'watch' ? 'watch' : 'other') : sec ?? 'loose');
    } else if (head) hd += t.v; else para += t.v;
  }
  flush(co ? (co === 'watch' ? 'watch' : 'other') : sec ?? 'loose');
  out.what = (shaped ? lines.what : [...lines.what, ...lines.loose]).join('\n');
  out.contract = lines.contract.join(' ');
  out.first = plain[0] ?? ''; out.other = lines.other.length > 0;
  out.watch.text = lines.watch.join('\n');
  return out;
}

/** Does a note say anything a reader sees (text, or a Watch / Risk callout)? */
export const hasCall = (n: CallNote | null | undefined) => !!n && !!(n.what || n.contract || n.first || n.watch.on || n.watch.text || n.risk || n.other);
/** A body past its limit (the message), or null. The limit is on all the text of the note, not on its fields: a call note is a rich document now. */
export function callTooLong(n: CallNote): string | null {
  const len = n.what.length + n.contract.length + n.watch.text.length;
  return len > CALL_MAX.body ? `a call note is longer than ${CALL_MAX.body} characters` : null;
}
