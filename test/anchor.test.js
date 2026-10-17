const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mdIndex } = require('../editor/src/anchor');

const md = '# Plan\n\nIntro text.\n\n- The payments team owns retries.\n- Coupons stay.\n';

test('finds a quote taken from markdown source lines, list marker included', () => {
  const loc = mdIndex(md).find({ quote: '- The payments team owns retries.' });
  assert.deepEqual(loc && [loc.l1, loc.l2], [5, 5]);
});
