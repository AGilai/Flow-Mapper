// 0.28.1: the system map's level (web/js/views/system-level.js, pure), the subsystems store and the sentence of a component edit that changes its subsystem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { levelOf, levelParam, showLevelControl, levelLabels } from '../web/js/views/system-level.js';
// @ts-ignore
import { createSubsystems } from '../web/js/design/subsystems-store.js';
// @ts-ignore
import { movesText } from '../web/js/design/forms/component-form.js';

test('the default level is the component level; level=subsystems is honoured only where the environment has subsystems', () => {
  assert.equal(levelOf(null, true), 'components');
  assert.equal(levelOf('subsystems', true), 'subsystems');
  assert.equal(levelOf('subsystems', false), 'components', 'a link into an environment without subsystems falls back');
  assert.equal(levelOf('domains', true), 'components');
});

test('the URL carries the subsystem level only', () => {
  assert.equal(levelParam('subsystems'), 'subsystems');
  assert.equal(levelParam('components'), null);
});

test('the control shows when the environment has at least one subsystem', () => {
  assert.equal(showLevelControl(createSubsystems({ subsystems: [] })), false);
  assert.equal(showLevelControl(createSubsystems({ subsystems: [{ key: 'a', label: 'A', components: [] }] })), true);
  assert.equal(showLevelControl(null), false);
});

test('the words come from the level names; Domains waits', () => {
  assert.deepEqual(levelLabels(['Subsystem', 'Component']), { subsystems: 'Subsystems', components: 'Components', domains: 'Domains' });
  assert.deepEqual(levelLabels(['Area', 'Domain', 'Part']), { subsystems: 'Areas', components: 'Parts', domains: 'Domains' });
  assert.deepEqual(levelLabels(), { subsystems: 'Subsystems', components: 'Components', domains: 'Domains' });
});

test('the subsystems store: one subsystem per component, "" for none, labels with a key fallback', () => {
  const s = createSubsystems({ subsystems: [{ key: 'net', label: 'Network', icon: 'network', components: [{ name: 'pop' }] }], notSet: ['x'] });
  assert.equal(s.subOf('pop'), 'net');
  assert.equal(s.subOf('x'), '');
  assert.equal(s.labelOf('net'), 'Network');
  assert.equal(s.labelOf('zzz'), 'zzz');
  assert.deepEqual(s.levels, ['Subsystem', 'Component']);
});

test('a component edit that changes the subsystem says what moves', () => {
  assert.equal(movesText('sxdns', 'Network (POP)', 'Platform'), 'Moves sxdns from Network (POP) to Platform');
});
