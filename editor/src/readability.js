/* Readability checks in the style of the Hemingway editor: hard and very hard sentences, adverbs and weakeners,
   passive voice, and phrases with a simpler alternative. Pure functions, shared by readpanel.js and the node tests.
   The grade is the Automated Readability Index (ARI): 4.71 * letters/word + 0.5 * words/sentence - 21.43. */

/* a word: letters or digits, joined by an apostrophe or hyphen (don't, well-known) */
const RD_WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
/* words ending in a period that do not end a sentence */
const RD_ABBR = new Set('mr mrs ms dr prof sr jr st vs etc e.g i.e eg ie cf al approx no nr fig inc ltd co corp dept est min max jan feb mar apr jun jul aug sep sept oct nov dec mon tue wed thu fri sat sun'.split(' '));

/* "-ly" words that are not adverbs */
const RD_NOT_ADV = new Set(('only early daily weekly monthly quarterly yearly nightly hourly family reply apply supply imply comply rely ally ' +
  'belly bully jelly holly lily folly rally tally gully holy ugly silly curly chilly hilly oily woolly wobbly bubbly ' +
  'friendly unfriendly lonely lovely lively costly deadly elderly orderly scholarly timely untimely likely unlikely ' +
  'assembly anomaly italy july fly ply sly butterfly multiply homely manly womanly kindly sickly worldly ' +
  'kelly emily molly billy sally polly ally').split(' '));
/* words and phrases that weaken a sentence */
const RD_WEAK = ['very', 'really', 'quite', 'rather', 'somewhat', 'just', 'maybe', 'perhaps', 'possibly', 'probably', 'basically',
  'actually', 'literally', 'simply', 'totally', 'extremely', 'i think', 'i believe', 'i feel', 'i guess', 'i suppose', 'we think',
  'we believe', 'kind of', 'sort of', 'a bit', 'a little bit', 'in my opinion', 'it seems', 'seems to'];
/* past participles that do not end in -ed */
const RD_PART = new Set(('known done made given taken seen written shown built sent held found told kept left paid put set run read said ' +
  'bought brought caught taught thought sold chosen driven eaten fallen forgotten frozen gotten hidden ridden risen shaken spoken ' +
  'stolen sworn thrown torn woken worn begun broken drawn drunk flown grown hung hurt lost meant met cut beaten bitten blown born ' +
  'borne bound bred dealt dug fed felt fought forbidden forgiven heard hit laid led lent let lit overcome proven quit rung sought ' +
  'shot shut slain spent split spread stuck struck sung sunk swept understood undone upset withdrawn won wound sewn shorn ' +
  'overseen overtaken overwritten rewritten rebuilt rerun reset mistaken misunderstood').split(' '));
/* "-ed" words that are not participles */
const RD_NOT_PART = new Set('need red bed shed seed feed speed weed bleed breed greed deed indeed hundred naked wicked sacred kindred rugged ragged crooked wretched beloved embed'.split(' '));

