const { test } = require('node:test');
const assert = require('node:assert/strict');
const indentText = require('../editor/src/indent');

// | marks the caret, [ and ] a selection
function run(marked, outdent) {
  const caret = marked.indexOf('|');
  let start, end, text;
  if (caret >= 0) { text = marked.replace('|', ''); start = end = caret; }
  else { start = marked.indexOf('['); end = marked.indexOf(']') - 1; text = marked.replace('[', '').replace(']', ''); }
  const r = indentText(text, start, end, outdent);
  if (r.start === r.end) return r.text.slice(0, r.start) + '|' + r.text.slice(r.start);
  return r.text.slice(0, r.start) + '[' + r.text.slice(r.start, r.end) + ']' + r.text.slice(r.end);
}

test('Tab inserts a tab at the caret', () => {
  assert.equal(run('ab|cd'), 'ab\t|cd');
});

test('Tab replaces a selection inside one line', () => {
  assert.equal(run('a[bc]d'), 'a\t|d');
});

test('Tab indents every selected line', () => {
  assert.equal(run('one\nt[wo\nthr]ee\nfour'), 'one\n\tt[wo\n\tthr]ee\nfour');
});

test('a selection ending at a line start leaves that line alone', () => {
  assert.equal(run('[one\ntwo\n]three'), '[\tone\n\ttwo\n]three');
});

test('Shift+Tab removes a tab or up to four spaces from each line', () => {
  assert.equal(run('\tone\n      t[wo\n  thr]ee', true), '\tone\n  t[wo\nthr]ee');
  assert.equal(run('\t\tab|c', true), '\tab|c');
  assert.equal(run('  |abc', true), '|abc');
  assert.equal(run('abc|', true), 'abc|');
});
