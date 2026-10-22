// 0.36.0: flow tabs of different environments side by side. Keys with an env prefix and their back-compat, the cap across envs, the env chip,
// read-only gating of a tab of another env, the "unavailable" state, and a spy on every request a tab of another env makes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
// @ts-ignore plain JS modules shared with the browser
import * as T from '../web/js/views/flow-tabs-state.js';
// @ts-ignore
import { chipLabels } from '../web/js/env-info.js';
// @ts-ignore
import { tabChips, goneDescribe, noteText, goneText } from '../web/js/views/flow-xenv.js';
// @ts-ignore
import { backTarget, noteOpened } from '../web/js/views/flow-back-pure.js';
// @ts-ignore
import { state } from '../web/js/state.js';
// @ts-ignore
import { api, withDraft } from '../web/js/api.js';

// The modules that import `../../core/*.js` load through the hook (tests/web-loader.mjs).
register('./web-loader.mjs', import.meta.url);
const { pencils } = await import('../web/js/design/pencil.js');
const { createHostFor } = await import('../web/js/views/flow-tab-host.js');
const { createEnvCtx } = await import('../web/js/views/flow-env-ctx.js');
const { createItemStore } = await import('../web/js/action-items/store.js');

const q = (s: string) => new URLSearchParams(s);
const row = (queue: string, handler: string) => ({ queue, handler });

test('keys: an env prefix round-trips, `|` is escaped in names, an unprefixed key has no env', () => {
  const k = T.entryKey('api', 'in.x', null, null, 'sase-hld');
  assert.equal(k, 'sase-hld|api/in.x');
  assert.deepEqual([T.parseKey(k).env, T.parseKey(k).service, T.parseKey(k).ingress], ['sase-hld', 'api', 'in.x']);
  assert.equal(T.parseKey('api/in.x').env, null);
  const odd = T.entryKey('a|b', 'in|x', null, null, 'prod');
  assert.ok(!odd.slice('prod|'.length).includes('|'), 'a raw | in a name would fake a prefix');
  assert.deepEqual([T.parseKey(odd).env, T.parseKey(odd).service, T.parseKey(odd).ingress], ['prod', 'a|b', 'in|x']);
  assert.equal(T.parseKey('svc/in|x').env, null, 'a legacy key with a raw | later on is still an unprefixed key');
  assert.equal(T.fnKey('s', 'f', null, 'full', 'e1'), 'e1|fn:s/f!full');
  assert.equal(T.parseKey('e1|fn:s/f!full').scope, 'full');
  assert.equal(T.qual('prod', 'sase|a/b'), 'sase|a/b', 'a key that names an env keeps it');
  assert.equal(T.unqual('prod|a/b', 'prod'), 'a/b');
  assert.equal(T.unqual('sase|a/b', 'prod'), 'sase|a/b');
});

test('urls: old links read as the page env, mixed links keep each env, the URL omits the page env', () => {
  const old = T.decodeUrl(q('tabs=a/b,c/d&tab=a/b'), 'prod');
  assert.deepEqual(old.keys, ['prod|a/b', 'prod|c/d']);
  assert.equal(old.active, 'prod|a/b');
  assert.deepEqual(T.decodeUrl(q('service=a&ingress=b'), 'prod').keys, ['prod|a/b'], 'the single-flow links of 0.12');
  const mixed = T.decodeUrl(q('tabs=a/b,sase-hld%7Cc/d&tab=sase-hld%7Cc/d'), 'prod');
  assert.deepEqual(mixed.keys, ['prod|a/b', 'sase-hld|c/d']);
  assert.equal(mixed.active, 'sase-hld|c/d');
  assert.deepEqual(T.encodeUrl(mixed, 'prod'), { tabs: 'a/b,sase-hld|c/d', tab: 'sase-hld|c/d', ingress: null, fn: null, event: null, scope: null });
  assert.equal(T.encodeUrl({ keys: ['prod|a/b'], active: 'prod|a/b', closed: [] }, 'prod').tabs, 'a/b', 'one env: the link is as short as before');
  assert.deepEqual(T.decodeUrl(q('tabs=prod%7Ca/b'), 'prod').keys, ['prod|a/b'], 'a prefix naming the page env is the same tab');
  assert.deepEqual(T.decodeUrl(q('tabs=a/b'), null).keys, ['a/b'], 'no env given: keys are left as written');
});

