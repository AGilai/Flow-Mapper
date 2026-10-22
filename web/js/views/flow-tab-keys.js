// Flow tab keys, pure: the stable, URL-safe name of a tab. No DOM.
//
// Keys:  entry  `service/ingress`  (+ `~event`) (+ `!intra`)   fn  `fn:service/function` (+ `~event`) (+ `!full`)
//        sub    `queue/handler@origin`               full  `full:service/ingress` (+ `@origin`)
// `origin` is the key of the tab the flow was opened from; it may itself contain `@` (the first `@` splits).
// Any key may start with an environment: `<env>|<key>` (`sase-hld|checkout/post-order`). Without one it means the environment of the page
// (`env=`), so old links read the same. The tab state holds qualified keys only; the URL leaves the prefix off for the page's own environment.
// An origin inside a key stays unprefixed: it is in the environment of the key it sits in (`originOf` gives it back qualified).

export const esc = (s) => String(s).replace(/[%,@~/!|\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
const unesc = (s) => decodeURIComponent(s);
const PREFIX = /^([^|/@~!:]+)\|/; // an environment name never holds these, so a key with a raw `|` further in is not read as prefixed

/** [env | null, the key without its environment]. */
function cut(key) {
  const m = PREFIX.exec(key);
  if (!m) return [null, key];
  try { return [unesc(m[1]), key.slice(m[0].length)]; } catch { return [null, key]; }
}
/** The environment a key names, or null when it is unprefixed. */
export const envOfKey = (key) => cut(String(key))[0];
/** The key without its environment prefix. */
export const bodyOf = (key) => cut(String(key))[1];
/** `key` in environment `env` (a key that names one already keeps it; null/undefined env leaves the key as it is). */
export const qual = (env, key) => (env == null || envOfKey(key) != null ? key : `${esc(env)}|${key}`);
/** `key` as the URL of a page in `env` writes it: the prefix only when the key is of another environment. */
export const unqual = (key, env) => (env != null && envOfKey(key) === env ? bodyOf(key) : key);

// The scope is part of an entry or fn key only when it is not the default (an ingress starts "full", a function "intra").
export const entryKey = (service, ingress, event, scope, env) => qual(env, `${esc(service)}/${esc(ingress)}${event ? `~${esc(event)}` : ''}${scope === 'intra' ? '!intra' : ''}`);
export const fnKey = (service, fn, event, scope, env) => qual(env, `fn:${esc(service)}/${esc(fn)}${event ? `~${esc(event)}` : ''}${scope === 'full' ? '!full' : ''}`);
/** `origin` is a tab key (qualified or not); the new key is in its environment. */
export const fullKey = (service, ingress, origin, event) => qual(origin ? envOfKey(origin) : null, `full:${esc(service)}/${esc(ingress)}${event ? `~${esc(event)}` : ''}${origin ? `@${bodyOf(origin)}` : ''}`);
/** A delivery (queue + handler) opened from the tab `origin`: it lives in the origin's environment. */
export const subKey = (row, origin) => qual(envOfKey(origin), `${esc(row.queue)}/${esc(row.handler)}@${bodyOf(origin)}`);

/** key -> { key, env: string|null, kind: 'entry'|'fn'|'full'|'sub', service?, ingress?, fn?, event?, queue?, handler?, origin? } | null (not a key). `origin` is qualified like the key. */
export function parseKey(key) {
  try {
    if (typeof key !== 'string' || !key || /[\s,]/.test(key)) return null;
    const [env, body] = cut(key);
    const at = body.indexOf('@');
    const head = at < 0 ? body : body.slice(0, at), raw = at < 0 ? null : body.slice(at + 1);
    if (at >= 0 && !raw) return null;
    const origin = raw && qual(env, raw);
    const sc = head.match(/^(.*?)(?:!(intra|full))?$/s), explicit = sc[2] ?? null;
    const [main, ev] = sc[1].split('~');
    const [a, b, ...rest] = main.split('/');
    if (rest.length || !a || !b) return null;
    const event = ev ? unesc(ev) : null;
    if (a.startsWith('full:')) return { key, env, kind: 'full', service: unesc(a.slice(5)), ingress: unesc(b), event, origin };
    if (origin) return /:/.test(a) ? { key, env, kind: 'sub', queue: unesc(a), handler: unesc(b), origin } : null;
    if (a.startsWith('fn:')) return { key, env, kind: 'fn', service: unesc(a.slice(3)), fn: unesc(b), event, scope: explicit ?? 'intra' };
    return /^[^:]+$/.test(a) ? { key, env, kind: 'entry', service: unesc(a), ingress: unesc(b), event, scope: explicit ?? 'full' } : null;
  } catch { return null; }
}
/** The same entry or fn tab at another scope (other kinds have none). */
export function withScope(key, scope) {
  const p = parseKey(key);
  return p?.kind === 'entry' ? entryKey(p.service, p.ingress, p.event, scope, p.env) : p?.kind === 'fn' ? fnKey(p.service, p.fn, p.event, scope, p.env) : key;
}
/** The flow a tab's descriptions belong to: { service, ingress } of its entry point (a sub-flow tab: of the flow it came from), null for a function tab. */
export function flowRoot(key) {
  const p = parseKey(key);
  if (!p) return null;
  if (p.kind === 'sub') return flowRoot(p.origin);
  return p.ingress ? { service: p.service, ingress: p.ingress } : null;
}
/** The key of the tab this one was opened from (same environment), or null. */
export const originOf = (key) => { const [env, body] = cut(String(key)), at = body.indexOf('@'); return at < 0 ? null : qual(env, body.slice(at + 1)); };
/** Is `key` opened (directly or through other tabs) from `origin`? */
export const descends = (key, origin) => { for (let o = originOf(key); o; o = originOf(o)) if (o === origin) return true; return false; };
