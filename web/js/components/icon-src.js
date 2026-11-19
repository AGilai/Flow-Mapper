// What the drawing code needs of a component icon (CR #144), with no imports so every view and test can load it. The rules (what a valid value is) live in
// core/component-icons.ts and run on the server (BAD_ICON); a value that reaches the browser has passed them, and it is only ever drawn as an <img> / <image>
// (a user's SVG as a data: URL), so nothing here checks it again. tests/component-icons.test.ts keeps these functions in step with the core ones.

const XML_DECL = /^\s*<\?xml[^>]*\?>\s*/i;

/** 'builtin' (a bare name: a file of icons/), 'svg' (markup), 'data' (a data:image/ URL) or null. */
export const iconKind = (v) => (typeof v !== 'string' ? null : /^[a-z][a-z0-9-]*$/.test(v) ? 'builtin' : /^\s*(<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(v) ? 'svg' : /^data:image\//i.test(v) ? 'data' : null);

/** The header's icon (`details.icon`), or null. */
export const iconOf = (header) => { const v = header?.details?.icon ?? header?.icon; return iconKind(v) ? v : null; };

/** The URL an <img> takes (relative to web/). */
export function iconSrc(v, base = 'icons/') {
  const k = iconKind(v);
  if (k === 'builtin') return `${base}${v}.svg`;
  if (k === 'data') return v;
  if (k === 'svg') {
    const s = v.replace(XML_DECL, '').trim();
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(/^<svg[^>]*\sxmlns\s*=/i.test(s) ? s : s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"'))}`;
  }
  return null;
}

/** The tile behind the mark (frame 32): 'slate' (Vault), 'white-dark' (Kafka, MySQL: white in dark mode only), 'white' (a user's logo), or null. */
export const iconTile = (v) => { const k = iconKind(v); return v === 'vault' ? 'slate' : v === 'kafka' || v === 'mysql' ? 'white-dark' : k === 'svg' || k === 'data' ? 'white' : null; };
