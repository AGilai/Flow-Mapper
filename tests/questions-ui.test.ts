// 0.33.0 the Questions page, the pure part: the link that opens the pane scrolled to a question, the grouping by subsystem, the filter; and the rail entry rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { questionLink, groupQuestions, filterQuestions, plainQuestion } from '../web/js/views/questions-pure.js';

const Q = (kind: string, id: string, subsystem: string, text: string, index = 0) => ({ kind, id, label: id, subsystem, text, index, line: 3 });

test('a question links to the pane of its item with its index: a component on the component map, a subsystem on the subsystem level', () => {
  assert.deepEqual(questionLink(Q('component', 'policy-compiler', 'platform', 'x', 1)), { sel: 'svc:policy-compiler', question: 1 });
  assert.deepEqual(questionLink(Q('subsystem', 'platform', 'platform', 'x', 0)), { level: 'subsystems', sel: 'grp:platform', question: 0 });
});

test('questions are grouped by subsystem in the order they come, "Not set" for none; the label is the caller\'s', () => {
  const list = [Q('subsystem', 'platform', 'platform', 'a'), Q('component', 'alpha', 'agent', 'b'), Q('component', 'zeta', 'platform', 'c'), Q('component', 'free', '', 'd')];
  const g = groupQuestions(list, (k: string) => (k === 'platform' ? 'Platform' : k || 'Not set'));
  assert.deepEqual(g.map((x: any) => [x.key, x.label, x.items.length]), [['platform', 'Platform', 2], ['agent', 'agent', 1], ['', 'Not set', 1]]);
  assert.deepEqual(groupQuestions([]), []);
});

test('the filter keeps the questions that contain every word, in the item or the text, case-insensitively', () => {
  const list = [Q('component', 'policy-compiler', 'platform', 'Is the bundle size capped per tenant?'), Q('component', 'auth-svc', 'platform', 'Rotate keys when?')];
  assert.equal(filterQuestions(list, '').length, 2);
  assert.equal(filterQuestions(list, undefined).length, 2);
  assert.deepEqual(filterQuestions(list, 'BUNDLE capped').map((q: any) => q.id), ['policy-compiler']);
  assert.deepEqual(filterQuestions(list, 'auth keys').map((q: any) => q.id), ['auth-svc']);
  assert.deepEqual(filterQuestions(list, 'zzz'), []);
});

test('a question row shows plain text: Markdown marks and link syntax are out', () => {
  assert.equal(plainQuestion('Who rotates the keys: `auth-svc` or **the platform team**? See [the plan](https://x.test/p)'), 'Who rotates the keys: auth-svc or the platform team? See the plan');
  assert.equal(plainQuestion(undefined), '');
});
