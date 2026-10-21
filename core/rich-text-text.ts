// Plain text of a comment body, for MCP, search and event summaries: tags go, block ends become line breaks, list items get "- ",
// table cells are separated by " | ". Safe on any input (it reads tokens, never markup).

import { tokenize } from './rich-text-tokens.ts';

const BREAKS = new Set(['p', 'ul', 'ol', 'tr', 'table', 'blockquote', 'pre', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

export function plainText(html: string): string {
  if (typeof html !== 'string' || !html) return '';
  let out = '';
  for (const t of tokenize(html)) {
    if (t.t === 'text') out += t.v;
    else if (t.name === 'br') out += '\n';
    else if (t.t === 'start' && t.name === 'li') out += '\n- ';
    else if (t.t === 'start' && (t.name === 'td' || t.name === 'th') && /[^\n|]$/.test(out)) out += ' | ';
    else if (t.t === 'end' && BREAKS.has(t.name)) out += '\n';
  }
  return out.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
