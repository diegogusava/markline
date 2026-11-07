const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findMatches } = require('../editor/src/find');
test('finds case-insensitive literal matches with original text offsets', () => {
  assert.deepEqual(findMatches('Plan plan PLAN', 'plan'), [{ start: 0, end: 4 }, { start: 5, end: 9 }, { start: 10, end: 14 }]);
  assert.deepEqual(findMatches('a.* [x] a.*', 'a.*'), [{ start: 0, end: 3 }, { start: 8, end: 11 }]);
  assert.deepEqual(findMatches('İ plan', 'plan'), [{ start: 2, end: 6 }]);
});
test('handles empty queries, missing text, and non-overlapping matches', () => {
  assert.deepEqual(findMatches('text', ''), []);
  assert.deepEqual(findMatches('', 'text'), []);
  assert.deepEqual(findMatches('aaaaa', 'aa'), [{ start: 0, end: 2 }, { start: 2, end: 4 }]);
});
