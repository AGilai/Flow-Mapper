// A tolerant parser for Mermaid `sequenceDiagram` text (0.27.4). Pure; it never throws: a line it does not understand becomes a warning
// with its line number. What it keeps: participants (with `as` aliases, actors), messages (sync / return / async), notes and the block
// (alt / opt / loop ...) a message sits in, the title, and a description from `%% Description:` comment lines.
// Linear in the text: no regex with a lazy prefix, and a line over MAX_LINE characters is skipped.

export interface MmParticipant { id: string; label: string; actor: boolean }
export type MmKind = 'sync' | 'return' | 'async';
export interface MmMessage { from: string; to: string; label: string; kind: MmKind; line: number; block?: string }
export interface MmNote { over: string[]; text: string; line: number; after: number }   // after: how many messages came before it
export interface MmWarning { line: number; text: string }
export interface MmParsed { title?: string; description?: string; participants: MmParticipant[]; messages: MmMessage[]; notes: MmNote[]; warnings: MmWarning[] }

// longest first: `-->>` before `->>`, `--)` before `-)`
const ARROWS: [string, MmKind][] = [['<<-->>', 'return'], ['<<->>', 'sync'], ['-->>', 'return'], ['->>', 'sync'], ['--x', 'return'], ['-x', 'sync'], ['--)', 'async'], ['-)', 'async'], ['-->', 'return'], ['->', 'sync']];
const BLOCKS = new Set(['alt', 'opt', 'loop', 'par', 'critical', 'break']);
const BRANCH = new Set(['else', 'and', 'option']);
const IGNORED = /^(autonumber|activate|deactivate|destroy|link|links|properties|details)(\s|$)/i;
/** Longer lines are skipped (a message is a line of text, not a document); it also keeps every scan below cheap. */
export const MAX_LINE = 2000;

/** `from ARROW [+-] to : text`, found by one scan for the first arrow whose rest reads as a message. */
function readMessage(ln: string): { from: string; to: string; kind: MmKind; text: string } | null {
  let colon = -2;   // -2: not looked up yet, -1: there is none
  for (let i = 0; i < ln.length; i++) {
    const c = ln[i];
    if (c !== '-' && c !== '<') continue;
    const arrow = ARROWS.find(([a]) => ln.startsWith(a, i));
    if (!arrow) continue;
    const from = ln.slice(0, i).trim();
    let j = i + arrow[0].length;
    while (ln[j] === ' ' || ln[j] === '\t') j++;
    if (ln[j] === '+' || ln[j] === '-') j++;
    while (ln[j] === ' ' || ln[j] === '\t') j++;
    if (colon !== -1 && colon < j) colon = ln.indexOf(':', j);   // the next colon is looked up only when the last one is behind us: linear
    if (colon === -1) return null;
    if (!from) continue;
    if (colon === j || ln[j] === '>') continue;
    const to = ln.slice(j, colon).trim();
    if (!to) continue;
    return { from, to, kind: arrow[1], text: ln.slice(colon + 1) };
  }
  return null;
}

