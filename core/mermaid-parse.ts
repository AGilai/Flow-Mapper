// A tolerant parser for Mermaid `sequenceDiagram` text (0.27.4). Pure; it never throws: a line it does not understand becomes a warning
// with its line number. What it keeps: participants (with `as` aliases, actors), messages (sync / return / async), notes and the block
// (alt / opt / loop ...) a message sits in, the title, and a description from `%% Description:` comment lines.
// Linear in the text: no regex with a lazy prefix, and a line over MAX_LINE characters is skipped.

export interface MmParticipant { id: string; label: string; actor: boolean }
export type MmKind = 'sync' | 'return' | 'async';
/** One frame a statement sits in (0.33.1, #72): `id` is unique in the text; `condition` is the section (`alt`/`else`/`and`/`option` text). */
export interface MmGroup { id: string; kind: 'alt' | 'opt' | 'loop' | 'par' | 'critical' | 'break'; condition: string }
/** What a statement inherits from its place: the frames around it (outermost first), `rect` (any colour) as changed, `%% real:` as the bind key it really calls. */
export interface MmCtx { groups?: MmGroup[]; mark?: 'changed' | 'new'; real?: string }
/** A `rect` colour that reads as green (`rgb(r, g, b)`, `#rgb`, `#rrggbb`, a colour name with green in it) marks `new`; any other colour marks `changed`. */
export function rectMark(colour: string): 'new' | 'changed' {
  const c = colour.trim().toLowerCase();
  const rgb = /^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/.exec(c) ?? (/^#([0-9a-f]{3}|[0-9a-f]{6})\b/.exec(c) ? (() => { const h = /^#([0-9a-f]+)/.exec(c)![1], d = h.length === 3 ? [...h].map((x) => x + x) : h.match(/../g)!; return ['', ...d.map((x) => String(parseInt(x, 16)))]; })() : null);
  if (rgb) return +rgb[2] > +rgb[1] && +rgb[2] > +rgb[3] ? 'new' : 'changed';
  return /green/.test(c) ? 'new' : 'changed';
}
export interface MmMessage extends MmCtx { from: string; to: string; label: string; kind: MmKind; line: number; block?: string; response?: string; inner?: boolean; leaf?: boolean }   // response: the label of the return that answers a sync call; leaf (0.41.1, #83): an `inner` return in a branch that holds nothing else, kept as a step of its own
export interface MmNote extends MmCtx { over: string[]; text: string; line: number; after: number }   // after: how many messages came before it
export interface MmLink { label: string; url: string }
export interface MmWarning { line: number; text: string }
export interface MmParsed { title?: string; flow?: string; links: MmLink[]; description?: string; participants: MmParticipant[]; messages: MmMessage[]; notes: MmNote[]; warnings: MmWarning[] }

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
  const out: MmParsed = { participants: [], messages: [], notes: [], links: [], warnings: [] };
  const byId = new Map<string, MmParticipant>();
  const stack: { kind: string; branch: string; id: string; cond: string; sec: number; mark?: 'new' | 'changed' }[] = [], open: MmMessage[] = [];
  const held = new Map<string, number>(), deferred: { mm: MmMessage; call: MmMessage; key: string }[] = [];   // #83: what each section of a frame holds besides returns; the returns in a deeper frame than their call, decided at the end
  const secs = () => stack.filter((x) => BLOCKS.has(x.kind)).map((x) => `${x.id}#${x.sec}`);
  const hold = () => { for (const k of secs()) held.set(k, (held.get(k) ?? 0) + 1); };
  let pendingReal: string | undefined;
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
  const rectOf = () => [...stack].reverse().find((x) => x.kind === 'rect')?.mark;   // the innermost rect decides
  const ctx = (): MmCtx => {
    const groups = stack.filter((x) => BLOCKS.has(x.kind)).map((x) => ({ id: x.id, kind: x.kind as MmGroup['kind'], condition: x.cond }));
    return { ...(groups.length ? { groups } : {}), ...(rectOf() ? { mark: rectOf() } : {}) };
  };

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
      if (directive(body, n, out, warn, (r) => { pendingReal = r; })) return;
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
      hold(); out.notes.push({ over, text: clean(m[3]), line: n, after: out.messages.length, ...ctx() });
      return;
    }
    let real = pendingReal;
    const ci = ln.indexOf('%%');   // `A->>B: text %% real: <bind key>`: the directive at the end of the message line
    let mline = ln;
    if (ci > 0) { const d = /^%%\s*real:\s*(.*)$/.exec(ln.slice(ci)); if (d) { real = d[1].trim().slice(0, 300) || real; mline = ln.slice(0, ci).trim(); } }
    const msg = readMessage(mline);   // a line that reads as a message is one, whatever word it starts with (`loop->>B`, `alt-svc->>B`)
    if (msg) {
      declare(msg.from); declare(msg.to);
      const b = block();
      const mm: MmMessage = { from: msg.from, to: msg.to, label: clean(msg.text), kind: msg.kind, line: n, ...(b ? { block: b } : {}), ...ctx(), ...(real ? { real } : {}) };
      pendingReal = undefined;
      if (msg.kind !== 'return') hold();
      out.messages.push(mm);
      if (msg.kind === 'sync' && msg.from !== msg.to) { open.push(mm); if (open.length > 100) open.shift(); }   // bounded: a return looks at most 100 calls back
      else if (msg.kind === 'return') {   // a return answers the latest open call the other way round: its label is that call's response
        let k = open.length - 1;
        while (k >= 0 && !(open[k].from === msg.to && open[k].to === msg.from)) k--;
        if (k >= 0) {
          const inner = (mm.groups?.length ?? 0) > (open[k].groups?.length ?? 0);   // a return in a branch of a frame the call is not in (one per branch): the call stays open
          if (inner) { mm.inner = true; deferred.push({ mm, call: open[k], key: secs().at(-1)! }); }
          else { if (mm.label && mm.label.toLowerCase() !== 'return') open[k].response = mm.label; open.length = k; }
        } else if (mm.groups?.length && mm.label && mm.label.toLowerCase() !== 'return') warn(n, `return '${mm.label.slice(0, 40)}' in a branch answers no open call (a branch that holds only returns has no step to carry it): skipped`);
      }
      return;
    }
    if (IGNORED.test(ln)) return;
    const w = /^([A-Za-z]+)(?:\s+(.*))?$/.exec(ln), k = w?.[1].toLowerCase() ?? '', rest = w?.[2] ?? '';
    if (w && BLOCKS.has(k)) { stack.push({ kind: k, branch: `${k}${rest ? `: ${clean(rest)}` : ''}`, id: `g${n}`, cond: clean(rest), sec: 0 }); return; }
    if (w && BRANCH.has(k) && stack.length) { const top = stack[stack.length - 1]; top.branch = `${k === 'and' ? 'par' : k}${rest ? `: ${clean(rest)}` : ''}`; top.cond = clean(rest); top.sec++; return; }
    if (w && k === 'rect') { stack.push({ kind: k, branch: '', id: '', cond: '', sec: 0, mark: rectMark(rest) }); return; }   // the steps inside are marked: green = new, any other colour = changed
    if (w && k === 'box') { stack.push({ kind: k, branch: '', id: '', cond: '', sec: 0 }); warn(n, `'box' block is only visual: ignored (its messages are kept)`); return; }
    if (/^end\s*$/i.test(ln)) { if (stack.length) stack.pop(); else warn(n, `'end' without an open block: ignored`); return; }
    warn(n, `not understood, skipped: '${ln.length > 60 ? ln.slice(0, 57) + '...' : ln}'`);
  });
  for (const { mm, call, key } of deferred) {   // #83: a branch that holds only a return keeps it as a step; in a branch with other steps the first answer is the call's response
    if (!held.get(key)) mm.leaf = true;
    else if (mm.label && mm.label.toLowerCase() !== 'return' && !call.response) call.response = mm.label;
  }
  if (stack.some((s) => s.kind !== 'box' && s.kind !== 'rect')) warn(all.length, `a block was not closed with 'end'`);
  const desc = descLines.join('\n').trim();
  if (desc) out.description = desc;
  return out;
}

