// A flow's Notes for agents: read the story of a flow and write it. Annotations like descriptions and comments: any environment, sealed ones included.

import { flowAnchor } from '../../../core/comments.ts';
import { commentHtml } from '../../../core/rich-text-md.ts';
import { plainText } from '../../../core/rich-text-text.ts';
import { getNotes, putNotes, history } from '../../store/notes.ts';
import { ASSISTANT } from '../../identity.ts';
import { ENV_DOC } from '../../../core/notes.ts';
import { badRequest } from '../../errors.ts';
import { type Tool, env, obj, envOf, draftArg } from './common.ts';

const flow = { service: { type: 'string', description: "With ingress: the flow whose Notes (its flow doc) these are. Not with doc: 'env'." }, ingress: { type: 'string', description: 'Ingress id of the flow entry' }, doc: { type: 'string', enum: [ENV_DOC], description: "'env': the design doc of the environment (its HLD document: purpose, subsystems, decisions) instead of a flow's Notes; leave service and ingress out" } };
/** The anchor an argument set names: the design doc (`doc: "env"`) or a flow (`service` + `ingress`), never both and never neither. */
function anchorOfArgs(a: any): string {
  if (a.doc !== undefined && a.doc !== ENV_DOC) throw badRequest(`doc must be "${ENV_DOC}" (the design doc) or left out`);
  if (a.doc) { if (a.service || a.ingress) throw badRequest('doc: "env" is the design doc of the environment: leave service and ingress out'); return ENV_DOC; }
  if (!a.service || !a.ingress) throw badRequest("pass service and ingress (a flow's Notes), or doc: \"env\" (the design doc)");
  return flowAnchor(a.service, a.ingress);
}

export const getNotesTool: Tool = {
  name: 'get_notes',
  description: "The Notes of a flow (service + ingress), or the design doc of the environment (doc: \"env\"): one rich document per flow that tells its story (purpose, how it works, decisions, open questions). Returns the current `version` (0 when there are no notes yet), `author`, `createdAt`, plain `text` and sanitized `html` (headings h2/h3, lists, tables, step chips <span data-step=\"4\">, h1, callouts <div data-callout=\"key|watch|risk\" data-step=\"2\">, link chips <span data-ref=\"svc:orders-svc\">, <pre data-mermaid>, @[userId] mentions). version: read an older version instead. history: true adds the latest 30 versions (version, author, createdAt, restoredFrom). Read only.",
  inputSchema: obj({ env, ...flow, version: { type: 'integer', description: 'An older version to read' }, history: { type: 'boolean', description: 'Also list the latest versions' } }),
  run: (c, a) => {
    const e = envOf(a), anchor = anchorOfArgs(a), d = getNotes(c.db, e, anchor, a.version ?? null);
    return { ...d, text: plainText(d.body), html: d.body, body: undefined, ...(a.history && { history: history(c.db, e, anchor).versions }) };
  },
};

export const setNotesTool: Tool = {
  name: 'set_notes',
  description: "Write the Notes of a flow (service + ingress), or the design doc of the environment (doc: \"env\", no service or ingress), as a new version (the whole document: read get_notes first and send it back changed). body: plain text with Markdown-lite (# / ## / ### headings, **bold**, ~~strike~~, '- ' lists, blank line = new paragraph), or HTML from the comment subset plus h2 h3 and the step chip <span data-step=\"4\"> (\"4-9\" for a range), h1, callouts <div data-callout=\"key|watch|risk\" data-step=\"2\"><p>text</p></div> (flow doc: one point tied to one step), link chips <span data-ref=\"svc:SERVICE\"> / \"flow:SERVICE/INGRESS\" / \"step:SERVICE/INGRESS#N\", <pre data-mermaid>source</pre>; to mention someone write @[userId] or @{Display Name} (see list_users). An empty body clears the notes (still a version). base_version: the version you read; a different current version is refused (STALE_NOTES) so you never overwrite someone's save; omit it to skip the check. author: your name (at most 80 characters; default \"Assistant\"). Writing the current text again changes nothing. Works in any environment. draft: an open draft, for a flow that exists only there.",
  inputSchema: obj({ env, ...flow, body: { type: 'string' }, base_version: { type: 'integer' }, author: { type: 'string' }, draft: draftArg }, ['body']),
  run: (c, a) => {
    const e = envOf(a), r = putNotes(c.db, c.view(e, a.draft || null).g, e, { anchor: anchorOfArgs(a), body: typeof a.body === 'string' ? notesMd(a.body, !!a.doc) : a.body, baseVersion: a.base_version ?? null, author: a.author ?? ASSISTANT });
    return { anchor: r.anchor, version: r.version, author: r.author, createdAt: r.createdAt, ...(r.unchanged && { unchanged: true }) };
  },
};

/** Markdown-lite for Notes: `#`, `##` and `###` lines are headings (in the design doc `#` stays h1), the rest is the comment Markdown-lite; text that holds HTML goes to the sanitizer as it is. */
export function notesMd(text: string, designDoc = false): string {
  if (/<\/?(p|h[1-6]|ul|ol|li|table|div|span|pre|b|strong|i|em|a|br)[\s/>]/i.test(text)) return text;
  const parts: string[] = [], buf: string[] = [];
  const flush = () => { if (buf.length) parts.push(commentHtml(buf.join('\n'))); buf.length = 0; };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) { flush(); const lvl = m[1].length === 1 && !designDoc ? 2 : m[1].length; parts.push(`<h${lvl}>${commentHtml(m[2]).replace(/^<p>|<\/p>$/g, '')}</h${lvl}>`); } else buf.push(line);
  }
  flush();
  return parts.join('');
}
