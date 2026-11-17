// Version compare and the Drivers query (#130). Versions are what a lockfile or package.json says:
// `5.3.2`, `^4.27.6`, `~4`, `v5`, `npm:ioredis@5.3.2`; tags (`latest`) and git or file URLs carry no major
// and parse to undefined. Compared on the numbers, majors first. Pure; shared with the browser.

export interface Ver { major: number; minor: number; patch: number; pre: string; /** How many of major, minor, patch were written (1 to 3). */ parts: 1 | 2 | 3 }

const NUM = /^[\^~<>=v\s]*(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?([-+][0-9A-Za-z.\-+]*)?\s*$/i;

/** `^4.27.6` → {4, 27, 6}; `4.x` → parts 1; undefined when there is no major (tag, git URL, file path, empty). */
export function parseVersion(v?: string | null): Ver | undefined {
  let s = (v ?? '').trim();
  if (!s || s.includes('://') || /^(git\+|file:|github:|workspace:|link:)/.test(s)) return undefined;
  if (s.startsWith('npm:')) s = s.slice(s.lastIndexOf('@') + 1);
  const m = NUM.exec(s);
  if (!m) return undefined;
  const num = (x?: string) => x !== undefined && /^\d+$/.test(x);
  const parts = (num(m[3]) ? 3 : num(m[2]) ? 2 : 1) as 1 | 2 | 3;
  return { major: Number(m[1]), minor: num(m[2]) ? Number(m[2]) : 0, patch: num(m[3]) ? Number(m[3]) : 0, pre: m[4]?.startsWith('-') ? m[4].slice(1) : '', parts };
}

/** Order of two versions: negative when a is older. A pre-release sorts before its release. */
export function compareVersions(a: Ver, b: Ver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch || (a.pre === b.pre ? 0 : !a.pre ? 1 : !b.pre ? -1 : a.pre < b.pre ? -1 : 1);
}

export type VerOp = '<' | '<=' | '>' | '>=' | '=';
/** One condition of a version query. `v` is as written, so `< 6` has parts 1 and compares the major only. `text` is how it is shown and put in the URL. */
export interface VerPred { op: VerOp; v: Ver; text: string }

/** Does `version` satisfy `p`? Compared at the precision the query wrote: `<= 6` includes 6.4.1, `> 6.2` means 6.3 and up, `= 6` is any 6.x. A version with no major matches nothing. */
export function satisfies(version: string | undefined | null, p: VerPred): boolean {
  const x = parseVersion(version);
  if (!x) return false;
  const a = [x.major, x.minor, x.patch].slice(0, p.v.parts), b = [p.v.major, p.v.minor, p.v.patch].slice(0, p.v.parts);
  let c = 0;
  for (let i = 0; i < a.length && !c; i++) c = a[i] - b[i];
  if (p.op === '=') return c === 0 && (p.v.parts < 3 || x.pre === p.v.pre);
  return p.op === '<' ? c < 0 : p.op === '<=' ? c <= 0 : p.op === '>' ? c > 0 : c >= 0;
}

export interface DriverQuery {
  component?: string; package?: string; versions: VerPred[];
  /** Words that are neither a known package nor a known component: matched against both by substring. */
  text: string[];
}
export interface Vocab { packages: string[]; components: string[] }

const OPS = ['>=', '<=', '<', '>', '='];
const isOp = (w: string) => OPS.includes(w);
const VWORD = /^v?(\d+(?:\.(?:\d+|x|\*)){0,2})$/i;

/** `mongoose < 6`, `redis 3`, `v3`, `3.x`, `>= 4 < 5`, `4.28.5`, `orders-svc` → component, package, version conditions. A bare version is "that major" (or that exact release when fully written). Words are classified against `vocab` (exact, case-insensitive); an unknown word stays in `text`. */
export function parseDriverQuery(q: string, vocab: Vocab = { packages: [], components: [] }): DriverQuery {
  const out: DriverQuery = { versions: [], text: [] };
  const words = q.trim().split(/\s+/).filter(Boolean).flatMap((w) => {
    const op = isOp(w) ? undefined : OPS.find((o) => w.length > o.length && w.startsWith(o));
    return op ? [op, w.slice(op.length)] : [w];
  });
  const low = (a: string[]) => new Map(a.map((x) => [x.toLowerCase(), x]));
  const pk = low(vocab.packages), cm = low(vocab.components);
  for (let i = 0; i < words.length; i++) {
    let op: VerOp = '=', word = words[i];
    const hasOp = isOp(word) && !!words[i + 1];
    if (hasOp) { op = word as VerOp; word = words[++i]; }
    const m = VWORD.exec(word);
    const ver = m ? parseVersion(m[1]) : undefined;
    if (m && ver && (hasOp || !pk.has(word.toLowerCase()))) {
      const n = m[1].replace(/\.(x|\*)$/i, '');
      out.versions.push({ op, v: ver, text: hasOp ? `${op} ${n}` : ver.parts < 3 ? `${n}.x` : n });
      continue;
    }
    const key = word.toLowerCase();
    if (!out.package && pk.has(key)) out.package = pk.get(key);
    else if (!out.component && cm.has(key)) out.component = cm.get(key);
    else out.text.push(word);
  }
  return out;
}

/** The query as a string again (the URL form): `mongoose < 6`. */
export const formatDriverQuery = (q: DriverQuery): string => [q.component, q.package, ...q.versions.map((p) => p.text), ...q.text].filter(Boolean).join(' ');
