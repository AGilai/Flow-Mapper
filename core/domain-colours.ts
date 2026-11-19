// Frame 31, domain colour families (pure, no DOM). Each top-level group (domain) takes one hue from the --cmp-1..8 palette; its subsystems and
// components are close OKLCH shades of it. `paintFamilies(theme, groups)` is the one function; `partColours` says which colour each drawn part takes;
// `familyCss` writes the shades as CSS custom properties for both themes, so a theme switch needs no redraw. Rule: design/mockups/frames/frame-31.html.

export type Theme = 'light' | 'dark';
/** One bucket of components of a domain: a subsystem (key '' = the domain's own components). */
export interface FamilySub { key: string; comps: string[] }
export interface FamilyGroup { key: string; subs: FamilySub[] }
export interface Shade { st: string; dom: string; sub: string; domKey: string; subKey: string }

/** The real palette (web/css/tokens.css), the surface, and the lightness clamp that keeps a stripe at 3:1 against the surface. */
export const PALETTE = {
  light: { s: '#ffffff', ln: '#e1e4ee', cmp: ['#9f5989', '#077fa8', '#5a805b', '#6e6ab2', '#ac5859', '#198585', '#846891', '#a5612e'], lo: 0.40, hi: 0.66, grey: '#7a8197', sg: 1 },
  dark: { s: '#1a1e29', ln: '#2c3243', cmp: ['#e095c7', '#5dbee9', '#96bd96', '#aaa7f4', '#ef9494', '#64c3c3', '#c2a4d0', '#e79e6b'], lo: 0.58, hi: 0.86, grey: '#8a90a6', sg: -1 },
};
export const HUE_ORDER = [2, 5, 3, 4, 8, 6, 1, 7]; // palette slots in a hue-spread order, so neighbouring domains never look alike
const SUB_L = [0, 0.07, -0.07, 0.13], COMP_L = [0, 2, -1, 3, -2, 4, -3], COMP_H = [0, 8, -4, 12, -8, 16, -12];