/* phrase -> simpler alternative ('' means: leave it out) */
const RD_SIMPLER = {
  'utilize': 'use', 'utilise': 'use', 'utilization': 'use', 'utilizes': 'uses', 'utilized': 'used', 'leverage': 'use',
  'facilitate': 'help, ease', 'commence': 'begin, start', 'commences': 'begins, starts', 'terminate': 'end, stop',
  'endeavor': 'try', 'endeavour': 'try', 'ascertain': 'find out', 'demonstrate': 'show, prove', 'demonstrates': 'shows',
  'approximately': 'about', 'sufficient': 'enough', 'numerous': 'many', 'additional': 'more, extra', 'assistance': 'help',
  'obtain': 'get', 'obtained': 'got', 'purchase': 'buy', 'initiate': 'start', 'initiates': 'starts', 'modify': 'change',
  'modification': 'change', 'optimal': 'best', 'optimum': 'best', 'possess': 'have, own', 'previously': 'before',
  'proceed': 'go ahead, go on', 'regarding': 'about', 'relocate': 'move', 'remainder': 'rest', 'reside': 'live', 'retain': 'keep',
  'transmit': 'send', 'whereas': 'but, while', 'subsequently': 'later, then', 'consequently': 'so', 'therefore': 'so',
  'nevertheless': 'still, but', 'notwithstanding': 'despite, still', 'however': 'but, yet', 'adequate': 'enough',
  'capability': 'ability', 'individual': 'person', 'individuals': 'people', 'expedite': 'hurry, speed up', 'inform': 'tell',
  'permit': 'let', 'request': 'ask', 'equivalent': 'equal', 'objective': 'aim, goal', 'principal': 'main', 'perform': 'do',
  'in order to': 'to', 'in order for': 'for', 'prior to': 'before', 'subsequent to': 'after', 'due to the fact that': 'because',
  'owing to the fact that': 'because', 'in light of the fact that': 'because', 'in spite of the fact that': 'although',
  'despite the fact that': 'although', 'at this point in time': 'now', 'at the present time': 'now', 'at this time': 'now',
  'in the event that': 'if', 'in the near future': 'soon', 'with regard to': 'about', 'with respect to': 'about',
  'in regard to': 'about', 'in relation to': 'about', 'in reference to': 'about', 'for the purpose of': 'for, to',
  'on a daily basis': 'daily', 'on a regular basis': 'regularly', 'is able to': 'can', 'are able to': 'can',
  'has the ability to': 'can', 'have the ability to': 'can', 'in addition to': 'besides, also', 'a majority of': 'most',
  'the majority of': 'most', 'a large number of': 'many', 'a number of': 'many, some', 'a small number of': 'a few',
  'at all times': 'always', 'by means of': 'by', 'in close proximity to': 'near', 'each and every': 'each',
  'first and foremost': 'first', 'until such time as': 'until', 'with the exception of': 'except', 'in the absence of': 'without',
  'it is important to note that': '', 'it should be noted that': '', 'please note that': '', 'it is worth noting that': '',
  'make a decision': 'decide', 'take into consideration': 'consider', 'give consideration to': 'consider',
  'come to the conclusion': 'conclude', 'conduct an investigation': 'investigate', 'perform an analysis': 'analyze',
  'provide assistance': 'help', 'is indicative of': 'shows', 'in excess of': 'more than', 'whether or not': 'whether',
  'an adequate number of': 'enough', 'as a means of': 'to', 'in the process of': '', 'on the basis of': 'by, from',
  'in a timely manner': 'quickly, on time', 'at the end of the day': '', 'the fact that': 'that', 'as to whether': 'whether',
  'in terms of': 'in, for', 'along the lines of': 'like', 'in the amount of': 'for', 'for the most part': 'mostly'
};

function rdEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function rdPhraseRe(list) {
  const alt = list.slice().sort(function (a, b) { return b.length - a.length; }).map(function (p) { return rdEsc(p).replace(/ /g, '\\s+'); });
  return new RegExp('(?<![\\p{L}\\p{N}])(?:' + alt.join('|') + ')(?![\\p{L}\\p{N}])', 'giu');
}
const RD_WEAK_RE = rdPhraseRe(RD_WEAK);
const RD_SIMPLER_RE = rdPhraseRe(Object.keys(RD_SIMPLER));
const RD_PASSIVE_RE = /(?<![\p{L}])(am|is|are|was|were|be|been|being|is\s+not|are\s+not|was\s+not|were\s+not|isn['’]t|aren['’]t|wasn['’]t|weren['’]t)\s+(?:[\p{L}]+ly\s+)?([\p{L}]+)(?![\p{L}])/giu;