test('switching the page env keeps the same tabs: retarget rewrites the prefixes', () => {
  const u = T.encodeUrl({ keys: ['prod|a/b', 'sase|c/d'], active: 'sase|c/d', closed: [] }, 'prod'); // what the URL holds in prod
  const patch = T.retarget(q(`tabs=${u.tabs}&tab=${u.tab}`), 'prod', 'sase');
  assert.equal(patch.tabs, 'prod|a/b,c/d');
  assert.equal(patch.tab, 'c/d');
  const back = T.decodeUrl(q(`tabs=${patch.tabs}&tab=${patch.tab}`), 'sase');
  assert.deepEqual(back.keys, ['prod|a/b', 'sase|c/d']);
  assert.equal(back.active, 'sase|c/d');
  assert.equal(T.tabsInEnv(q('tabs=a/b,sase%7Cc/d,sase%7Ce/f'), 'sase', 'prod'), 2, 'the delete dialog counts the tabs of that env');
  assert.equal(T.tabsInEnv(q('tabs=a/b'), 'prod', 'prod'), 1, 'unprefixed keys belong to the page env');
});

test('sub-flows inherit their parent env; the origin and the back trail are qualified', () => {
  const parent = 'sase|svc/in.x';
  const sub = T.subKey(row('sqs:q', 'h'), parent), full = T.fullKey('svc', 'in.y', parent, null);
  assert.equal(sub, 'sase|sqs:q/h@svc/in.x');
  assert.equal(T.parseKey(sub).env, 'sase');
  assert.equal(T.originOf(sub), parent);
  assert.equal(T.parseKey(full).origin, parent);
  assert.deepEqual(T.flowRoot(sub), { service: 'svc', ingress: 'in.x' });
  assert.ok(T.descends(sub, parent));
  let s = T.openTab(T.openTab(T.emptyState(), 'prod|a/b'), parent);
  s = T.openTab(s, sub);
  assert.deepEqual(s.keys, ['prod|a/b', parent, sub], 'the sub lands after its origin');
  // the Back trail (0.33.2) works on qualified keys: an origin is found by the key alone, a remembered opening (a zoom-in) by the map
  assert.deepEqual(backTarget(sub, new Map()), { key: parent, step: null });
  const from = noteOpened(new Map(), 'sase|svc/in.z!intra', parent, 4);
  assert.deepEqual(backTarget('sase|svc/in.z!intra', from), { key: parent, step: 4 });
  assert.equal(T.closeTab(s, sub).active, parent);
});

