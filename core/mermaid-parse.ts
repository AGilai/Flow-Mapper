// A tolerant parser for Mermaid `sequenceDiagram` text (0.27.2). Pure; it never throws: a line it does not understand becomes a warning
// with its line number. What it keeps: participants (with `as` aliases, actors), messages (sync / return / async), notes and the block
// (alt / opt / loop ...) a message sits in, the title, and a description from `%% Description:` comment lines.

export interface MmParticipant { id: string; label: string; actor: boolean }
export type MmKind = 'sync' | 'return' | 'async';
export interface MmMessage { from: string; to: string; label: string; kind: MmKind; line: number; block?: string }
export interface MmNote { over: string[]; text: string; line: number; after: number }   // after: how many messages came before it
export interface MmWarning { line: number; text: string }
export interface MmParsed { title?: string; description?: string; participants: MmParticipant[]; messages: MmMessage[]; notes: MmNote[]; warnings: MmWarning[] }

// longest first: `-->>` before `->>`, `--)` before `-)`
const ARROWS: [string, MmKind][] = [['<<-->>', 'return'], ['<<->>', 'sync'], ['-->>', 'return'], ['->>', 'sync'], ['--x', 'return'], ['-x', 'sync'], ['--)', 'async'], ['-)', 'async'], ['-->', 'return'], ['->', 'sync']];
const MESSAGE = new RegExp(`^(.+?)\\s*(${ARROWS.map(([a]) => a.replace(/[-)]/g, '\\$&')).join('|')})\\s*([+-])?\\s*([^:\\s>][^:]*?)\\s*:\\s*(.*)$`);
const BLOCKS = new Set(['alt', 'opt', 'loop', 'par', 'critical', 'break']);
const BRANCH = new Set(['else', 'and', 'option']);
const IGNORED = /^(autonumber|activate|deactivate|destroy|link|links|properties|details)\b/i;

/** `<br/>` becomes a space and `#59;` style entities are decoded (what the exporter escapes with). */
export const clean = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replace(/#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();

export function parseMermaid(text: string): MmParsed {
  const out: MmParsed = { participants: [], messages: [], notes: [], warnings: [] };
  const byId = new Map<string, MmParticipant>();
  const stack: { kind: string; branch: string }[] = [];
  const descLines: string[] = [];
  let header = false, inDesc = false;
  const warn = (line: number, t: string) => out.warnings.push({ line, text: t });
  const declare = (id: string, label?: string, actor?: boolean) => {
    const old = byId.get(id);
    if (old) { if (label) old.label = label; if (actor) old.actor = true; return old; }
    const p = { id, label: label || id, actor: !!actor };
    byId.set(id, p); out.participants.push(p);
    return p;
  };
  const block = () => { const b = [...stack].reverse().find((x) => x.kind !== 'box' && x.kind !== 'rect'); return b ? b.branch : undefined; };

  text.replace(/^﻿/, '').split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1, ln = raw.trim();
    if (!ln) { return; }
    if (ln.startsWith('%%')) {
      const body = ln.replace(/^%%\s*/, '');
      const d = /^description:\s*(.*)$/i.exec(body);
      if (d) { descLines.push(d[1]); inDesc = true; } else if (inDesc && !body.startsWith('{') && !/^flow:/i.test(body)) descLines.push(body); else inDesc = false;
      return;
    }
    inDesc = false;
    if (/^sequenceDiagram\b/i.test(ln)) { header = true; return; }
    if (!header) { header = true; warn(n, `no 'sequenceDiagram' line before the first statement; parsed anyway`); }
    let m: RegExpExecArray | null;
    if ((m = /^title\s*:?\s*(.*)$/i.exec(ln))) { out.title = clean(m[1]); return; }
    if ((m = /^(?:create\s+)?(participant|actor)\s+(\S+?)(?:@\{[^}]*\})?(?:\s+as\s+(.*))?$/i.exec(ln))) { declare(m[2], m[3] ? clean(m[3]) : undefined, m[1].toLowerCase() === 'actor'); return; }
    if ((m = /^note\s+(left of|right of|over)\s+([^:]+):\s*(.*)$/i.exec(ln))) {
      const over = m[2].split(',').map((s) => s.trim()).filter(Boolean);
      over.forEach((id) => declare(id));
      out.notes.push({ over, text: clean(m[3]), line: n, after: out.messages.length });
      return;
    }
    if (IGNORED.test(ln)) return;
    if ((m = /^(\w+)\b\s*(.*)$/.exec(ln)) && BLOCKS.has(m[1].toLowerCase())) { const k = m[1].toLowerCase(); stack.push({ kind: k, branch: `${k}${m[2] ? `: ${clean(m[2])}` : ''}` }); return; }
    if (m && BRANCH.has(m[1].toLowerCase()) && stack.length) { const k = m[1].toLowerCase(); stack[stack.length - 1].branch = `${k === 'and' ? 'par' : k}${m[2] ? `: ${clean(m[2])}` : ''}`; return; }
    if (m && ['rect', 'box'].includes(m[1].toLowerCase())) { stack.push({ kind: m[1].toLowerCase(), branch: '' }); warn(n, `'${m[1].toLowerCase()}' block is only visual: ignored (its messages are kept)`); return; }
    if (/^end\s*$/i.test(ln)) { if (stack.length) stack.pop(); else warn(n, `'end' without an open block: ignored`); return; }
    if (ln.startsWith('%%{')) return;
    if ((m = MESSAGE.exec(ln))) {
      const kind = ARROWS.find(([a]) => a === m![2])![1];
      const from = m[1].trim(), to = m[4].trim();
      declare(from); declare(to);
      const b = block();
      out.messages.push({ from, to, label: clean(m[5]), kind, line: n, ...(b ? { block: b } : {}) });
      return;
    }
    warn(n, `not understood, skipped: '${ln.length > 60 ? ln.slice(0, 57) + '...' : ln}'`);
  });
  if (stack.some((s) => s.kind !== 'box' && s.kind !== 'rect')) warn(text.split(/\r?\n/).length, `a block was not closed with 'end'`);
  const desc = descLines.join('\n').trim();
  if (desc) out.description = desc;
  return out;
}

/** What the paste step says under the box: counts and the warnings. */
export function summarize(p: MmParsed) {
  return { participants: p.participants.length, actors: p.participants.filter((x) => x.actor).length, messages: p.messages.filter((m) => m.kind !== 'return').length, returns: p.messages.filter((m) => m.kind === 'return').length, notes: p.notes.length, warnings: p.warnings.length };
}
