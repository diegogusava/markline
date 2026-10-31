const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rdSentences, rdMarks, rdAnalyze, rdGradeLabel } = require('../editor/src/readability');

const split = s => rdSentences(s).map(r => s.slice(r.a, r.b));
const kinds = s => rdMarks(s).map(m => m.kind + ':' + s.slice(m.a, m.b));

test('splits sentences but not on abbreviations, decimals or file names', () => {
  assert.deepEqual(split('Open file.md first. Then run v1.2, e.g. on Linux. Mr. Smith paid 3.5 euros! Done?'),
    ['Open file.md first.', 'Then run v1.2, e.g. on Linux.', 'Mr. Smith paid 3.5 euros!', 'Done?']);
});

test('a line break ends a sentence', () => {
  assert.deepEqual(split('First line\nSecond line'), ['First line', 'Second line']);
});

test('flags adverbs, but not -ly words that are not adverbs or names', () => {
  assert.deepEqual(kinds('He quickly ran to the only early family meeting in Italy.'), ['adverb:quickly']);
});

test('flags weakeners as adverbs', () => {
  assert.deepEqual(kinds('I think this is very good.'), ['adverb:I think', 'adverb:very']);
});

test('flags passive voice with regular and irregular participles', () => {
  assert.deepEqual(kinds('The bug was fixed. The file is written. It is red. The cake was quickly eaten.'),
    ['passive:was fixed', 'passive:is written', 'passive:was quickly eaten']);
});

test('suggests simpler alternatives for complex phrases', () => {
  const m = rdMarks('We utilize caching in order to speed up the app.');
  assert.deepEqual(m.map(x => x.kind + ':' + x.hint), ['complex:Simpler: use', 'complex:Simpler: to']);
});

test('grades sentences: short ones are never hard', () => {
  const easy = 'The cat sat on the mat.';
  const vhard = 'The implementation of distributed consensus algorithms necessitates comprehensive understanding of asynchronous communication, partial failures, and nondeterministic scheduling across heterogeneous infrastructure.';
  const r = rdAnalyze([easy + ' ' + vhard]);
  assert.deepEqual(r.sentences.map(s => s.level), [null, 'vhard']);
  assert.equal(r.stats.vhard, 1);
  assert.equal(r.stats.sentences, 2);
  assert.ok(r.stats.grade > 9);
});

test('marks carry block-relative offsets', () => {
  const blocks = ['Hello there.', 'It is really simple. We utilize it.'];
  const r = rdAnalyze(blocks);
  assert.deepEqual(r.marks.map(m => [m.blk, blocks[m.blk].slice(m.a, m.b)]), [[1, 'really'], [1, 'utilize']]);
  assert.equal(r.stats.paragraphs, 2);
});

test('labels grades in plain words', () => {
  assert.equal(rdGradeLabel(5), 'Very easy');
  assert.equal(rdGradeLabel(8), 'Good');
  assert.equal(rdGradeLabel(14), 'Hard');
});
