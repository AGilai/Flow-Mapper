// A flow's Notes for agents: read the story of a flow and write it. Annotations like descriptions and comments: any environment, sealed ones included.

import { flowAnchor } from '../../../core/comments.ts';
import { commentHtml } from '../../../core/rich-text-md.ts';
import { plainText } from '../../../core/rich-text-text.ts';
import { getNotes, putNotes, history } from '../../store/notes.ts';
import { ASSISTANT } from '../../identity.ts';
import { ENV_DOC } from '../../../core/notes.ts';
import { callAnchor, parseCall, serializeCall, isCallAnchor } from '../../../core/call-notes.ts';
import { badRequest } from '../../errors.ts';
import { type Tool, env, obj, envOf, draftArg } from './common.ts';

const flow = { service: { type: 'string', description: "With ingress: the flow whose Notes (its flow doc) these are. Not with doc: 'env'." }, ingress: { type: 'string', description: 'Ingress id of the flow entry' }, doc: { type: 'string', enum: [ENV_DOC], description: "'env': the design doc of the environment (its HLD document: purpose, subsystems, decisions) instead of a flow's Notes; leave service and ingress out" },
  call: { type: 'object', description: "A call note (instead of a flow's Notes): the description of one call, shared by every flow that uses it. {from, to, op}: the names the step shows (service, queue or data store) and its label, e.g. {from: 'client', to: 'catalog-svc', op: 'GET /products/{id}/reviews'} or {from: 'catalog-svc', to: 'catalog-db', op: 'find reviews'}; leave service, ingress and doc out. Same names as in get_flow steps (from, to, label).", properties: { from: { type: 'string' }, to: { type: 'string' }, op: { type: 'string' } }, required: ['from', 'to', 'op'] } };
/** The anchor an argument set names: the design doc (`doc: "env"`) or a flow (`service` + `ingress`), never both and never neither. */
function anchorOfArgs(a: any): string {
  if (a.call !== undefined) {
    if (a.doc || a.service || a.ingress) throw badRequest('call: leave service, ingress and doc out');
    const c = a.call;
    if (!c || ![c.from, c.to, c.op].every((x) => typeof x === 'string' && x.trim())) throw badRequest('call needs from, to and op (strings): the names the step shows and its label');
    return callAnchor(c.from.trim(), c.to.trim(), c.op.trim());
  }
  if (a.doc !== undefined && a.doc !== ENV_DOC) throw badRequest(`doc must be "${ENV_DOC}" (the design doc) or left out`);
  if (a.doc) { if (a.service || a.ingress) throw badRequest('doc: "env" is the design doc of the environment: leave service and ingress out'); return ENV_DOC; }
  if (!a.service || !a.ingress) throw badRequest("pass service and ingress (a flow's Notes), or doc: \"env\" (the design doc)");
  return flowAnchor(a.service, a.ingress);
}

export const getNotesTool: Tool = {
  name: 'get_notes',
  description: "The Notes of a flow (service + ingress), a call note (call: {from, to, op}: the description of one call, with `call` = {what, contract, first, risk, watch:{on,text}} derived from the body in the answer, next to `html`: the call note is a full rich document; watch.on is true when the body holds a Watch callout), or the design doc of the environment (doc: \"env\"): one rich document per flow that tells its story (purpose, how it works, decisions, open questions). Returns the current `version` (0 when there are no notes yet), `author`, `createdAt`, plain `text` and sanitized `html` (headings h2/h3, lists, tables, step chips <span data-step=\"4\">, h1, callouts <div data-callout=\"key|watch|risk\" data-step=\"2\">, link chips <span data-ref=\"svc:orders-svc\">, <pre data-mermaid>, @[userId] mentions). version: read an older version instead. history: true adds the latest 30 versions (version, author, createdAt, restoredFrom). Read only.",
  inputSchema: obj({ env, ...flow, version: { type: 'integer', description: 'An older version to read' }, history: { type: 'boolean', description: 'Also list the latest versions' } }),
  run: (c, a) => {
    const e = envOf(a), anchor = anchorOfArgs(a), d = getNotes(c.db, e, anchor, a.version ?? null);
    return { ...d, text: plainText(d.body), html: d.body, body: undefined, ...(isCallAnchor(anchor) && { call: parseCall(d.body) }), ...(a.history && { history: history(c.db, e, anchor).versions }) };
  },
};

export const setNotesTool: Tool = {
  name: 'set_notes',
  description: "Write the Notes of a flow (service + ingress), or a call note (call: {from, to, op}; either `html` = the whole rich body (what the UI edits: headings, lists, tables, code, callouts; a Watch callout puts a ! on the diagram, a Risk callout a red !), or body = What it does plus contract and watch, written into the usual shape; the same call reads the same in every flow), or the design doc of the environment (doc: \"env\", no service or ingress), as a new version (the whole document: read get_notes first and send it back changed). body: plain text with Markdown-lite (# / ## / ### headings, **bold**, ~~strike~~, '- ' lists, blank line = new paragraph), or HTML from the comment subset plus h2 h3 and the step chip <span data-step=\"4\"> (\"4-9\" for a range), h1, callouts <div data-callout=\"key|watch|risk\" data-step=\"2\"><p>text</p></div> (flow doc: one point tied to one step), link chips <span data-ref=\"svc:SERVICE\"> / \"flow:SERVICE/INGRESS\" / \"step:SERVICE/INGRESS#N\", <pre data-mermaid>source</pre>; to mention someone write @[userId] or @{Display Name} (see list_users). An empty body clears the notes (still a version). base_version: the version you read; a different current version is refused (STALE_NOTES) so you never overwrite someone's save; omit it to skip the check. author: your name (at most 80 characters; default \"Assistant\"). Writing the current text again changes nothing. Works in any environment. draft: an open draft, for a flow that exists only there.",
  inputSchema: obj({ env, ...flow, body: { type: 'string' }, html: { type: 'string', description: 'The whole document as HTML (the same subset as body; for a call note the full rich body: headings, lists, tables, code, links, callouts key|watch|risk). Instead of body.' }, contract: { type: 'string', description: 'With call: the one-line contract, e.g. "GET /products/{id}/reviews → 200 Review[] · 401 no session"' }, watch: { type: 'string', description: 'With call: a Watch text (the step then shows a ! on the diagram); empty or left out: no watch' }, base_version: { type: 'integer' }, author: { type: 'string' }, draft: draftArg }, []),
  run: (c, a) => {
    const e = envOf(a), anchor = anchorOfArgs(a);
    if (typeof a.body !== 'string' && typeof a.html !== 'string') throw badRequest('body (text) or html (a full document) is required');
    if (a.html !== undefined && typeof a.html !== 'string') throw badRequest('html must be a string');
    const call = isCallAnchor(anchor), fields = a.contract !== undefined || a.watch !== undefined;
    const body = call ? (typeof a.html === 'string' ? a.html : /<\/?(p|h[1-6]|div|ul|ol|table|pre)[\s>]/i.test(a.body) && !fields ? a.body : serializeCall({ what: a.body, contract: a.contract, watch: { on: !!a.watch, text: a.watch } })) // call note: `html` is the whole body; {body, contract, watch} are written into the usual shape
      : notesMd(typeof a.html === 'string' ? a.html : a.body, !!a.doc);
    const r = putNotes(c.db, c.view(e, a.draft || null).g, e, { anchor, body, baseVersion: a.base_version ?? null, author: a.author ?? ASSISTANT });
    return { anchor: r.anchor, version: r.version, author: r.author, createdAt: r.createdAt, ...(r.unchanged && { unchanged: true }), ...(r.warnings && { warnings: r.warnings }) };
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
