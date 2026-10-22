// The `##` sections of an `about` text (0.33.0): the info pane draws each as a block, the expanded view as an accordion row, and the open-questions
// list collects the items of "Open questions". Pure; the section titles are conventions, not a schema (docs/plans/about.md).

export interface AboutSection { title: string; body: string; /** offset of the `##` line in the text (0 for the part before the first heading) */ offset: number; /** line number (0-based) of its first body line */ line: number; /** its lines as written, from `line` on */ raw: string[] }

const H2 = /^##\s+(.*?)\s*#*\s*$/;
const ITEM = /^\s*(?:[-*]|\d+[.)])\s+(.*\S)\s*$/;

/** Splits at `##` headings (a `###` stays inside its section; fenced code is never read as a heading). The text before the first `##` is a section with the title ''. */
export function aboutSections(md: unknown): AboutSection[] {
  if (typeof md !== 'string' || !md.trim()) return [];
  const out: AboutSection[] = [];
  let cur: { title: string; lines: string[]; offset: number; line: number } = { title: '', lines: [], offset: 0, line: 0 };
  let pos = 0, fence = false, n = 0;
  const flush = () => { if (cur.title || cur.lines.some((l) => l.trim())) out.push({ title: cur.title, body: cur.lines.join('\n').trim(), offset: cur.offset, line: cur.line, raw: cur.lines }); };
  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) fence = !fence;
    const m = fence ? null : H2.exec(line);
    if (m) { flush(); cur = { title: m[1], lines: [], offset: pos, line: n + 1 }; } else cur.lines.push(line);
    pos += line.length + 1; n++;
  }
  flush();
  return out;
}

export const isQuestions = (title: string) => /^open questions?$/i.test(title.trim());

/** The list items of every "Open questions" section of one text: [{ text, line }] (`line`: 0-based line of the item in the text). */
export function openQuestions(md: unknown): { text: string; line: number }[] {
  if (typeof md !== 'string') return [];
  const out: { text: string; line: number }[] = [];
  for (const s of aboutSections(md)) {
    if (!isQuestions(s.title)) continue;
    let fence = false;
    s.raw.forEach((l, i) => { if (/^\s*```/.test(l)) fence = !fence; const m = fence ? null : ITEM.exec(l); if (m) out.push({ text: m[1], line: s.line + i }); });
  }
  return out;
}
