// Frame 31 domain colour families: the palette rule, clamps, neighbour distance, and which colour each part gets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { paintFamilies, groupsOf, partColours, familyCss, deltaE, lch, PALETTE } from '../core/domain-colours.ts';

const G = [
  { key: 'platform', subs: [{ key: 'platform/identity', comps: ['auth-api', 'user-svc', 'token-svc'] }, { key: 'platform/objects', comps: ['objects-api', 'blob-svc'] }] },
  { key: 'agent', subs: [{ key: '', comps: ['agent-core', 'agent-planner', 'agent-tools', 'agent-memory', 'agent-runner'] }] },
];
const all = (t: 'light' | 'dark') => paintFamilies(t, G);

test('palette: deterministic, every component has a shade', () => {
  assert.deepEqual([...all('light')], [...all('light')]);
  assert.equal(all('light').size, 10);
  assert.match(all('dark').get('auth-api')!.st, /^#[0-9a-f]{6}$/);
});

test('palette: the domain takes the hue-spread order, the shades stay near it', () => {
  const p = all('light'), a = p.get('auth-api')!, b = p.get('agent-core')!;
  assert.equal(a.dom, PALETTE.light.cmp[1]); // slot 2 first
  assert.equal(b.dom, PALETTE.light.cmp[4]); // then slot 5
  const hd = (x: string, y: string) => { const d = Math.abs(lch(x)[2] - lch(y)[2]); return Math.min(d, 360 - d); };
  for (const [n, s] of p) assert.ok(hd(s.st, s.dom) < 40, `${n} stays in its family`);
});

test('palette: neighbours in a family differ, in both themes', () => {
  for (const t of ['light', 'dark'] as const) {
    const p = all(t);
    for (const sb of G.flatMap((g) => g.subs)) for (let i = 1; i < sb.comps.length; i++) assert.ok(deltaE(p.get(sb.comps[i - 1])!.st, p.get(sb.comps[i])!.st) > 0.02, `${t} ${sb.comps[i]}`);
  }
});

test('palette: lightness stays in the clamp (stripe keeps contrast), past 8 domains the order repeats', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ key: `d${i}`, subs: [{ key: `d${i}/a`, comps: [`c${i}a`, `c${i}b`] }, { key: `d${i}/b`, comps: [`c${i}c`] }, { key: `d${i}/c`, comps: [`c${i}d`] }, { key: `d${i}/d`, comps: [`c${i}e`] }] }));
  for (const t of ['light', 'dark'] as const) {
    const P = PALETTE[t];
    for (const [, s] of paintFamilies(t, many)) { const L = lch(s.st)[0]; assert.ok(L >= P.lo - 0.012 && L <= P.hi + 0.012, `${t} L=${L}`); }
  }
  assert.equal(paintFamilies('light', many).get('c8a')!.dom, PALETTE.light.cmp[1]); // 9th domain: slot 2 again
});

test('groupsOf: own components first, then the second levels, empty buckets dropped', () => {
  const g = groupsOf({ subsystems: [{ key: 'a', components: [{ name: 'x' }, { name: 'y', sub: 's' }], subs: [{ key: 'a/s' }, { key: 'a/empty' }] }, { key: 'none', components: [] }] });
  assert.deepEqual(g, [{ key: 'a', subs: [{ key: '', comps: ['x'] }, { key: 'a/s', comps: ['y'] }] }]);
});

test('parts: domain mode takes the shade for stripe, bar, dot, box and the family for line and bands', () => {
  const shade = all('light').get('auth-api')!;
  const p = partColours({ mode: 'domain', shade });
  assert.deepEqual([p.head, p.bar, p.dot, p.box], [shade.st, shade.st, shade.st, shade.st]);
  assert.deepEqual([p.line, p.bandDomain, p.bandSub, p.custom], [shade.dom, shade.dom, shade.sub, false]);
});

test('parts: an override replaces the shade only, never the line or the bands', () => {
  const shade = all('light').get('auth-api')!;
  const p = partColours({ mode: 'domain', shade, override: '#c2410c' });
  assert.deepEqual([p.head, p.bar, p.dot, p.box, p.custom], ['#c2410c', '#c2410c', '#c2410c', '#c2410c', true]);
  assert.deepEqual([p.line, p.bandDomain, p.bandSub], [shade.dom, shade.dom, shade.sub]);
  assert.equal(partColours({ mode: 'component', slotColour: '#111111', override: '#c2410c' }).head, '#c2410c'); // overrides apply in both modes
});

test('parts: no group is neutral, component mode is today (slot colour, no family)', () => {
  const n = partColours({ mode: 'domain', shade: null, slotColour: '#abcdef' });
  assert.deepEqual([n.head, n.line, n.bandDomain, n.bandSub], [null, null, null, null]);
  const c = partColours({ mode: 'component', shade: all('light').get('auth-api')!, slotColour: '#abcdef' });
  assert.deepEqual([c.head, c.bar, c.line, c.bandDomain], ['#abcdef', '#abcdef', null, null]);
});

test('css: both themes, one custom property per component, domain and subsystem', () => {
  const f = familyCss('e1', G);
  assert.equal(f.comp.size, 10); assert.equal(f.dom.size, 2); assert.equal(f.sub.size, 2);
  assert.match(f.css, /prefers-color-scheme: dark/);
  assert.match(f.css, /:root\[data-theme="dark"\]/);
  const v = f.comp.get('auth-api')!.slice(4, -1);
  assert.ok(f.css.includes(`${v}:${all('light').get('auth-api')!.st}`) && f.css.includes(`${v}:${all('dark').get('auth-api')!.st}`));
});

test('#140 hue: a domain with 12 subsystems x 5 components keeps every shade within 10 degrees of the domain hue, in both themes', () => {
  const big = [{ key: 'big', subs: Array.from({ length: 12 }, (_, j) => ({ key: `big/s${j}`, comps: Array.from({ length: 5 }, (_, k) => `s${j}c${k}`) })) }, G[1]];
  for (const t of ['light', 'dark'] as const) {
    const p = paintFamilies(t, big);
    assert.deepEqual([...p], [...paintFamilies(t, big)], 'deterministic');
    const P = PALETTE[t];
    for (const [n, s] of p) {
      const d = Math.abs(lch(s.st)[2] - lch(s.dom)[2]), hd = Math.min(d, 360 - d);
      assert.ok(hd <= 10, `${t} ${n} hue off by ${hd.toFixed(1)}`);
      const L = lch(s.st)[0]; assert.ok(L >= P.lo - 0.012 && L <= P.hi + 0.012, `${t} ${n} L=${L}`);
    }
    for (let j = 1; j < 12; j++) assert.ok(deltaE(p.get(`s${j - 1}c0`)!.sub, p.get(`s${j}c0`)!.sub) > 0.01, `${t} sub ${j} differs from the one before`);
  }
});
