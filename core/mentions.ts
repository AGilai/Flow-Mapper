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
/** Replaces every token through `f(id)`; used by merge (re-point) and by renderers. */
export const mapMentions = (body: string, f: (id: string) => string) => body.replace(MENTION_RE, (_m, id) => f(id));
/** `@{Display Name}` (the MCP form) -> `@[id]` where `resolve` knows the name; unknown names stay as plain `@Display Name` text. */
export function resolveNamed(body: string, resolve: (name: string) => string | null): string {
  return body.replace(/@\{([^{}\n]{1,80})\}/g, (_m, n: string) => { const id = resolve(n); return id ? mentionToken(id) : `@${n.trim()}`; });
}
