// #114: the tab row on top absorbs the page head, the view toolbar stays under it, the Collapse button leads the title row, the minimized strip keeps the toolbar and has no popover.
// No DOM harness: source checks. (The View popover of #106 round 2 is gone: flow-headmin-pop.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const src = (f: string) => readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8');

test('the Flows header lives in the entry-point list; the page head is gone; the tab row starts the main column', () => {
  const f = src('js/views/flows.js'), l = src('js/views/flow-list.js');
  assert.doesNotMatch(f, /pageHead\(/, 'no page head on the Flows page');
  assert.match(f, /main\.append\(h\('div\.content\.flush', flowsEl\)\)/);
  assert.match(l, /h\('div\.fl-head', h\('span\.fl-title'.*h\('b', 'Flows'\).*entry points in .*envChip/s);
  assert.match(l, /`\$\{allPoints\.length\} entry points in \$\{env\}`/, 'the full sentence is the title');
  assert.match(l, /btn\)/, 'the collapse button is in the header');
  assert.match(f, /mainPane\.append\(strip\.el, toolbar, empty\)/, 'tab row first, toolbar under it');
  assert.match(src('js/views/flow-tabs.js'), /h\('div\.ftabs', cb\.lead \?\? null, prev, scroll, next, menuBtn\)/);
  assert.match(src('css/sequence.css'), /\.fl-head \{[^}]*height: 43px/, 'level with the 42px tab row and its line');
});

test('collapsed list: no band (width 0, no rotated label); a labelled "Show entry points" button leads the tab row and reopens it', () => {
  const f = src('js/views/flows.js'), css = src('css/sequence.css'), tabs = src('css/flow-tabs.css'), l = src('js/views/flow-list.js');
  assert.match(css, /\.flows\.list-c \{ grid-template-columns: 0 minmax\(0, 1fr\); \}/);
  assert.doesNotMatch(css + tabs + l, /writing-mode|fl-strip|fl-word/, 'no rotated band');
  assert.match(f, /'aria-expanded': 'false', 'aria-label': 'Show entry points', title: `Show entry points: \$\{list\.sentence\}`/);
  assert.match(f, /click: \(\) => list\.expand\(\)/);
  assert.match(f, /icon\('chev'\), h\('b', 'Flows'\), h\('span\.ft-dot', '·'\), envChip\(\)/);
  assert.match(tabs, /\.flows\.list-c \.ft-show \{ display: inline-flex; \}/);
  assert.match(tabs, /\.ft-show \{ display: none;/, 'hidden while the list is open');
  assert.match(l, /el\.inert = collapsed/, 'collapsed content is out of the tab order');
  assert.match(l, /writeCollapsed\(KEYS\.list, c\)/, 'the choice is stored (fm:collapse:flows-list)');
});

test('the toolbar holds the Harvested chip and an (i) tooltip for the bar hint; neither is a row of its own', () => {
  const f = src('js/views/flows.js');
  assert.match(f, /'data-qa': 'bar-hint'.*icon\('info'\)/);
  assert.doesNotMatch(f, /h\('span\.xs\.muted', 'Double-click a bar/);
  assert.match(f, /meta\.append\(\.\.\.\[host\.pen\.hint\(\)\]/);
  assert.doesNotMatch(f, /toolbar\.after\(/);
  assert.match(src('css/pencil.css'), /\.seq-toolbar \.pen-hint \{/);
});

test('minimized keeps the view toolbar and the page chrome; no View popover', () => {
  const css = src('css/flow-headmin.css'), hm = src('js/views/flow-headmin.js');
  assert.doesNotMatch(css, /body\.head-min[^{]*(seq-toolbar|pen-hint|page-head)/);
  assert.doesNotMatch(css, /hs-pop|hs-view/);
  assert.equal(existsSync(new URL('../web/js/views/flow-headmin-pop.js', import.meta.url)), false);
  assert.doesNotMatch(hm, /viewButton|closeViewPop|flow-headmin-pop/);
  assert.match(css, /\.flow-tab\.head-min > \.flow-top \{ display: none; \}/, "the flow's own header still folds");
});

test('Collapse / Expand buttons: labelled, accent-tinted, aria-expanded, first in the title row, icon only below 900px', () => {
  const hm = src('js/views/flow-headmin.js'), css = src('css/flow-headmin.css'), tv = src('js/views/flow-tab-view.js'), mx = src('css/flow-max.css');
  assert.match(hm, /'aria-expanded': 'true', 'aria-label': 'Collapse flow header'/);
  assert.match(hm, /icon\('chevup'\), h\('span\.hs-tl', 'Collapse'\)/);
  assert.match(hm, /'aria-expanded': 'false', 'aria-label': 'Expand flow header'/);
  assert.match(hm, /icon\('chevdown'\), h\('span\.hs-tl', 'Expand'\)/);
  assert.match(hm, /min\.setAttribute\('aria-expanded', String\(!on\)\)/);
  assert.match(hm, /\n    show, h\('span\.hs-id'/, 'Expand leads the strip');
  assert.match(tv, /summary: \[hm\.button\(\), root \? nameEditor/, 'Collapse is left of the flow name');
  assert.doesNotMatch(tv, /ts\.ui\.el, hm\.button\(\)/, 'no longer at the right end');
  assert.match(css, /\.hs-toggle \{[^}]*var\(--accent\)[^}]*var\(--accent-soft\)/);
  assert.match(css, /@media \(max-width: 900px\) \{ \.hs-tl \{ display: none; \}/);
  assert.match(mx, /\.fh-sum > \.hs-min \+ \* \{ display: none; \}/, 'Maximize still hides the title');
  assert.match(mx, /body\.is-max \.page-head, .*body\.is-max \.seq-toolbar, body\.is-max \.ftabs/, 'Maximize hides the tab row and the toolbar as before');
});

test('a cached About text does not break a re-made tab', () => {
  assert.match(src('js/views/flow-head.js'), /built = true; paint\(\);/);
});