test('the 10-tab cap counts the tabs of every env; the same flow in two envs is two tabs', () => {
  let s = T.emptyState();
  for (let i = 0; i < 5; i++) s = T.openTab(s, `prod|a/in.${i}`);
  for (let i = 0; i < 5; i++) s = T.openTab(s, `sase|a/in.${i}`);
  assert.equal(s.keys.length, 10);
  assert.equal(T.canOpen(s, 'sase|b/in.new'), false);
  assert.equal(T.canOpen(s, 'prod|b/in.new'), false);
  assert.equal(T.canOpen(s, 'sase|a/in.0'), true, 'an open one switches');
  assert.equal(T.freeSlots(s), 0);
  const one = T.openTab(T.emptyState(), 'prod|a/in.0');
  assert.equal(T.findOpen(one, 'sase|a/in.0'), null, 'prod\'s tab is not sase\'s');
  assert.equal(T.findOpen(one, 'prod|a/in.0!intra'), 'prod|a/in.0', 'same flow, other scope, same env');
  const two = T.addTab(one, 'sase|a/in.0');
  assert.deepEqual(two.keys, ['prod|a/in.0', 'sase|a/in.0']);
  const rep = T.replaceActive(two, 'prod|a/in.9'); // a plain click: cur|key replaces the active tab (which is the foreign one)
  assert.deepEqual(rep.keys, ['prod|a/in.0', 'prod|a/in.9']);
  assert.equal(T.fitKeys(s, ['sase|x/in.1']).skipped, 1);
  assert.deepEqual(T.decodeUrl(q(`tabs=${Array.from({ length: 12 }, (_, i) => (i % 2 ? 'sase%7C' : '') + `a/in.${i}`).join(',')}`), 'prod').keys.length, 10);
  assert.equal(T.decodeUrl(q('tabs=a/b'), 'prod').closed.length, 0);
});

test('the list strip names the active flow\'s service, not its env', async () => {
  const { stripLabel } = await import('../web/js/collapse.js');
  assert.equal(stripLabel({ active: 'sase-hld|fn:orders/f!full' }), 'orders');
  assert.equal(stripLabel({ active: 'prod|api-gateway/in.x' }), 'api-gateway');
});

test('chips: up to 6 characters, collisions get a number, and only while 2+ envs are open', () => {
  assert.deepEqual([...chipLabels(['prod', 'sase-hld'])], [['prod', 'prod'], ['sase-hld', 'sase-h']]);
  const c = chipLabels(['design-b', 'design-a', 'prod']);
  assert.equal(c.get('design-a'), 'design');
  assert.equal(c.get('design-b'), 'desig2');
  assert.equal(c.get('prod'), 'prod');
  assert.equal(new Set(chipLabels(['staging-1', 'staging-2', 'staging-3', 'stag']).values()).size, 4, 'all distinct');
  assert.ok([...chipLabels(['staging-1', 'staging-2', 'staging-3']).values()].every((l: string) => l.length <= 6));
  assert.equal(chipLabels(['a-', 'a']).get('a-'), 'a2', 'a trailing dash is not left on a label');
  assert.equal(tabChips(['prod|a/b', 'prod|c/d']).size, 0, 'one env: no chips');
  const m = tabChips(['prod|a/b', 'sase-hld|a/b', 'prod|c/d']);
  assert.deepEqual([...m.values()], ['prod', 'sase-h', 'prod']);
});

test('read only: a tab of another env gets no pencils and no edit forms; a tab of the page env keeps the page host', () => {
  const none = pencils({ readOnly: true });
  assert.equal(none.button('flow', 'flow', {}), null);
  assert.equal(none.note('flow description', () => {}), null);
  assert.equal(none.about('x', {}), null);
  assert.equal(none.hint(), null);
  assert.doesNotThrow(() => none.resume());
  const base = { env: 'prod', edit: { flow() {} }, pen: { page: true }, readOnly: false, openEntry: () => 'base' };
  const calls: any[] = [];
  const { hostFor, penRO } = createHostFor(base, { drillIn: (e: any, env: string) => calls.push(['drill', e, env]), openIn: (e: any, env: string) => calls.push(['open', e, env]), paneIn: (t: any, env: string) => calls.push(['pane', t, env]) });
  const own = { env: 'prod', foreign: false };
  assert.equal(hostFor(own), base);
  const ctx = { env: 'sase', foreign: true, marks: { m: 1 }, subs: { s: 1 }, design: true, desc: { d: 1 }, nameOf: () => 'n', data: { traceFor: () => 't', describe: () => 'd' } };
  const h = hostFor(ctx);
  assert.equal(hostFor(ctx), h, 'one host per env');
  assert.deepEqual([h.env, h.readOnly, h.edit, h.pen === penRO, h.design, h.desc, h.marks], ['sase', true, null, true, true, ctx.desc, ctx.marks]);
  h.openEntry({ service: 's' }); h.openFlow({ service: 'f' }); h.openPane({ kind: 'component', name: 'c' });
  assert.deepEqual(calls.map((c) => c[2]), ['sase', 'sase', 'sase'], 'what a foreign tab opens stays in its env');
});

