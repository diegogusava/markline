const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mdIndex, ctx } = require('../editor/src/anchor');

const md = '# Plan\n\nIntro text.\n\n- The payments team owns retries.\n- Coupons stay.\n';

test('finds a quote taken from markdown source lines, list marker included', () => {
  const loc = mdIndex(md).find({ quote: '- The payments team owns retries.' });
  assert.deepEqual(loc && [loc.l1, loc.l2], [5, 5]);
});

// a comment as the editor stores it: the quote plus ~30 chars of context on each side
const commentOn = (doc, quote) => { const a = doc.indexOf(quote); return Object.assign({ quote: quote }, ctx(doc, a, a + quote.length)); };

test('points a comment whose text was rewritten to the closest match between its old neighbours', () => {
  const before = '# Plan\n\nIntro text here for context.\n\n- Who owns the retry logic?\n- Coupons stay on the first step.\n';
  const after = before.replace('Who owns the retry logic?', 'The payments team owns retries.');
  const loc = mdIndex(after).find(commentOn(before, 'Who owns the retry logic?'));
  assert.deepEqual(loc && [loc.l1, loc.approx], [5, true]);
});

test('falls back to the text after the old preceding context when the following one changed too', () => {
  const before = '# Plan\n\nIntro text here for context.\n\n- Who owns the retry logic?\n- Coupons stay on the first step.\n';
  const after = '# Plan\n\nIntro text here for context.\n\n- The payments team owns retries.\n- Coupons move to checkout.\n';
  const loc = mdIndex(after).find(commentOn(before, 'Who owns the retry logic?'));
  assert.deepEqual(loc && [loc.l1, loc.approx], [5, true]);
});

test('gives up when neither the quote nor its context is left', () => {
  const before = '# Plan\n\nIntro text here for context.\n\n- Who owns the retry logic?\n- Coupons stay on the first step.\n';
  assert.equal(mdIndex('# Other\n\nNothing in common.\n').find(commentOn(before, 'Who owns the retry logic?')), null);
});
