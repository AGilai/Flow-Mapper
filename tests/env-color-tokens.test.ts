// --env-1..10 exist in the light block and both dark blocks of tokens.css, and read: bar 3:1 on paper and surface, chip text 4.5:1 on its tint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dirname, '../web/css/tokens.css'), 'utf8');
const [lightCss, rest] = css.split('@media (prefers-color-scheme: dark)');
const [darkMedia, darkAttr] = rest.split(":root[data-theme='dark']");
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (c: number[]) => { const l = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (a: number[], b: number[], pa: number) => a.map((v, i) => v * pa + b[i] * (1 - pa));
const tok = (block: string, name: string) => (new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1] as string);

test('--env-N tokens: defined in all three blocks, with contrast', () => {
  for (const [theme, block] of [['light', lightCss], ['dark media', darkMedia], ['dark attr', darkAttr]] as const) {
    const dark = theme !== 'light';
    const paper = rgb(tok(block, 'paper')), surface = rgb(tok(block, 'surface')), inkC = rgb(tok(block, 'ink'));
    for (let n = 1; n <= 10; n++) {
      const bar = tok(block, `env-${n}`);
      assert.ok(bar, `--env-${n} in ${theme}`);
      assert.ok(new RegExp(`--env-${n}-ink:`).test(block), `--env-${n}-ink in ${theme}`);
      const b = rgb(bar);
      assert.ok(ratio(b, paper) >= 3 && ratio(b, surface) >= 3, `bar ${n} ${theme}: ${ratio(b, paper).toFixed(2)} / ${ratio(b, surface).toFixed(2)}`);
      const ink = dark ? mix(b, inkC, 0.4) : rgb(tok(block, `env-${n}-ink`)); // dark: the token is color-mix(bar 40%, ink)
      const r = ratio(ink, mix(b, surface, 0.16));
      assert.ok(r >= 4.5, `chip text ${n} ${theme}: ${r.toFixed(2)}`);
    }
  }
});