test('unavailable: a tab of an env that is not there is kept, described and not requested', () => {
  const s = T.decodeUrl(q('tabs=gone-env%7Ca/b,a/c'), 'prod');
  assert.deepEqual(s.keys, ['gone-env|a/b', 'prod|a/c'], 'an unknown prefix is a tab, not a dropped one');
  const d = goneDescribe('gone-env|a/b');
  assert.equal(d.gone, true);
  assert.match(d.tip, /gone-env not found/);
  assert.equal(noteText('sase'), 'Viewing sase. Switch to it to edit.');
  assert.match(goneText('gone-env'), /gone-env/);
  assert.equal(goneDescribe('???').gone, true, 'not even a key');
  const open = T.openTab(T.emptyState(), 'gone-env|a/b');
  assert.equal(T.closeTab(open, 'gone-env|a/b').keys.length, 0, 'its close button works');
});

// ---- every request a tab of another env makes goes to its own env, and never carries the page env's draft ----

function spy() {
  const seen: string[] = [], real = globalThis.fetch;
  (globalThis as any).fetch = async (url: string) => { seen.push(String(url)); return { ok: true, text: async () => '[]' }; };
  return { seen, restore: () => { (globalThis as any).fetch = real; } };
}

test('api routing: a foreign env context reads only its own env and never the page draft', async () => {
  const saved = { ...state };
  Object.assign(state, { env: 'design-x', draft: 'my-edits', mode: 'edit', compare: 'baseline', envs: ['prod', 'design-x', 'sase'], envMeta: [{ name: 'prod', kind: 'sealed' }, { name: 'design-x', kind: 'design', source: 'prod' }, { name: 'sase', kind: 'design', source: 'prod' }] });
  const s = spy(), g = globalThis as any;
  const target = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
  g.window ??= target; g.document ??= target; // the action item store listens for the app's events
  try {
    const ctxs = createEnvCtx(() => ({ frontier: false }));
    const ctx = ctxs.get('sase');
    assert.equal(ctx.foreign, true);
    await ctx.ready;
    await ctx.data.load('sase|svc/in.x').catch(() => {});
    await ctx.desc.refresh({ service: 'svc', ingress: 'in.x' });
    await createItemStore({ env: 'sase', anchor: 'flow:svc/in.x' }).refresh().catch(() => {});
    for (const call of [() => api.comments('sase', 'flow:svc/in.x'), () => api.notes('sase', 'flow:svc/in.x'), () => api.flowRelations('sase', { service: 'svc', ingress: 'in.x' }), () => api.mermaid('sase', 'svc', 'in.x'), () => api.eventType('sase', 'e'), () => api.endpoint('sase', 'svc', 'in.x'),
      () => api.store('sase', 's'), () => api.service('sase', 'svc'), () => api.system('sase'), () => api.subsystemMap('sase'), () => api.flowsThrough('sase', ['svc']), () => api.commentCounts('sase'), () => api.actionCounts('sase')]) await call().catch(() => {});
    assert.ok(s.seen.length > 12, `requests were made (${s.seen.length})`);
    assert.deepEqual(s.seen.filter((u) => !u.startsWith('/api/envs/sase/') && !u.startsWith('/api/mentions')), [], 'every request names the tab\'s env');
    assert.deepEqual(s.seen.filter((u) => /[?&]draft=/.test(u)), [], 'a foreign env never gets the page env\'s draft');
    assert.ok(s.seen.some((u) => u.includes('/marks') && u.includes('against=source')), 'a foreign design env shows its committed state against its source');
    // the control: the page's own env does carry its draft
    s.seen.length = 0;
    await ctxs.get('design-x').desc.refresh({ service: 'svc', ingress: 'in.x' });
    assert.ok(s.seen.every((u) => u.startsWith('/api/envs/design-x/')), s.seen.join('\n'));
    assert.ok(s.seen.some((u) => u.includes('/descriptions') && u.includes('draft=my-edits')), 'the page env\'s own reads carry its draft');
    assert.equal(withDraft('/api/envs/sase/trace', 'my-edits', 'design-x'), '/api/envs/sase/trace');
    assert.equal(withDraft('/api/envs/design-x/trace', 'my-edits', 'design-x'), '/api/envs/design-x/trace?draft=my-edits');
  } finally { s.restore(); Object.assign(state, saved); }
});

