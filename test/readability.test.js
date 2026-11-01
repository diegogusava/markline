const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rdSentences, rdMarks, rdAnalyze, rdGradeLabel, rdDetect, rdSyllablesPt } = require('../editor/src/readability');

const split = (s, l) => rdSentences(s, l).map(r => s.slice(r.a, r.b));
const kinds = (s, l) => rdMarks(s, l).map(m => m.kind + ':' + s.slice(m.a, m.b));

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

/* ---------- Portuguese ---------- */
test('detects Portuguese and English', () => {
  assert.equal(rdDetect('O sistema não está funcionando e o usuário precisa de ajuda para resolver isso.'), 'pt');
  assert.equal(rdDetect('The system is not working and the user needs help to fix it.'), 'en');
  assert.equal(rdAnalyze(['Isso é uma frase em português, com acentuação.']).stats.lang, 'pt');
});

test('pt: splits sentences but not on Portuguese abbreviations', () => {
  assert.deepEqual(split('O Sr. Silva pagou 3,5 reais. Veja a pág. 10, p. ex. o cap. 2! Pronto?', 'pt'),
    ['O Sr. Silva pagou 3,5 reais.', 'Veja a pág. 10, p. ex. o cap. 2!', 'Pronto?']);
});

test('pt: counts syllables with diphthongs and hiatuses', () => {
  const n = w => rdSyllablesPt(w);
  assert.deepEqual(['gato', 'pai', 'mãe', 'céu', 'dia', 'que', 'guia', 'saúde', 'país', 'construído'].map(n), [2, 1, 1, 1, 2, 1, 2, 3, 2, 4]);
});

test('pt: flags -mente adverbs, but not words that only end like one', () => {
  assert.deepEqual(kinds('Ele correu rapidamente. Comente a semente na mente.', 'pt'), ['adverb:rapidamente']);
});

test('pt: flags weakeners', () => {
  assert.deepEqual(kinds('Acho que isso é muito bom.', 'pt'), ['adverb:Acho que', 'adverb:muito']);
});

test('pt: flags passive voice with ser, not adjectives or nouns', () => {
  assert.deepEqual(kinds('O bug foi corrigido. O arquivo é escrito. Ele é rápido. A casa foi construída. A vida é nada.', 'pt'),
    ['passive:foi corrigido', 'passive:é escrito', 'passive:foi construída']);
});

test('pt: suggests simpler alternatives', () => {
  const m = rdMarks('Vamos utilizar cache a fim de acelerar o app.', 'pt');
  assert.deepEqual(m.map(x => x.kind + ':' + x.hint), ['complex:Simpler: usar', 'complex:Simpler: para']);
});

test('pt: grades easy and very hard sentences', () => {
  const easy = 'Hoje eu fui à praia com meus amigos. A água estava fria, mas o sol estava forte.';
  const vhard = 'A implementação de algoritmos de consenso distribuído exige compreensão abrangente da comunicação assíncrona, de falhas parciais e do escalonamento não determinístico em infraestruturas heterogêneas.';
  assert.ok(rdAnalyze([easy], 'pt').stats.grade <= 6);
  const r = rdAnalyze([vhard], 'pt');
  assert.deepEqual(r.sentences.map(s => s.level), ['vhard']);
  assert.ok(r.stats.grade > 12);
});

test('a chosen language wins over detection', () => {
  assert.equal(rdAnalyze(['O gato sentou no tapete.'], 'en').stats.lang, 'en');
});
