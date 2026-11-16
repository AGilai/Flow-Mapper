// Frame 28 (the Flows page's two rows, stage 1), the wiring, read from the sources (no DOM harness exists): two thin rows replace the old header, every old control has a new place,
// the View menu, the caption bar under the diagram, the floating zoom, the tab row's overflow, the right pane's strip, the design pill. The pure parts are in flow-bars.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const src = (f: string) => readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8');
const gone = (f: string) => existsSync(new URL(`../web/${f}`, import.meta.url)) === false;

test('two rows: the tab row, then the toolbar, then the draft bar; no page head; the list header says "Flows"', () => {
  const f = src('js/views/flows.js'), l = src('js/views/flow-list.js');
  assert.doesNotMatch(f, /pageHead\(/, 'no page head on the Flows page');
  assert.match(f, /main\.append\(h\('div\.content\.flush', flowsEl\)\)/);
  assert.match(f, /mainPane\.append\(strip\.el, toolbar\.el, toolbar\.below, empty\)/, 'row 1 tabs, row 2 toolbar');
  assert.match(l, /h\('div\.fl-head', h\('span\.fl-title'.*h\('b', 'Flows'\)/s);
  assert.match(src('js/views/flow-tabs.js'), /h\('div\.ftabs', scroll, menuBtn, cb\.end \?\? null\)/, 'the pill is at the right end of row 1');
  assert.match(src('js/views/flow-toolbar.js'), /seg, merged, tools, view, h\('span\.tb-more-w', moreBtn, ghost\), max\.button\(\), h\('span\.grow'\), \.\.\.extra\.filter\(Boolean\), modeSlot/, 'Inside | Full, the tab tools, View, the ⋯ menu, full screen, then View | Edit at the right end');
  const css = src('css/flow-bars.css');
  assert.match(css, /\.ftabs \{[^}]*height: 31px/); assert.match(css, /\.seq-toolbar\.tb2 \{[^}]*height: 25px/); assert.match(css, /flex-wrap: nowrap/, 'a row never wraps');
});

test('the old header is gone: no Collapse button, no H key, no title row, no About line, no old step bar', () => {
  const tv = src('js/views/flow-tab-view.js'), all = ['js/views/flows.js', 'js/views/flow-tab-view.js', 'js/views/flow-stepbar.js', 'js/views/flow-walk-view.js'].map(src).join('\n');
  assert.ok(gone('js/views/flow-headmin.js') && gone('css/flow-headmin.css') && gone('js/views/flow-headmin-pure.js'));
  assert.doesNotMatch(all, /createHeadMin|minimize-header|show-header|headKeyAction|nameEditor|head-strip/);
  assert.match(tv, /summary: \[\] \}\) : null; \/\/ frame 28/, 'the About region has no title row; it is the (i) popover');
  assert.match(tv, /h\('div\.flow-top', partial\.el\), body, walk\.caption, pane\?\.splitter, pane\?\.el/, 'the caption bar sits under the diagram, before the bottom pane');
  assert.doesNotMatch(src('js/views/flow-scenario-ui.js'), /Simple: each external call once, decisions flattened'\)|simple-caption/, 'the sentence is a tooltip, not a line');
  assert.match(src('js/views/flow-scenario-ui.js'), /sb\.title = `Simple: each external call once, decisions flattened/);
  assert.match(src('js/views/flow-tab-view.js'), /tools, more: moreFor, flowEdit, about:/, 'the tab hands the toolbar its tools, the ⋯ items, the Edit flow button and the About region');
});

test('where each old control went: rename on the tab, About in the (i), Export / Edit flow / links / Full screen in ⋯, A− A+ / Hide text / zoom elsewhere', () => {
  const tabs = src('js/views/flow-tabs.js'), f = src('js/views/flows.js'), more = src('js/views/flow-tab-more.js'), tb = src('js/views/flow-toolbar.js');
  assert.match(tabs, /'Rename this flow'/); assert.match(tabs, /dblclick/); assert.match(tabs, /'data-qa': 'flow-name-input'/, 'rename is an input in the tab');
  assert.match(f, /onRename: \(k, name\) =>[^\n]*saveName\(/);
  assert.match(tabs, /'About this flow', INFO/); assert.match(f, /createAboutPop/);
  assert.match(more, /'Edit flow…'/); assert.match(more, /exportItems/); assert.match(more, /Import Mermaid…/); assert.match(more, /safeUrl/);
  assert.match(tb, /label: 'Full screen'/); assert.match(tb, /'aria-label': 'More: export, edit flow, full screen'/);
  assert.match(src('js/design/mermaid-export.js'), /export function exportItems/); assert.match(src('js/views/flow-name.js'), /export async function saveName/);
  assert.match(src('js/views/flow-tab-view.js'), /h\('div\.zfloat', \{ 'data-qa': 'zoom-float' \}, zctl\.el\)/, 'zoom floats on the diagram');
  assert.doesNotMatch(f, /createZoomControl|zctl/, 'the page toolbar has no zoom any more');
  assert.match(src('css/flow-bars.css'), /\.zfloat \{ position: absolute; left: 12px; bottom: 12px/);
});

test('the View menu: every old toolbar option, the Descriptions section, a count of changed options, the same persistence', () => {
  const m = src('js/views/flow-view-menu.js'), f = src('js/views/flows.js');
  for (const qa of ['caption-switch', 'legend-switch', 'group-by-subsystem', 'data-stores', 'frontier', 'merge-check', 'squeeze', 'transport-hints', 'depth', 'hide-text']) assert.match(m, new RegExp(`'data-qa': '${qa}'|qa: '${qa}'`), qa);
  assert.match(m, /head\('Descriptions'\)/); assert.match(m, /sizeControl\(\)/, 'A− / A+'); assert.match(m, /stepMenu\.el/, 'step details'); assert.match(m, /'Reset to defaults'/);
  assert.match(m, /nonDefault\(/); assert.match(m, /count\.textContent = String\(n\)/);
  assert.match(f, /bands: \(v\) => \{ opts\.bands = v; bandSave\(v\)/); assert.match(f, /merge: \(v\) => \{ opts\.merge = v; mergeSave\(v\); reloadAll\(\)/); assert.match(f, /squeeze: \(v\) => \{ opts\.squeeze = v; sqSave\(v\)/);
  assert.match(f, /th: encodeHints\(opts\.th, isDesign\(\)\)/, 'the URL params are still written'); assert.match(f, /sb: encodeBar\(opts\.sb\), sd: encodeArrows/); assert.match(f, /depth: opts\.depth === 'all' \? null : opts\.depth/); assert.match(f, /frontier: opts\.frontier \? '1' : null/);
  assert.match(src('js/views/step-details-menu.js'), /inline = false/); assert.match(src('js/views/flow-textsize.js'), /export function sizeControl/);
});

test('the caption bar follows the step, can be hidden, edits the step; the player is in the toolbar; the legend moves to the caption', () => {
  const bar = src('js/views/flow-stepbar.js'), walk = src('js/views/flow-walk-view.js'), st = src('js/views/flow-caption-state.js');
  assert.match(bar, /Call · step \$\{n\}/); assert.match(bar, /mdBlock\(t\.desc\)/, 'the step description renders as Markdown');
  assert.match(bar, /'data-qa': 'edit-step'/); assert.match(bar, /'data-qa': 'add-description'/); assert.match(bar, /setCap\('caption', true\)/);
  assert.match(bar, /cnt-l.*cnt-s/s, 'the player has a long and a short count: "Step 2 of 3", "2/3"');
  assert.match(walk, /nav: bar\.nav, caption: bar\.caption, legendSlot: bar\.legendSlot/); assert.match(walk, /go\(n, \{ scroll = true, user = true \} = \{\}\) \{[^]*bar\.show\(st, cur, steps\.length\)/, 'every move of the step repaints the caption');
  assert.match(st, /setCap/); assert.match(st, /export function onCaps/);
  assert.match(src('js/views/flow-tab-view.js'), /walk\.legendSlot\.append\(capLegend\)/); assert.match(src('js/views/flow-draw-bands.js'), /h\('span\.lg-x'/);
  assert.match(src('css/flow-bars.css'), /\.capbar\[hidden\] \{ display: none; \}/);
});

test('levels: classes on the main column; the tab row never wraps, folds the rest into "N more", keeps the active tab; one dropdown below 760', () => {
  const f = src('js/views/flows.js'), css = src('css/flow-bars.css'), tabs = src('js/views/flow-tabs.js');
  assert.match(f, /levelOf\(mainPane\.clientWidth\)/); assert.match(f, /classList\.add\(`lv\$\{n\}`\)/); assert.match(f, /strip\.setLevel\(n\)/);
  assert.match(tabs, /planTabs\(\{ widths, avail: scroll\.clientWidth, active: state\.keys\.indexOf\(state\.active\)/); assert.match(tabs, /moreLabel\(hid, level\)/); assert.match(tabs, /activeShowsId\(level, many\)/);
  assert.match(css, /\.lv3 \.tb2 \.tb-scope, \.lv3 \.tb2 \.scn-seg, \.lv3 \.tb2 \.max-btn \{ display: none; \}/); assert.match(css, /\.lv3 \.tb2 \.tb-merge \{ display: inline-flex; \}/);
  assert.match(css, /\.lv2 \.vm-l, \.lv3 \.vm-l \{ display: none; \}/, 'View loses its label below 1100'); assert.match(css, /\.lv3 \.dz-pill b/, 'the pill is a dot below 760');
  assert.match(src('js/views/flow-toolbar.js'), /'data-qa': 'scope-detail'/);
});

test('the right pane: a 28px strip with the title top to bottom, close still works, the choice is remembered, it pushes the diagram at every width', () => {
  const p = src('js/components/panel.js'), css = src('css/flow-bars.css'), lane = src('css/flow-lane.css');
  assert.match(p, /KEYS\.pane/); assert.match(p, /writeCollapsed\(KEYS\.pane, collapsed\)/); assert.match(src('js/collapse.js'), /pane: 'collapse:flows-pane'/);
  assert.match(p, /'Close details'/); assert.match(p, /'data-qa': 'panel-collapse'/); assert.match(p, /'data-qa': 'panel-expand'/);
  assert.match(css, /\.flows-right > \.panel\.is-c \{ width: 28px !important;/); assert.match(css, /\.panel-strip-t \{ writing-mode: vertical-rl;/);
  assert.doesNotMatch(lane, /\.flows-right > \.panel\.open \{ position: absolute/, 'no overlay at narrow widths');
  assert.match(lane, /width: min\(var\(--panel\), 62%\) !important/, 'it pushes at narrow widths too');
});

test('the Flows list steps back to its strip while a pane is open (0.53.1) and returns to its own state', () => {
  const f = src('js/views/flows.js');
  assert.match(f, /watchPane\(flowsEl, list\.setPane\)/); assert.match(f, /flowsEl\.classList\.toggle\('list-c', list\.collapsed\(\)\)/);
  assert.match(src('css/sequence.css'), /\.flows\.list-c \{ grid-template-columns: 30px minmax\(0, 1fr\); \}/);
});

test('the design strip becomes a pill with a menu at the end of the tab row; View | Edit and the draft bar go into the Flows rows', () => {
  const s = src('js/design/design-strip.js'), p = src('js/design/design-pill.js'), m = src('js/main.js'), f = src('js/views/flows.js');
  assert.match(s, /mountDesignStrip\(main, host = null\)/); assert.match(s, /host\.pill\.replaceChildren\(pill\.el\); host\.mode\.replaceChildren/); assert.match(s, /host\.below\.replaceChildren/);
  assert.match(p, /compare/); assert.match(p, /visBadge\(meta\), items\.share/); assert.match(p, /items\.drafts/, 'Share, compare, drafts and the source line are in its menu');
  assert.match(m, /mountDesignStrip\(main, view\?\.designHost \?\? null\)/); assert.match(f, /designHost: \{ pill: pillSlot, mode: toolbar\.modeSlot, below: toolbar\.below \}/);
  assert.match(f, /plainPill\(\)/, 'a harvested environment gets the plain pill');
});

test('stylesheet and static build: flow-bars.css replaces flow-headmin.css; tokens only', () => {
  assert.match(src('index.html'), /css\/flow-bars\.css/); assert.doesNotMatch(src('index.html'), /flow-headmin/);
  assert.doesNotMatch(src('css/flow-bars.css'), /:\s*[^;{]*#[0-9a-fA-F]{3,8}\b[^;{]*;/, 'tokens only');
  assert.match(src('css/flow-max.css'), /body\.is-max \.rail, body\.is-max \.page-head, body\.is-max \.flows-list, body\.is-max \.ftabs, body\.is-max \.resizer \{ display: none; \}/, 'Maximize hides the tab row; the toolbar stays for the step player');
});

test('a cached About text does not break a re-made tab', () => {
  assert.match(src('js/views/flow-head.js'), /built = true; paint\(\);/);
});

test('QA: the View popover drops null children (it printed "null" without subsystems); a click on the active tab does not re-render it (so a double click renames)', () => {
  const m = src('js/views/flow-view-menu.js'), tabs = src('js/views/flow-tabs.js');
  assert.match(m, /pop\.replaceChildren\(\.\.\.\[[^]*\]\.filter\(Boolean\)\);/);
  assert.match(tabs, /closest\('\.x, \.tb-act, input'\) && key !== state\.active\) cb\.onActivate\(key\)/);
});

test('the call card opens or closes only on a user action: a repaint (paintCaps, View > Hide text) never flips it', () => {
  const s = src('js/views/flow-stepbar.js'), caps = s.match(/const paintCaps = \(\) => \{[\s\S]*?\n  \};/)![0];
  assert.doesNotMatch(s, /(?<![.\w])toggle\(/, 'no ambiguous toggle(): toggleCard() for the card, setExp() for the description');
  assert.match(caps, /if \(c\.hideText\) setExp\(false\)/);
  assert.doesNotMatch(caps, /toggleCard|cardOpen/, 'paintCaps never touches the card state');
  const set = s.match(/const setExp = [^\n]*/)![0];
  assert.doesNotMatch(set, /cardOpen|writeKey/, 'setExp leaves the card and its remembered state alone');
  assert.equal([...s.matchAll(/toggleCard\(\)/g)].length, 2, 'only the chevron and the header click call it');
});
