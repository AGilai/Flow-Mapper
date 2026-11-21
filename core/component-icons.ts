// Legacy component icons (CR #144, frame 32): an optional `details.icon` on a component (service header), DEPRECATED since 0.68.0 by the `type` field
// (core/component-types.ts, frame 34). Still accepted and checked on ingest and in drafts; nothing in the UI draws it any more except as a legacy fallback for `resolveType`.
// Value: a built-in name (a file of web/icons/ without .svg), an `<svg ...>` string, or a `data:image/...` URL; at most MAX_ICON characters.
// Pure: the REST / MCP edit, the ingest check, the draft rules and the browser (picker, drawing) all use this file. Nothing here is injected as markup:
// the UI draws every icon as an <img> (a user's SVG as a data: URL), where scripts never run; the checks below also keep hostile files out of the store.

import { LEGACY_ICONS } from './component-types.ts';

export const MAX_ICON = 16 * 1024;

/** The built-in icon names of 0.65 - 0.67 (`details.icon`), kept so old manifests stay valid; the type catalogue (core/component-types.ts) replaces them in the UI. */
export const BUILTIN_ICONS: string[] = LEGACY_ICONS;

export type IconKind = 'builtin' | 'svg' | 'data';
const XML_DECL = /^\s*<\?xml[^>]*\?>\s*/i;
export const iconKind = (v: unknown): IconKind | null =>
  typeof v !== 'string' ? null : BUILTIN_ICONS.includes(v) ? 'builtin' : /^\s*(<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(v) ? 'svg' : /^data:image\//i.test(v) ? 'data' : null;

const HELP = () => `Use one of the built-in icons (${BUILTIN_ICONS.join(', ')}), an <svg> string, or a data:image/ URL, at most ${MAX_ICON / 1024} KB`;

/** The problem with an SVG document, or null: no script, no event handler attribute, no external reference. */
export function svgProblem(svg: string): string | null {
  if (!/<\/svg>\s*$/i.test(svg)) return 'the SVG must be one <svg>...</svg> document';
  if (/<\s*(script|foreignObject|iframe|embed|object|audio|video|link|meta)\b/i.test(svg) || /<!(doctype|entity)/i.test(svg)) return 'the SVG must not contain <script>, <foreignObject>, embedded objects or a DOCTYPE';
  if (/[\s"'/]on[a-z]+\s*=/i.test(svg)) return 'the SVG must not contain on...= event attributes';
  if (/javascript:/i.test(svg)) return 'the SVG must not contain javascript: URLs';
  for (const m of svg.matchAll(/(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const u = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!u.startsWith('#') && !/^data:image\/(png|jpe?g|gif|webp);/i.test(u)) return 'the SVG must not link to anything outside itself (href must be #id)';
  }
  if (/url\(\s*["']?\s*(?!#|data:image)/i.test(svg) || /@import/i.test(svg)) return 'the SVG must not load anything outside itself (url(), @import)';
  return null;
}

const DATA_URL = /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)((?:;[a-z0-9=.+-]+)*?)(;base64)?,/i;

/** The problem with a stored `icon` value, or null. */
export function iconProblem(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return `icon must be a non-empty string. ${HELP()}`;
  if (v.length > MAX_ICON) return `icon is ${v.length} characters; at most ${MAX_ICON} (${MAX_ICON / 1024} KB)`;
  const kind = iconKind(v);
  if (kind === 'builtin') return null;
  if (kind === 'svg') return svgProblem(v.replace(XML_DECL, '').trim());
  if (kind === 'data') {
    const m = DATA_URL.exec(v);
    if (!m) return `icon data URL must be data:image/(png|jpeg|gif|webp|avif|svg+xml),... ${HELP()}`;
    if (/svg/i.test(m[1])) {
      let text: string;
      try { text = m[3] ? atob(v.slice(m[0].length)) : decodeURIComponent(v.slice(m[0].length)); } catch { return 'icon data URL could not be decoded'; }
      return svgProblem(text.replace(XML_DECL, '').trim());
    }
    return null;
  }
  return `unknown icon '${v.length > 40 ? `${v.slice(0, 40)}...` : v}'. ${HELP()}`;
}
