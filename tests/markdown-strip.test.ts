import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripMarkdown as s } from '../core/markdown-strip.ts';

test('markdown strip: bold, italic, strike', () => {
  assert.equal(s('Goes to the **nearest POP**.'), 'Goes to the nearest POP.');
  assert.equal(s('an *x* and _y_ and __z__ and ~~w~~'), 'an x and y and z and w');
  assert.equal(s('snake_case_name and 2*3*4 stay'), 'snake_case_name and 2*3*4 stay');
});
test('markdown strip: links keep the text only', () => {
  assert.equal(s('See [the docs](https://x.example/a?b=1) now'), 'See the docs now');
  assert.equal(s('[click me](javascript:alert)'), 'click me');
});
test('markdown strip: bullets, headings, line breaks, whitespace', () => {
  assert.equal(s('## Title\n- one\n- two\n\n1. three\n   four'), 'Title one two three four');
  assert.equal(s('a\r\nb\n\n\n  c  '), 'a b c');
});
test('markdown strip: code spans and fences', () => {
  assert.equal(s('call `GET /x` then `y`'), 'call GET /x then y');
  assert.equal(s('```\ncode **kept**\n```'), 'code kept');
});
test('markdown strip: nested and plain text', () => {
  assert.equal(s('**bold *and italic***'), 'bold and italic');
  assert.equal(s('- **[link](http://a.b)** here'), 'link here');
  assert.equal(s('Plain text, unchanged.'), 'Plain text, unchanged.');
  assert.equal(s(''), '');
  assert.equal(s(undefined), '');
});
