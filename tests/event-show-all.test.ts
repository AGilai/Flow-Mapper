// Bug #26: "Show all N" on the event page did nothing: the click set `expanded` and called draw(), which builds
// the lanes but never puts them in the page. The UI has no DOM test harness, so this guards the source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('every expand/collapse click in the event flow re-renders into the page (#26)', () => {
  const src = readFileSync(new URL('../web/js/views/event-flow.js', import.meta.url), 'utf8');
  const clicks = src.match(/expanded = (true|false); \w+\(\)/g) ?? [];
  assert.ok(clicks.length >= 3, 'expected the show-all and show-fewer handlers');
  for (const c of clicks) assert.match(c, /render\(\)$/, c);
});