const LINK = /^https?:\/\/\S+$/;
/** The `%%` lines that mean something (0.33.1): `flow: <name>`, `link: <label> <url>`, `real: <bind key>` (for the next message). True when the line was one. */
function directive(body: string, n: number, out: MmParsed, warn: (n: number, t: string) => void, setReal: (r: string) => void): boolean {
  const d = /^(flow|link|real):\s*(.*)$/.exec(body);   // lower case only: the exporter's own `%% Flow: <name> (<where>)` header is a comment
  if (!d) return false;
  const v = d[2].trim();
  if (d[1] === 'flow') { if (v) out.flow = clean(v); }
  else if (d[1] === 'real') { if (v) setReal(v.slice(0, 300)); }
  else {
    const i = v.lastIndexOf(' '), url = v.slice(i + 1), label = v.slice(0, Math.max(i, 0)).trim();
    if (i < 0 || !label) warn(n, `'%% link:' needs a label and a URL: skipped`);
    else if (!LINK.test(url)) warn(n, `link '${label}': the URL must be http or https: skipped`);
    else if (label.length > 120) warn(n, `link label is longer than 120 characters: skipped`);
    else if (out.links.length >= 21) warn(n, `a flow has at most 21 links: skipped`);
    else out.links.push({ label: clean(label), url });
  }
  return true;
}

/** What the paste step says under the box: counts and the warnings. */
export function summarize(p: MmParsed) {
  return { participants: p.participants.length, actors: p.participants.filter((x) => x.actor).length, messages: p.messages.filter((m) => m.kind !== 'return').length, returns: p.messages.filter((m) => m.kind === 'return').length, notes: p.notes.length, groups: new Set([...p.messages, ...p.notes].flatMap((m) => (m.groups ?? []).map((g) => g.id))).size, marked: [...p.messages, ...p.notes].filter((m) => m.mark && m.kind !== 'return').length, links: p.links.length, warnings: p.warnings.length };
}
