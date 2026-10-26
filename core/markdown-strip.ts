// A plain one-line preview of a Markdown-lite text (#94): for list cards, tooltips and one-line spots, where rendered markup would be noise.
// Pure. Drops the syntax of core/markdown-lite.ts and keeps the words: **bold** / *italic* / _italic_ / ~~strike~~ / `code` -> the text,
// [text](url) -> text (the URL is dropped, whatever its scheme), heading / bullet / number markers and code fences dropped, line breaks -> spaces.

/** `md` as one line of plain text; non-strings give ''. Whitespace is collapsed and trimmed. */
export function stripMarkdown(md: unknown): string {
  if (typeof md !== 'string') return '';
  let s = md.replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => !/^\s*(```|~~~)\s*\w*\s*$/.test(l))
    .map((l) => l.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, '').replace(/\s+#+\s*$/, ''))
    .join(' ');
  s = s.replace(/!?\[([^\][]*)\]\([^)\s]*\)/g, '$1');
  for (let i = 0; i < 3; i++) { // nested emphasis: **bold *and italic***
    s = s.replace(/(\*\*|__)(?=\S)(.+?)\1/g, '$2')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?![*\w])/g, '$1$2')
      .replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?![_\w])/g, '$1$2');
  }
  return s.replace(/```|`/g, '').replace(/\s+/g, ' ').trim();
}
