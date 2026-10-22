// A flow's Notes for agents: read the story of a flow and write it. Annotations like descriptions and comments: any environment, sealed ones included.

import { flowAnchor } from '../../../core/comments.ts';
import { commentHtml } from '../../../core/rich-text-md.ts';
import { plainText } from '../../../core/rich-text-text.ts';
import { getNotes, putNotes, history } from '../../store/notes.ts';
import { ASSISTANT } from '../../identity.ts';
import { type Tool, env, obj, envOf, draftArg } from './common.ts';

const flow = { service: { type: 'string' }, ingress: { type: 'string', description: 'Ingress id of the flow entry' } };

export const getNotesTool: Tool = {
  name: 'get_notes',
  description: "The Notes of a flow (service + ingress): one rich document per flow that tells its story (purpose, how it works, decisions, open questions). Returns the current `version` (0 when there are no notes yet), `author`, `createdAt`, plain `text` and sanitized `html` (headings h2/h3, lists, tables, step chips <span data-step=\"4\">, @[userId] mentions). version: read an older version instead. history: true adds the latest 30 versions (version, author, createdAt, restoredFrom). Read only.",
  inputSchema: obj({ env, ...flow, version: { type: 'integer', description: 'An older version to read' }, history: { type: 'boolean', description: 'Also list the latest versions' } }, ['service', 'ingress']),
  run: (c, a) => {
    const e = envOf(a), anchor = flowAnchor(a.service, a.ingress), d = getNotes(c.db, e, anchor, a.version ?? null);
    return { ...d, text: plainText(d.body), html: d.body, body: undefined, ...(a.history && { history: history(c.db, e, anchor).versions }) };
  },
};

export const setNotesTool: Tool = {
  name: 'set_notes',
  description: "Write the Notes of a flow as a new version (the whole document: read get_notes first and send it back changed). body: plain text with Markdown-lite (# / ## / ### headings, **bold**, ~~strike~~, '- ' lists, blank line = new paragraph), or HTML from the comment subset plus h2 h3 and the step chip <span data-step=\"4\"> (\"4-9\" for a range); to mention someone write @[userId] or @{Display Name} (see list_users). An empty body clears the notes (still a version). base_version: the version you read; a different current version is refused (STALE_NOTES) so you never overwrite someone's save; omit it to skip the check. author: your name (at most 80 characters; default \"Assistant\"). Writing the current text again changes nothing. Works in any environment. draft: an open draft, for a flow that exists only there.",
  inputSchema: obj({ env, ...flow, body: { type: 'string' }, base_version: { type: 'integer' }, author: { type: 'string' }, draft: draftArg }, ['service', 'ingress', 'body']),
  run: (c, a) => {
    const e = envOf(a), r = putNotes(c.db, c.view(e, a.draft || null).g, e, { anchor: flowAnchor(a.service, a.ingress), body: typeof a.body === 'string' ? notesMd(a.body) : a.body, baseVersion: a.base_version ?? null, author: a.author ?? ASSISTANT });
    return { anchor: r.anchor, version: r.version, author: r.author, createdAt: r.createdAt, ...(r.unchanged && { unchanged: true }) };
  },
};

/** Markdown-lite for Notes: `#`, `##` and `###` lines are headings, the rest is the comment Markdown-lite; text that holds HTML goes to the sanitizer as it is. */
export function notesMd(text: string): string {
  if (/<\/?(p|h[1-6]|ul|ol|li|table|div|span|b|strong|i|em|a|br)[\s/>]/i.test(text)) return text;
  const parts: string[] = [], buf: string[] = [];
  const flush = () => { if (buf.length) parts.push(commentHtml(buf.join('\n'))); buf.length = 0; };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) { flush(); const lvl = m[1].length === 1 ? 2 : m[1].length; parts.push(`<h${lvl}>${commentHtml(m[2]).replace(/^<p>|<\/p>$/g, '')}</h${lvl}>`); } else buf.push(line);
  }
  flush();
  return parts.join('');
}
