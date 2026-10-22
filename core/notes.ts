// A flow's Notes (0.34.0), the pure part shared by the server, the static preview and the UI: the row shapes, the outline of headings,
// the step chips, the template, and the block diff History shows. A note is one document per (env, anchor) kept as versions: every Save is a
// new row, the latest is current, a restore writes a new version. Bodies are the sanitized subset of core/rich-text.ts with `{ notes: true }`.

import { plainText } from './rich-text-text.ts';
import { tokenize } from './rich-text-tokens.ts';

/** One version as the API returns it. `version` 0 is "no notes yet" (empty body, no author). */
export interface NotesDoc { anchor: string; version: number; body: string; author: string | null; authorId: string | null; createdAt: string | null; restoredFrom: number | null }
/** A line of History (no body: ask for the version). */
export interface NotesVersion { version: number; author: string; authorId: string | null; createdAt: string; restoredFrom: number | null; size: number }
export interface Heading { level: 2 | 3; text: string }
export interface StepRef { from: number; to: number }

/** The Notes a new flow starts from: the four headings of the frame 20b template. The editor puts a grey hint under each. */
export const TEMPLATE = [['Purpose', 'Why does this flow exist? One or two sentences.'], ['How it works', 'The path in words. Type "step" and a number to link a step.'], ['Decisions', 'What was decided and why. @ mentions the people involved.'], ['Open questions', 'What is still unknown.']] as const;
export const templateHtml = () => TEMPLATE.map(([h]) => `<h2>${h}</h2><p><br></p>`).join('');

/** Has the document any content a reader sees? (an emptied one is a version with an empty body) */
export const hasNotes = (body: string | null | undefined) => !!body && !!plainText(body);

/** The headings of a body, in order (the outline). */
export function headings(html: string): Heading[] {
  const out: Heading[] = [];
  let at: { level: 2 | 3; text: string } | null = null;
  for (const t of tokenize(html)) {
    if (t.t === 'start' && (t.name === 'h2' || t.name === 'h3')) at = { level: t.name === 'h2' ? 2 : 3, text: '' };
    else if (t.t === 'text' && at) at.text += t.v;
    else if (t.t === 'end' && at && (t.name === 'h2' || t.name === 'h3')) { const text = at.text.replace(/\s+/g, ' ').trim(); if (text) out.push({ level: at.level, text }); at = null; }
  }
  return out;
}

/** `"4"` or `"4-9"` of a chip -> a range, or null. */
export function parseStepRef(v: string | null | undefined): StepRef | null {
  const m = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(v ?? '');
  if (!m) return null;
  const from = Number(m[1]), to = m[2] ? Number(m[2]) : from;
  return from > 0 && to >= from ? { from, to } : null;
}
export const stepRefText = (r: StepRef) => (r.to > r.from ? `steps ${r.from}–${r.to}` : `step ${r.from}`);

/**
 * A step reference against a flow that now has `n` steps: what remains of it, and `was` when it was cut ("steps 4\u20137 (was 4\u20139)"); null when no step of it remains.
 * With no steps known yet (`n` 0) nothing is judged: the reference stands.
 */
export function clampRef(r: StepRef, n: number): { from: number; to: number; was: StepRef | null } | null {
  if (n <= 0 || r.to <= n) return { ...r, was: null };
  return r.from > n ? null : { from: r.from, to: n, was: r };
}

/** The step chips of a body, in order. */
export function stepRefs(html: string): StepRef[] {
  const out: StepRef[] = [];
  for (const t of tokenize(html)) if (t.t === 'start' && t.name === 'span') { const r = parseStepRef(t.attrs['data-step']); if (r) out.push(r); }
  return out;
}

/** The top-level blocks of a sanitized body as HTML strings. The sanitizer's output is canonical (`<` and `>` in text and attributes are escaped), so a scan for tags is safe. */
export function splitBlocks(html: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0, loose = '';
  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)[^>]*>/g)) {
    const closing = m[1] === '/', name = m[2], end = m.index! + m[0].length;
    if (name === 'br') continue;
    if (depth === 0 && (closing || !['p', 'h2', 'h3', 'ul', 'ol', 'table', 'blockquote', 'pre'].includes(name))) continue; // inline markup at the top: it stays in the text before the next block
    if (depth === 0) { if (html.slice(from, m.index).trim()) loose += html.slice(from, m.index); from = m.index!; }
    depth += closing ? -1 : 1;
    if (depth === 0) { out.push(`${loose ? `<p>${loose}</p>` : ''}${html.slice(from, end)}`.trim()); loose = ''; from = end; }
  }
  const rest = html.slice(from).trim();
  if (rest) out.push(`<p>${rest}</p>`);
  return out.filter(Boolean);
}

export interface BlockOp { op: 'same' | 'del' | 'add'; html: string; head: boolean }
const key = (b: string) => `${/^<(h[23])/.exec(b)?.[1] ?? ''}|${plainText(b)}|${(b.match(/data-step="[^"]*"/g) ?? []).join()}`;

/** The block-level difference of two bodies (LCS over blocks): same, removed and added blocks in reading order. */
export function diffBlocks(before: string, after: string): BlockOp[] {
  const a = splitBlocks(before), b = splitBlocks(after), ka = a.map(key), kb = b.map(key);
  const n = a.length, m = b.length, t = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = ka[i] === kb[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out: BlockOp[] = [], op = (o: BlockOp['op'], html: string) => out.push({ op: o, html, head: /^<h[23]/.test(html) });
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ka[i] === kb[j]) { op('same', b[j]); i++; j++; } else if (i < n && (j === m || t[i + 1][j] >= t[i][j + 1])) op('del', a[i++]); else op('add', b[j++]);
  }
  return out;
}

/** "Changes" view: what changed, with the unchanged headings kept for context. */
export const changesOnly = (ops: BlockOp[]) => ops.filter((o) => o.op !== 'same' || o.head);
