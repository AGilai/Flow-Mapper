// @mentions (0.31.0): the token `@[userId]` stored in a comment body. The sanitizer keeps it as text; renderers turn it into a chip.
// This module is the one place that knows the token format. User ids are `u_` + hex, but any [A-Za-z0-9_-]{1,40} is accepted so an
// unknown id still reads as a (dashed, unknown) chip.

export const MENTION_RE = /@\[([A-Za-z0-9_-]{1,40})\]/g;
export const mentionToken = (id: string) => `@[${id}]`;
/** The distinct user ids mentioned in a body (HTML or text), in order of first appearance. */
export function mentionIds(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(MENTION_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}
/** Re-points every token: `f(id)` answers the id the token should carry (merge). */
export const mapMentions = (body: string, f: (id: string) => string) => body.replace(MENTION_RE, (_m, id) => mentionToken(f(id)));
/** `@{Display Name}` (the MCP form) -> `@[id]` where `resolve` knows the name; unknown names stay as plain `@Display Name` text. */
export function resolveNamed(body: string, resolve: (name: string) => string | null): string {
  return body.replace(/@\{([^{}\n]{1,80})\}/g, (_m, n: string) => { const id = resolve(n); return id ? mentionToken(id) : `@${n.trim()}`; });
}
/** A text cut into plain pieces and mentions, for the renderer: `["Hi ", {id: "u_1"}, " please look"]`. */
export function splitMentions(text: string): (string | { id: string })[] {
  const out: (string | { id: string })[] = [];
  let at = 0;
  for (const m of text.matchAll(MENTION_RE)) { if (m.index! > at) out.push(text.slice(at, m.index)); out.push({ id: m[1] }); at = m.index! + m[0].length; }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
