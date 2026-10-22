// Markdown-lite for `about` (0.30.2): the rich description of a component or a subsystem. Pure; no raw HTML passes (every piece of text is
// escaped), and the result goes through sanitize() like every rich text. Supported: `##` / `###` headings, paragraphs, **bold**, *italic*,
// ~~strike~~, `code`, fenced code, "- " and "1. " lists, [text](https://...) links. The sanitizer has no heading tags, so a heading is
// `<p><strong>text</strong></p>` (the UI styles a paragraph that is only a bold run as a heading).

import { esc, safeHref, sanitize } from './rich-text.ts';

export const ABOUT_MAX = 20000; // characters of Markdown, as written

/** Validates a value for `about`: undefined or a string of at most ABOUT_MAX characters; returns the problem or null. */
export const aboutProblem = (v: unknown): string | null =>
  v === undefined || v === null || (typeof v === 'string' && v.length <= ABOUT_MAX) ? null : typeof v !== 'string' ? 'about must be a string (Markdown)' : `about is longer than ${ABOUT_MAX} characters`;

function inline(raw: string): string {
  const codes: string[] = [];
  let s = raw.replace(/`([^`\n]+)`/g, (_m, c) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s)
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, t, u) => { const href = safeHref(u.replace(/&amp;/g, '&')); return href ? `<a href="${esc(href).replace(/"/g, '&quot;')}">${t}</a>` : t; })
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => codes[Number(i)]);
}

/** The sanitized HTML of an `about` text. Empty input gives ''. */
export function aboutHtml(md: unknown): string {
  if (typeof md !== 'string' || !md.trim()) return '';
  const out: string[] = [];
  let para: string[] = [], list: { tag: 'ul' | 'ol'; items: string[] } | null = null, fence: string[] | null = null;
  const flushPara = () => { if (para.length) out.push(`<p>${para.join('<br>')}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.tag}>`); list = null; };
  for (const line of md.slice(0, ABOUT_MAX * 2).replace(/\r\n?/g, '\n').split('\n')) {
    if (fence) { if (/^\s*```/.test(line)) { out.push(`<pre>${esc(fence.join('\n'))}</pre>`); fence = null; } else fence.push(line); continue; }
    if (/^\s*```/.test(line)) { flushPara(); flushList(); fence = []; continue; }
    const head = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line), li = /^\s*([-*]|\d+[.)])\s+(.*)$/.exec(line);
    if (head) { flushPara(); flushList(); out.push(`<p><strong>${inline(head[1])}</strong></p>`); }
    else if (li) { flushPara(); const tag = /\d/.test(li[1]) ? 'ol' : 'ul'; if (list && list.tag !== tag) flushList(); (list ??= { tag, items: [] }).items.push(inline(li[2])); }
    else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(inline(line.trim())); }
  }
  if (fence) out.push(`<pre>${esc(fence.join('\n'))}</pre>`);
  flushPara(); flushList();
  return sanitize(out.join(''));
}
