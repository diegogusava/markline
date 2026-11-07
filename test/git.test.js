const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gitMarkers } = require('../editor/src/git');

test('marks additions and replacements at the new line numbers', () => {
  assert.deepEqual(gitMarkers('@@ -0,0 +1,2 @@\n@@ -4 +6 @@', 8), {
    1: { kind: 'added' }, 2: { kind: 'added' }, 6: { kind: 'modified' }
  });
});
test('anchors deleted lines at the beginning, middle, and end of the buffer', () => {
  assert.deepEqual(gitMarkers('@@ -1 +0,0 @@', 2), { 1: { deleted: 'before' } });
  assert.deepEqual(gitMarkers('@@ -3 +2,0 @@', 3), { 2: { deleted: 'after' } });
  assert.deepEqual(gitMarkers('@@ -4,3 +3,0 @@', 3), { 3: { deleted: 'after' } });
  assert.deepEqual(gitMarkers('@@ -1,3 +0,0 @@', 1), { 1: { deleted: 'before' } });
});
test('keeps deletion markers when a replacement removes extra lines', () => {
  assert.deepEqual(gitMarkers('@@ -2,3 +2 @@', 3), { 2: { kind: 'modified', deleted: 'after' } });
  assert.deepEqual(gitMarkers(null, 1), {});
});