/* split a block of text into sentences: [{a, b}] with a..b trimmed */
function rdSentences(s) {
  const out = [];
  let start = 0;
  function push(a, b) {
    while (a < b && /\s/.test(s[a])) a++;
    while (b > a && /\s/.test(s[b - 1])) b--;
    if (b > a && /[\p{L}\p{N}]/u.test(s.slice(a, b))) out.push({ a: a, b: b });
  }
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\n') { push(start, i); start = i + 1; continue; }
    if (ch !== '.' && ch !== '!' && ch !== '?') continue;
    if (ch === '.') {
      if (/\d/.test(s[i + 1] || '')) continue; // 3.5
      const w = (s.slice(Math.max(0, i - 12), i).match(/([\p{L}.]+)$/u) || [])[1];
      if (w && (RD_ABBR.has(w.toLowerCase()) || /^\p{Lu}$/u.test(w))) continue; // e.g. / Mr. / J. Smith
    }
    let j = i + 1;
    while (j < s.length && /[.!?]/.test(s[j])) j++;
    while (j < s.length && /["'”’)\]]/.test(s[j])) j++;
    if (j < s.length && !/\s/.test(s[j])) continue; // file.md, v1.2
    push(start, j); start = j; i = j - 1;
  }
  push(start, s.length);
  return out;
}

function rdWords(s) { return s.match(RD_WORD) || []; }
function rdLetters(words) { let n = 0; words.forEach(function (w) { n += w.replace(/['’-]/g, '').length; }); return n; }
function rdAri(letters, words, sentences) { return words ? 4.71 * (letters / words) + 0.5 * (words / Math.max(1, sentences)) - 21.43 : 0; }

/* sentence level: null, 'hard' or 'vhard' (Hemingway skips sentences under 14 words) */
function rdLevel(words) {
  if (words.length < 14) return null;
  const g = rdAri(rdLetters(words), words.length, 1);
  return g >= 14 ? 'vhard' : g >= 10 ? 'hard' : null;
}

/* word-level marks in one sentence: [{a, b, kind, hint}] relative to the sentence */
function rdMarks(s) {
  const out = [], taken = [];
  function free(a, b) { return !taken.some(function (t) { return a < t.b && b > t.a; }); }
  function add(a, b, kind, hint) { out.push({ a: a, b: b, kind: kind, hint: hint }); taken.push({ a: a, b: b }); }
  let m;
  RD_SIMPLER_RE.lastIndex = 0;
  while ((m = RD_SIMPLER_RE.exec(s))) {
    const alt = RD_SIMPLER[m[0].toLowerCase().replace(/\s+/g, ' ')];
    add(m.index, m.index + m[0].length, 'complex', alt ? 'Simpler: ' + alt : 'Try leaving this out.');
  }
  RD_PASSIVE_RE.lastIndex = 0;
  while ((m = RD_PASSIVE_RE.exec(s))) {
    const p = m[2].toLowerCase();
    const part = RD_PART.has(p) || (p.length > 3 && /ed$/.test(p) && !RD_NOT_PART.has(p));
    if (part && free(m.index, m.index + m[0].length)) add(m.index, m.index + m[0].length, 'passive', 'Passive voice. Say who does it.');
    else RD_PASSIVE_RE.lastIndex = m.index + m[1].length; // "is quickly fixed": still check the adverb below
  }
  RD_WEAK_RE.lastIndex = 0;
  while ((m = RD_WEAK_RE.exec(s))) {
    if (free(m.index, m.index + m[0].length)) add(m.index, m.index + m[0].length, 'adverb', 'Weakens the sentence. Try leaving it out.');
  }
  RD_WORD.lastIndex = 0;
  while ((m = RD_WORD.exec(s))) {
    const w = m[0].toLowerCase(), name = m.index > 0 && /^\p{Lu}/u.test(m[0]); // Kelly, Italy mid-sentence
    if (w.length > 3 && /ly$/.test(w) && !RD_NOT_ADV.has(w) && !name) {
      if (free(m.index, m.index + m[0].length)) add(m.index, m.index + m[0].length, 'adverb', 'Adverb. A stronger verb often says it better.');
    }
  }
  return out.sort(function (x, y) { return x.a - y.a; });
}

/* analyze a list of text blocks (paragraphs, list items, cells...).
   Returns sentences [{blk, a, b, level}], marks [{blk, a, b, kind, hint}] and totals. */
function rdAnalyze(blocks) {
  const sentences = [], marks = [];
  let words = 0, letters = 0, paras = 0;
  blocks.forEach(function (s, blk) {
    const ss = rdSentences(s);
    let any = false;
    ss.forEach(function (r) {
      const t = s.slice(r.a, r.b), w = rdWords(t);
      if (!w.length) return;
      any = true;
      words += w.length; letters += rdLetters(w);
      sentences.push({ blk: blk, a: r.a, b: r.b, level: rdLevel(w), words: w.length });
      rdMarks(t).forEach(function (k) { marks.push({ blk: blk, a: r.a + k.a, b: r.a + k.b, kind: k.kind, hint: k.hint }); });
    });
    if (any) paras++;
  });
  const n = sentences.length, count = function (f) { return sentences.filter(f).length; };
  const kinds = function (k) { return marks.filter(function (m) { return m.kind === k; }).length; };
  const grade = words ? Math.max(0, Math.round(rdAri(letters, words, n))) : 0;
  return {
    sentences: sentences, marks: marks,
    stats: {
      words: words, sentences: n, paragraphs: paras, letters: letters, grade: grade,
      hard: count(function (x) { return x.level === 'hard'; }), vhard: count(function (x) { return x.level === 'vhard'; }),
      adverb: kinds('adverb'), passive: kinds('passive'), complex: kinds('complex'),
      // Hemingway's targets: about one adverb per three paragraphs, one passive per five sentences
      adverbGoal: Math.round(paras / 3), passiveGoal: Math.round(n / 5)
    }
  };
}
/* plain-words label for a grade */
function rdGradeLabel(g) { return g <= 6 ? 'Very easy' : g <= 9 ? 'Good' : g <= 12 ? 'OK' : g <= 16 ? 'Hard' : 'Very hard'; }

if (typeof module !== 'undefined' && module.exports) module.exports = { rdSentences: rdSentences, rdMarks: rdMarks, rdAnalyze: rdAnalyze, rdLevel: rdLevel, rdWords: rdWords, rdGradeLabel: rdGradeLabel };