// ---- the hidden readers: the files a tab is built from must not read the page's env (or the page's marks) where the tab's own is meant ----

const WEB = join(import.meta.dirname, '..', 'web', 'js');
const tabPath = [
  ...readdirSync(join(WEB, 'views')).filter((f) => /^flow-/.test(f) && !/^(flow-list|flow-env-ctx|flow-tab-host)/.test(f)).map((f) => `views/${f}`),
  'views/flows.js', 'views/inventory-links.js', 'design/mermaid-export.js', 'design/service-info.js', 'design/component-colors.js', 'design/lane-slots.js', 'components/json-view.js', 'components/field-diff.js',
  ...['comments', 'notes', 'action-items', 'brackets', 'flow-pane'].flatMap((d) => readdirSync(join(WEB, d)).filter((f) => f.endsWith('.js')).map((f) => `${d}/${f}`)),
  ...['pane-component', 'pane-subsystem', 'pane-endpoints', 'pane-component-rows', 'pane-expanded'].map((f) => `pane/${f}.js`),
];
// What may name the page's env: a default for a missing env, the page's own env on purpose (the list, the design strip, edit forms which a foreign tab never gets).
const ALLOWED = [/\?\? state\.env/g, /= state\.env\b/g, /\b(isDesign|setServiceInfo)\(svcs?(, state\.env)?\)/g, /state\.env\)/g];
const PAGE_ENV_FILES: Record<string, string> = {
  'views/flows.js': 'the page\'s own list, its seeds and its own env',
  'views/flow-name.js': 'a rename: only reached by a tab that is not read only',
  'views/flow-boundary.js': 'the boundary note of a page-env flow',
};

test('hidden readers: no file of the tab path reads state.env except where the page env is meant', () => {
  const bad: string[] = [];
  for (const f of tabPath) {
    if (PAGE_ENV_FILES[f]) continue;
    let text = readFileSync(join(WEB, f), 'utf8').replace(/\/\/.*$/gm, '');
    for (const re of ALLOWED) text = text.replace(re, '');
    text.split('\n').forEach((line, i) => { if (/state\.env\b/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  }
  assert.deepEqual(bad, []);
});

test('hidden readers: the marks of a tab come from its host, not from the page (marksNow)', () => {
  const bad: string[] = [];
  for (const f of tabPath) {
    if (/field-diff|json-view/.test(f)) continue; // their default is the page's marks; a tab passes its own (flow-panel.js)
    readFileSync(join(WEB, f), 'utf8').replace(/\/\/.*$/gm, '').split('\n').forEach((line, i) => { if (/marksNow\(\)/.test(line) && !/host\.marks \?\? marksNow\(\)/.test(line) && !/^import/.test(line)) bad.push(`${f}:${i + 1}`); });
  }
  assert.deepEqual(bad, []);
  const panel = readFileSync(join(WEB, 'views/flow-panel.js'), 'utf8');
  assert.match(panel, /jsonView\(.*, marks\)/, 'the message panel hands its marks to the DTO view');
});
