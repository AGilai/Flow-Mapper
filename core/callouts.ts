// Callouts of a flow doc (Unreleased, frame 28f): `<div data-callout="key|watch|risk" data-step="2">` blocks inside a flow's Notes. Pure: the
// document is read as tokens, never as markup. The diagram's step badges come from here: a step with a callout carries a star (key) or an
// exclamation mark (watch, risk); a step with several kinds shows the strongest one (risk, then watch, then key).
// `parseRef` reads the reference chips (`<span data-ref="svc:...">`) the design doc and the flow doc link into the app with.

import { tokenize } from './rich-text-tokens.ts';
import { plainText } from './rich-text-text.ts';

export type CalloutKind = 'key' | 'watch' | 'risk';
export interface Callout { index: number; kind: CalloutKind; step: number | null; key: string | null; text: string }
/** What the diagram draws on a step: `star` for a key step, `bang` for a watch or a risk; `kinds` are all the callouts on it. */
export interface StepBadge { step: number; badge: 'star' | 'bang'; kind: CalloutKind; kinds: CalloutKind[]; callouts: number[] }

export const CALLOUT_LABEL: Record<CalloutKind, string> = { key: 'Key step', watch: 'Watch', risk: 'Risk' };
const KINDS: CalloutKind[] = ['key', 'watch', 'risk'];
const RANK: Record<CalloutKind, number> = { key: 0, watch: 1, risk: 2 };

/** The callouts of a body in reading order. `index` counts them from 0 (the order the reader draws them in). Only top-level `div[data-callout]` count. */
export function callouts(html: string): Callout[] {
  const out: Callout[] = [];
  let depth = 0, cur: { kind: CalloutKind; step: number | null; key: string | null } | null = null, body = '';
  const flush = () => { if (cur) out.push({ index: out.length, kind: cur.kind, step: cur.step, key: cur.key, text: plainText(body).replace(/\s+/g, ' ').trim() }); cur = null; body = ''; };
  for (const t of tokenize(typeof html === 'string' ? html : '')) {
    if (t.t === 'start' && t.name === 'div') {
      if (!cur) {
        const k = (t.attrs['data-callout'] ?? '').toLowerCase() as CalloutKind;
        if (KINDS.includes(k)) { const n = /^\d{1,4}$/.test(t.attrs['data-step'] ?? '') ? Number(t.attrs['data-step']) : 0; cur = { kind: k, step: n > 0 ? n : null, key: t.attrs['data-key'] || null }; depth = 1; }
      } else depth++;
    } else if (t.t === 'end' && t.name === 'div' && cur) { if (--depth === 0) flush(); }
    else if (cur) body += t.t === 'text' ? t.v : t.t === 'end' && ['p', 'li'].includes(t.name) ? ' ' : '';
  }
  flush();
  return out;
}

/** The badges for a flow of `steps` steps (0: not known yet, nothing is judged): one per step that has a callout, in step order. A callout on a step that is gone has no badge. */
export function badges(list: Callout[], steps = 0): StepBadge[] {
  const by = new Map<number, Callout[]>();
  for (const c of list) if (c.step && (steps <= 0 || c.step <= steps)) (by.get(c.step) ?? by.set(c.step, []).get(c.step)!).push(c);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([step, cs]) => {
    const kind = cs.reduce((m, c) => (RANK[c.kind] > RANK[m] ? c.kind : m), cs[0].kind);
    return { step, badge: kind === 'key' ? 'star' : 'bang', kind, kinds: [...new Set(cs.map((c) => c.kind))], callouts: cs.map((c) => c.index) };
  });
}

export interface Ref { kind: 'svc' | 'flow' | 'step'; service: string; ingress: string | null; step: number | null }
/** `svc:<service>`, `flow:<service>/<ingress>`, `step:<service>/<ingress>#<n>` -> its parts, or null (the sanitizer writes the same shapes). */
export function parseRef(v: string | null | undefined): Ref | null {
  const m = /^(svc|flow|step):(.+)$/.exec(v ?? '');
  if (!m) return null;
  if (m[1] === 'svc') return { kind: 'svc', service: m[2], ingress: null, step: null };
  const i = m[2].indexOf('/');
  if (i <= 0 || i === m[2].length - 1) return null;
  const service = m[2].slice(0, i), rest = m[2].slice(i + 1);
  if (m[1] === 'flow') return { kind: 'flow', service, ingress: rest, step: null };
  const h = rest.lastIndexOf('#'), n = Number(rest.slice(h + 1));
  return h > 0 && Number.isInteger(n) && n > 0 ? { kind: 'step', service, ingress: rest.slice(0, h), step: n } : null;
}
export const refText = (r: Ref) => (r.kind === 'svc' ? `svc:${r.service}` : r.kind === 'flow' ? `flow:${r.service}/${r.ingress}` : `step:${r.service}/${r.ingress}#${r.step}`);