/** `<br/>` becomes a space and `#59;` style entities are decoded (what the exporter escapes with). */
export const clean = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replace(/#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, ' ').trim();

export function parseMermaid(text: string): MmParsed {
  const out: MmParsed = { participants: [], messages: [], notes: [], warnings: [] };
  const byId = new Map<string, MmParticipant>();
  const stack: { kind: string; branch: string }[] = [];
  const descLines: string[] = [];
  let header = false, inDesc = false, inInit = false;
  const warn = (line: number, t: string) => out.warnings.push({ line, text: t });
  const declare = (id: string, label?: string, actor?: boolean) => {
    const old = byId.get(id);
    if (old) { if (label) old.label = label; if (actor) old.actor = true; return old; }
    const p = { id, label: label || id, actor: !!actor };
    byId.set(id, p); out.participants.push(p);
    return p;
  };
  const block = () => { const b = [...stack].reverse().find((x) => x.kind !== 'box' && x.kind !== 'rect'); return b ? b.branch : undefined; };

  const all = text.replace(/^﻿/, '').split(/\r?\n/);
  all.forEach((raw, i) => {
    const n = i + 1;
    if (raw.length > MAX_LINE) { warn(n, `line is longer than ${MAX_LINE} characters: skipped`); return; }
    const ln = raw.trim();
    if (inInit) { if (ln.includes('}%%')) inInit = false; return; }   // the rest of a multi-line %%{ ... }%% block
    if (!ln) return;
    if (ln.startsWith('%%{')) { if (!ln.includes('}%%')) inInit = true; return; }
    if (ln.startsWith('%%')) {
      const body = ln.replace(/^%%\s*/, '');
      const d = /^description:\s*(.*)$/i.exec(body);
      if (d) { descLines.push(d[1]); inDesc = true; } else if (inDesc && !/^flow:/i.test(body)) descLines.push(body); else inDesc = false;
      return;
    }
    inDesc = false;
    if (/^sequenceDiagram(\s|$)/i.test(ln)) { header = true; return; }
    if (!header) { header = true; warn(n, `no 'sequenceDiagram' line before the first statement; parsed anyway`); }
    let m: RegExpExecArray | null;
    // statements that start with a keyword and a space (or colon): they win over a message, so a note may hold an arrow
    if ((m = /^title(?:\s*:\s*|\s+|$)(.*)$/i.exec(ln))) { out.title = clean(m[1]); return; }
    if ((m = /^(?:create\s+)?(participant|actor)\s+(\S+?)(?:@\{[^}]*\})?(?:\s+as\s+(.*))?$/i.exec(ln))) { declare(m[2], m[3] ? clean(m[3]) : undefined, m[1].toLowerCase() === 'actor'); return; }
    if ((m = /^note\s+(left of|right of|over)\s+([^:]+):\s*(.*)$/i.exec(ln))) {
      const over = m[2].split(',').map((s) => s.trim()).filter(Boolean);
      over.forEach((id) => declare(id));
      out.notes.push({ over, text: clean(m[3]), line: n, after: out.messages.length });
      return;
    }
    const msg = readMessage(ln);   // a line that reads as a message is one, whatever word it starts with (`loop->>B`, `alt-svc->>B`)
    if (msg) {
      declare(msg.from); declare(msg.to);
      const b = block();
      out.messages.push({ from: msg.from, to: msg.to, label: clean(msg.text), kind: msg.kind, line: n, ...(b ? { block: b } : {}) });
      return;
    }
    if (IGNORED.test(ln)) return;
    const w = /^([A-Za-z]+)(?:\s+(.*))?$/.exec(ln), k = w?.[1].toLowerCase() ?? '', rest = w?.[2] ?? '';
    if (w && BLOCKS.has(k)) { stack.push({ kind: k, branch: `${k}${rest ? `: ${clean(rest)}` : ''}` }); return; }
    if (w && BRANCH.has(k) && stack.length) { stack[stack.length - 1].branch = `${k === 'and' ? 'par' : k}${rest ? `: ${clean(rest)}` : ''}`; return; }
    if (w && (k === 'rect' || k === 'box')) { stack.push({ kind: k, branch: '' }); warn(n, `'${k}' block is only visual: ignored (its messages are kept)`); return; }
    if (/^end\s*$/i.test(ln)) { if (stack.length) stack.pop(); else warn(n, `'end' without an open block: ignored`); return; }
    warn(n, `not understood, skipped: '${ln.length > 60 ? ln.slice(0, 57) + '...' : ln}'`);
  });
  if (stack.some((s) => s.kind !== 'box' && s.kind !== 'rect')) warn(all.length, `a block was not closed with 'end'`);
  const desc = descLines.join('\n').trim();
  if (desc) out.description = desc;
  return out;
}

/** What the paste step says under the box: counts and the warnings. */
export function summarize(p: MmParsed) {
  return { participants: p.participants.length, actors: p.participants.filter((x) => x.actor).length, messages: p.messages.filter((m) => m.kind !== 'return').length, returns: p.messages.filter((m) => m.kind === 'return').length, notes: p.notes.length, warnings: p.warnings.length };
}
