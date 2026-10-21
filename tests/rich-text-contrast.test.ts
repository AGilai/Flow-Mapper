// The comment colours (cc-* classes -> --cc-* tokens in web/css/comments.css) must read on the surface in both themes: at least 4.5:1 (UI-GUIDE section 8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PALETTE } from '../core/rich-text.ts';

const read = (f: string) => readFileSync(join(import.meta.dirname, '../web/css', f), 'utf8');
const tokens = read('tokens.css'), comments = read('comments.css');
const lum = (hex: string) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hexOf = (css: string, name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1] as string;

const [lightTokens] = tokens.split('@media (prefers-color-scheme: dark)');
const darkTokens = tokens.split(":root[data-theme='dark']")[1];
const [lightCc, , darkCc] = [comments.split('\n').find((l) => l.startsWith(':root {')) as string, '', comments.split('\n').find((l) => l.startsWith(":root[data-theme='dark']")) as string];
/** A --cc-* token in a theme: its own hex, or the --cmp-* token it points to. */
function colour(theme: 'light' | 'dark', name: string) {
  const own = (theme === 'dark' ? darkCc : lightCc).match(new RegExp(`--cc-${name}:\\s*([^;]+);`))?.[1].trim() ?? lightCc.match(new RegExp(`--cc-${name}:\\s*([^;]+);`))![1].trim();
  const v = /^var\(--(cmp-\d)\)$/.exec(own);
  return v ? hexOf(theme === 'dark' ? darkTokens : lightTokens, v[1]) : own;
}

test('every palette class has a text colour and a swatch', () => {
  for (const c of PALETTE) { assert.match(comments, new RegExp(`\\.${c}\\s*\\{\\s*color: var\\(--${c.replace('cc-', 'cc-')}\\)`), c); assert.match(comments, new RegExp(`\\.sw\\.${c}\\b`), `swatch ${c}`); }
});

test('comment colours have at least 4.5:1 on the surface, light and dark', () => {
  for (const c of PALETTE) {
    const n = c.replace('cc-', '');
    const l = ratio(colour('light', n), hexOf(lightTokens, 'surface')), d = ratio(colour('dark', n), hexOf(darkTokens, 'surface'));
    assert.ok(l >= 4.5, `light ${n} ${colour('light', n)} ${l.toFixed(2)}`);
    assert.ok(d >= 4.5, `dark ${n} ${colour('dark', n)} ${d.toFixed(2)}`);
  }
});