const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = (c: number) => { c = Math.max(0, Math.min(1, c)); return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055); };
const hex2rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgb2hex = (r: number[]) => '#' + r.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
export function toOk(hex: string): number[] {
  const [r, g, b] = hex2rgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const lab2lin = ([L, a, b]: number[]) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
};
const inGamut = (v: number[]) => v.every((x) => x >= -0.0005 && x <= 1.0005);
/** OKLCH -> hex; a colour outside the sRGB gamut loses chroma until it fits. */
export function oklch(L: number, C: number, h: number): string {
  const r = (h * Math.PI) / 180; let c = C;
  for (let i = 0; i < 40; i++) { const v = lab2lin([L, c * Math.cos(r), c * Math.sin(r)]); if (inGamut(v)) return rgb2hex(v.map(gam)); c *= 0.94; }
  return '#808080';
}
export const lch = (hex: string): number[] => { const [L, a, b] = toOk(hex); return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360]; };
/** Distance of two colours in OKLab. */
export const deltaE = (a: string, b: string) => { const x = toOk(a), y = toOk(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
const clamp = (L: number, P: { lo: number; hi: number }) => Math.max(P.lo, Math.min(P.hi, L));

/**
 * paintFamilies(theme, groups) -> Map component -> Shade. `groups`: the domains in the environment's order. Components in no group are not here (the caller draws them flat grey).
 * st = the component's shade (stripe, bar, dot, box), dom / sub = the domain's and the subsystem's colour (lifeline, bands, frames).
 */
export function paintFamilies(theme: Theme, groups: FamilyGroup[]): Map<string, Shade> {
  const P = PALETTE[theme], out = new Map<string, Shade>();
  groups.forEach((d, g) => {
    const hasSubs = d.subs.length > 1 || (d.subs[0]?.key ?? '') !== '';
    const base = P.cmp[HUE_ORDER[g % 8] - 1], [L0, C0, h0] = lch(base), wrap = Math.floor(g / 8) * 0.06;
    d.subs.forEach((sb, j) => {
      const sl = SUB_L[Math.min(j, 3)] * P.sg, cm = sl ? 0.9 : 1;
      const sub = oklch(clamp(L0 + sl + wrap, P), C0 * cm, h0 + 7 * j);
      sb.comps.forEach((c, k) => {
        const kk = Math.min(k, 6), step = (hasSubs ? 0.04 : 0.05) * COMP_L[kk] * P.sg;
        out.set(c, { st: oklch(clamp(L0 + sl + wrap + step, P), C0 * cm, h0 + 7 * j + COMP_H[kk]), dom: base, sub, domKey: d.key, subKey: sb.key });
      });
    });
  });
  return out;
}

/** The domains of a GET /subsystems payload (`subsystems: [{ key, components: [{ name, sub? }], subs? }]`): the domain's own components first, then each second level in order. */
export function groupsOf(payload: { subsystems?: any[] } | null | undefined): FamilyGroup[] {
  return (payload?.subsystems ?? []).filter((s) => s.components?.length).map((s) => {
    const at = new Map<string, FamilySub>();
    const bucket = (key: string) => { let b = at.get(key); if (!b) { b = { key, comps: [] }; at.set(key, b); } return b; };
    if ((s.components as any[]).some((c) => !c.sub)) bucket('');
    for (const x of s.subs ?? []) bucket(x.key);
    for (const c of s.components) bucket(c.sub ? `${s.key}/${c.sub}` : '').comps.push(c.name);
    return { key: s.key, subs: [...at.values()].filter((b) => b.comps.length) };
  });
}

export interface Parts { head: string | null; bar: string | null; dot: string | null; box: string | null; line: string | null; bandDomain: string | null; bandSub: string | null; custom: boolean }
/**
 * partColours({ mode, shade, slotColour, override }) -> the colour each part takes (frame 31, notes 3-6). `mode` 'component' = today: the stored slot, no family bands, a neutral lifeline.
 * 'domain': the component's shade for header stripe, activation bar, step dot and map box; the family colour for the lifeline and both band rows. A component with no shade
 * (no group) is flat neutral (`null`); `override` (a manual colour) replaces only the shade (stripe, bar, dot, box), never the line or the bands, and marks the part custom.
 */
export function partColours({ mode, shade = null, slotColour = null, override = null }: { mode: 'domain' | 'component'; shade?: Shade | null; slotColour?: string | null; override?: string | null }): Parts {
  const own = mode === 'domain' ? (shade?.st ?? null) : slotColour;
  const st = override ?? own;
  const fam = mode === 'domain' && shade ? shade : null;
  return { head: st, bar: st, dot: st, box: st, line: fam?.dom ?? null, bandDomain: fam?.dom ?? null, bandSub: fam?.sub ?? null, custom: override != null };
}

const idx = (m: Map<string, number>, k: string): number => { if (!m.has(k)) m.set(k, m.size); return m.get(k)!; };
/** The CSS for one environment: `--fc-<prefix>-<n>` (component shade), `--fd-` (domain), `--fs-` (subsystem), light, and dark by media and by data-theme; plus the var() of each name. */
export function familyCss(prefix: string, groups: FamilyGroup[]): { css: string; comp: Map<string, string>; dom: Map<string, string>; sub: Map<string, string> } {
  const comp = new Map<string, number>(), dom = new Map<string, number>(), sub = new Map<string, number>();
  const decl = (t: Theme) => {
    let s = `--fam-grey:${PALETTE[t].grey};`;
    for (const [name, sh] of paintFamilies(t, groups)) s += `--fc-${prefix}-${idx(comp, name)}:${sh.st};--fd-${prefix}-${idx(dom, sh.domKey)}:${sh.dom};` + (sh.subKey ? `--fs-${prefix}-${idx(sub, sh.subKey)}:${sh.sub};` : '');
    return s;
  };
  const light = decl('light'), dark = decl('dark');
  const css = `:root{${light}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}}}:root[data-theme="dark"]{${dark}}`;
  const vars = (m: Map<string, number>, p: string) => new Map([...m].map(([k, i]) => [k, `var(--${p}-${prefix}-${i})`] as [string, string]));
  return { css, comp: vars(comp, 'fc'), dom: vars(dom, 'fd'), sub: vars(sub, 'fs') };
}
