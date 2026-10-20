// 0.17.5 (#48): a long unresolved chip must not squeeze the entry name in the switchboard rows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../web/css/views.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../web/js/views/service-switchboard.js', import.meta.url), 'utf8');

test('switchboard row: the name column keeps a minimum width and the action column may shrink', () => {
  assert.match(css, /\.sb-row \{[^}]*grid-template-columns: minmax\(40%, 1fr\) minmax\(0, auto\)/);
  assert.match(css, /\.sb-actions \.pill\.gap \{[^}]*text-overflow: ellipsis/);
});

test('ingress and egress rows both put the gap chip in .sb-actions; the sample has a long reason', () => {
  assert.equal((js.match(/'span\.xs\.sb-actions'|'span\.sb-actions'/g) ?? []).length, 2);
  const m = JSON.parse(readFileSync(new URL('../samples/sdp-controller.json', import.meta.url), 'utf8'));
  assert.ok(m.ingress.some((i: any) => i.unresolved?.[0]?.reason.length > 40));
});
