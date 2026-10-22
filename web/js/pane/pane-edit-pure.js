// Editing the About in the pane (0.33.0, frame 19d), the rules with no DOM: the section template of an empty about, the toolbar's insertions (Markdown syntax only:
// the stored form stays Markdown, there is no WYSIWYG), the dirty check and the edit a Save sends.

export const ABOUT_MAX = 20000; // core/markdown-lite.ts

/** The five conventional sections, inserted only into an empty about (an existing text is never touched). */
export const TEMPLATE = `## Capabilities
-

## Motivation
Why does this exist? What problem does it remove?

## Roles and responsibilities
- Owns:
- Does not own:

## Owners
Team, and who to ask.

## Open questions
- `;

/** Offer the template? Only when there is nothing written yet. */
export const wantsTemplate = (initial) => typeof initial !== 'string' || !initial.trim();

/** Where the caret goes after the template is inserted: the first bullet. */
export const TEMPLATE_CARET = TEMPLATE.indexOf('- ') + 2;

export const isDirty = (initial, value) => (initial ?? '') !== (value ?? '');

const MARK = { bold: '**', italic: '*', strike: '~~', code: '`' };
const lineStart = (v, i) => v.lastIndexOf('\n', i - 1) + 1;
const lineEnd = (v, i) => { const n = v.indexOf('\n', i); return n < 0 ? v.length : n; };

/**
 * applyFormat(value, start, end, kind) -> { value, start, end }: one toolbar button. kind: bold | italic | strike | code | h | ul | ol | link.
 * Wrapping kinds toggle (a selection already wrapped is unwrapped); line kinds toggle their prefix on every selected line.
 */
export function applyFormat(value, start, end, kind) {
  const v = String(value ?? '');
  if (MARK[kind]) {
    const m = MARK[kind], sel = v.slice(start, end);
    if (v.slice(start - m.length, start) === m && v.slice(end, end + m.length) === m) return { value: v.slice(0, start - m.length) + sel + v.slice(end + m.length), start: start - m.length, end: end - m.length };
    if (!sel) return { value: v.slice(0, start) + m + m + v.slice(end), start: start + m.length, end: start + m.length };
    return { value: `${v.slice(0, start)}${m}${sel}${m}${v.slice(end)}`, start: start + m.length, end: end + m.length };
  }
  if (kind === 'link') {
    const sel = v.slice(start, end) || 'text', ins = `[${sel}](https://)`, at = start + sel.length + 3;
    return { value: v.slice(0, start) + ins + v.slice(end), start: at, end: at + 'https://'.length };
  }
  if (kind === 'h' || kind === 'ul' || kind === 'ol') {
    const a = lineStart(v, start), b = lineEnd(v, end), lines = v.slice(a, b).split('\n');
    const has = kind === 'h' ? (l) => /^##\s/.test(l) : kind === 'ul' ? (l) => /^\s*[-*]\s/.test(l) : (l) => /^\s*\d+[.)]\s/.test(l);
    const strip = kind === 'h' ? (l) => l.replace(/^##\s+/, '') : kind === 'ul' ? (l) => l.replace(/^(\s*)[-*]\s+/, '$1') : (l) => l.replace(/^(\s*)\d+[.)]\s+/, '$1');
    const off = lines.every((l) => !l.trim() || has(l));
    let n = 0;
    const out = lines.map((l) => {
      if (off) return strip(l);
      if (!l.trim() && lines.length > 1) return l;
      n++;
      const bare = has(l) ? strip(l) : l;
      return kind === 'h' ? `## ${bare}` : kind === 'ul' ? `- ${bare}` : `${n}. ${bare}`;
    });
    const text = out.join('\n');
    return { value: v.slice(0, a) + text + v.slice(b), start: a, end: a + text.length };
  }
  return { value: v, start, end };
}

/** The line (0-based) and column of an offset, for the caret scroll. */
export const lineOf = (v, i) => v.slice(0, i).split('\n').length - 1;

/** The edit a Save sends for a pane target (the pure form of the component and subsystem forms' about-only edit). `about: ''` clears it. */
export function aboutEdit(target, about, header = {}) {
  const text = String(about ?? '').trim();
  if (text.length > ABOUT_MAX) throw Object.assign(new Error(`About is longer than ${ABOUT_MAX} characters`), { field: 'about' });
  if (target.kind === 'subsystem') return { kind: 'subsystem', key: target.key, about: text };
  return { kind: 'component', name: target.name, serviceKind: header.kind ?? 'service', about: text };
}
