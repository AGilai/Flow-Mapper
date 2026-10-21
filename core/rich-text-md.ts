// Markdown-lite for the MCP tool add_comment: plain text with **bold**, ~~strike~~, "- " lists and blank-line paragraphs becomes the
// HTML subset. Text that already looks like HTML is taken as HTML. Either way the result goes through sanitize().

import { sanitize, esc } from './rich-text.ts';

const inline = (s: string) => esc(s).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/~~([^~\n]+)~~/g, '<s>$1</s>');

/** The sanitized HTML of a comment written by an assistant: HTML as HTML, anything else as Markdown-lite. */
export function commentHtml(input: string): string {
  if (typeof input !== 'string') return '';
  if (/<\/?[a-z][^>]*>/i.test(input)) return sanitize(input);
  const out: string[] = [];
  let list: string[] = [], para: string[] = [];
  const flushList = () => { if (list.length) out.push(`<ul>${list.map((l) => `<li>${l}</li>`).join('')}</ul>`); list = []; };
  const flushPara = () => { if (para.length) out.push(`<p>${para.join('<br>')}</p>`); para = []; };
  for (const line of input.replace(/\r\n?/g, '\n').split('\n')) {
    const li = /^\s*[-*] (.*)$/.exec(line);
    if (li) { flushPara(); list.push(inline(li[1])); } else if (!line.trim()) { flushList(); flushPara(); } else { flushList(); para.push(inline(line.trim())); }
  }
  flushList(); flushPara();
  return sanitize(out.join(''));
}
