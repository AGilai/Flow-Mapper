// #146: in Colour by Domain a client app or an infra component in a group takes its family shade (cmpVar); Component mode and no group stay neutral; a manual colour wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cmpVar } from '../web/js/design/component-colors.js';
import { registerFamilies } from '../web/js/design/family-colours.js';
import { groupsOf, familyCss } from '../core/domain-colours.ts';

// family-install.js reaches core/ by its browser path, so the registration it does is repeated here
const installFamilies = (env: string, p: any) => { const groups = groupsOf(p), f = familyCss('t146', groups); registerFamilies(env, { groups, css: f.css, comp: f.comp, dom: f.dom, sub: f.sub, prefix: 't146', paint: () => new Map(), grey: {} } as any); };

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
const payload = { subsystems: [{ key: 'edge', components: [{ name: 'svc-a' }, { name: 'app-a' }, { name: 'vault-a' }], subs: [] }] };

test('#146 cmpVar: client-app and infra in a group take their shade in Domain mode', () => {
  store.clear(); installFamilies('e146', payload);
  assert.match(cmpVar('svc-a', 'service', null, 'e146')!, /^var\(--f/);
  assert.match(cmpVar('app-a', 'client-app', null, 'e146')!, /^var\(--f/);
  assert.match(cmpVar('vault-a', 'infra', null, 'e146')!, /^var\(--f/);
  assert.notEqual(cmpVar('app-a', 'client-app', null, 'e146'), cmpVar('svc-a', 'service', null, 'e146'), 'each component has its own shade');
});

test('#146 cmpVar: no group stays grey (null), Component mode stays neutral, a manual colour wins', () => {
  store.clear(); installFamilies('e146', payload);
  assert.equal(cmpVar('loose-app', 'client-app', null, 'e146'), null, 'no group: neutral as before');
  assert.equal(cmpVar('loose-infra', 'infra', null, 'e146'), null);
  store.set('flow-mapper.cmp-override', JSON.stringify({ e146: { 'app-a': 3 } }));
  assert.equal(cmpVar('app-a', 'client-app', null, 'e146'), 'var(--cmp-3)');
  store.clear(); store.set('flow-mapper.colorby', 'component');
  assert.equal(cmpVar('app-a', 'client-app', null, 'e146'), null, 'Component mode: neutral');
  assert.equal(cmpVar('vault-a', 'infra', null, 'e146'), null);
});
