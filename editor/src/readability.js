/* Readability checks in the style of the Hemingway editor: hard and very hard sentences, adverbs and weakeners,
   passive voice, and phrases with a simpler alternative. Pure functions, shared by readpanel.js and the node tests.
   Two languages: English ('en') and Portuguese ('pt'), each with its own word lists and grade formula.
   English grade: Automated Readability Index (ARI): 4.71 * letters/word + 0.5 * words/sentence - 21.43.
   Portuguese grade: Flesch reading ease adapted to Portuguese (Martins et al., 1996):
   248.835 - 1.015 * words/sentence - 84.6 * syllables/word, turned into a school grade with Flesch's own table. */

/* a word: letters or digits, joined by an apostrophe or hyphen (don't, well-known) */
const RD_WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
/* words ending in a period that do not end a sentence */
const RD_ABBR_EN = new Set('mr mrs ms dr prof sr jr st vs etc e.g i.e eg ie cf al approx no nr fig inc ltd co corp dept est min max jan feb mar apr jun jul aug sep sept oct nov dec mon tue wed thu fri sat sun'.split(' '));

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

/* ---------- Portuguese ---------- */
const RD_ABBR_PT = new Set(('sr sra srta srs sras dr dra drs prof profa profs eng arq adv exmo exma ilmo ilma v.exa etc ex p.ex obs pág pag págs ' +
  'p pp cap caps vol vols ed fig figs tab núm num n nº no art arts inc av r rod km tel cel ltda cia s.a sa min máx max aprox ' +
  'jan fev mar abr mai jun jul ago set out nov dez seg ter qua qui sex sáb sab dom').split(' '));
/* "-mente" words that are not adverbs: nouns, adjectives and verb forms (comente, aumente) */
const RD_NOT_ADV_PT = new Set(('mente demente semente clemente inclemente veemente dormente ' +
  'comente lamente aumente alimente experimente implemente complemente suplemente fomente atormente cimente documente ' +
  'fragmente segmente incremente argumente regulamente ornamente sedimente cumprimente desmente apascente').split(' '));
/* words and phrases that weaken a sentence */
const RD_WEAK_PT = ['muito', 'muita', 'muitos', 'muitas', 'bastante', 'realmente', 'talvez', 'provavelmente', 'possivelmente',
  'basicamente', 'simplesmente', 'praticamente', 'literalmente', 'totalmente', 'extremamente', 'absolutamente', 'certamente',
  'meio que', 'um pouco', 'um tanto', 'de certa forma', 'de certo modo', 'eu acho', 'acho que', 'creio que', 'eu acredito',
  'acredito que', 'na minha opinião', 'parece que', 'pelo jeito', 'digamos que'];
/* forms of "ser": ser + participle is the passive (o bug foi corrigido) */
const RD_SER_PT = 'é|são|sou|somos|era|eram|foi|foram|fui|fomos|será|serão|seria|seriam|seja|sejam|fosse|fossem|for|forem|ser|serem|sido|sendo|tem\\s+sido|têm\\s+sido|tinha\\s+sido|havia\\s+sido';
/* past participles that do not end in -ado/-ido (with -a, -os, -as endings added below) */
const RD_PART_PT = new Set(('feito dito escrito visto posto aberto coberto descoberto morto eleito aceito entregue pago ganho gasto ' +
  'preso impresso expresso suspenso aceso salvo solto extinto frito roto benzido desfeito refeito proposto composto imposto ' +
  'exposto disposto suposto reposto oposto previsto revisto reescrito inscrito descrito prescrito transcrito').split(' ').reduce(function (out, w) {
  const stem = w.replace(/[oe]$/, '');
  out.push(w); if (/o$/.test(w)) out.push(stem + 'a', stem + 'os', stem + 'as'); else out.push(w + 's');
  return out;
}, []));
/* -ado/-ido words that are not participles after "é": nouns and adjectives */
const RD_NOT_PART_PT = new Set(('nada cada vida vidas ida lado lados fado grado agrado estado estados soldado advogado mercado ' +
  'pecado pescado cuidado obrigado obrigada fígado partido sentido ruído ouvido marido vestido libido cupido olvido').split(' '));
/* phrase -> simpler alternative ('' means: leave it out) */
const RD_SIMPLER_PT = {
  'utilizar': 'usar', 'utiliza': 'usa', 'utilizam': 'usam', 'utilizado': 'usado', 'utilizada': 'usada', 'utilização': 'uso',
  'efetuar': 'fazer', 'efetua': 'faz', 'realizar': 'fazer', 'realiza': 'faz', 'adquirir': 'comprar, obter',
  'disponibilizar': 'oferecer, dar', 'possuir': 'ter', 'possui': 'tem', 'possuem': 'têm', 'solicitar': 'pedir',
  'solicita': 'pede', 'auxiliar': 'ajudar', 'auxílio': 'ajuda', 'iniciar': 'começar', 'inicia': 'começa',
  'finalizar': 'terminar, acabar', 'aproximadamente': 'cerca de', 'previamente': 'antes', 'posteriormente': 'depois',
  'consequentemente': 'por isso, então', 'entretanto': 'mas', 'todavia': 'mas', 'contudo': 'mas', 'no entanto': 'mas',
  'portanto': 'então, por isso', 'ademais': 'além disso', 'outrossim': 'também', 'mediante': 'por, com',
  'acerca de': 'sobre', 'elencar': 'listar', 'visando': 'para', 'visando a': 'para', 'encontra-se': 'está',
  'encontram-se': 'estão', 'se encontra': 'está', 'se encontram': 'estão',
  'a fim de': 'para', 'com o objetivo de': 'para', 'com a finalidade de': 'para', 'com o intuito de': 'para',
  'no sentido de': 'para', 'de forma a': 'para', 'de modo a': 'para', 'devido ao fato de que': 'porque',
  'pelo fato de que': 'porque', 'em virtude do fato de que': 'porque', 'tendo em vista que': 'como, porque',
  'em virtude de': 'por', 'no momento atual': 'agora', 'neste momento': 'agora', 'no presente momento': 'agora',
  'nos dias de hoje': 'hoje', 'hoje em dia': 'hoje', 'no caso de': 'se', 'na eventualidade de': 'se',
  'em relação a': 'sobre', 'com relação a': 'sobre', 'no que diz respeito a': 'sobre', 'no que se refere a': 'sobre',
  'no que tange a': 'sobre', 'a respeito de': 'sobre', 'por meio de': 'por, com', 'a nível de': 'em', 'em nível de': 'em',
  'tomar uma decisão': 'decidir', 'levar em consideração': 'considerar', 'fazer uma análise': 'analisar',
  'realizar uma análise': 'analisar', 'chegar à conclusão': 'concluir', 'chegar a uma conclusão': 'concluir',
  'prestar assistência': 'ajudar', 'dar início a': 'começar', 'fazer uso de': 'usar', 'fazer menção a': 'mencionar',
  'é importante ressaltar que': '', 'é importante destacar que': '', 'é importante notar que': '', 'vale ressaltar que': '',
  'vale a pena ressaltar que': '', 'vale destacar que': '', 'vale lembrar que': '', 'cabe ressaltar que': '',
  'cabe destacar que': '', 'a grande maioria': 'a maioria', 'um grande número de': 'muitos',
  'uma grande quantidade de': 'muitos, muito', 'em todos os momentos': 'sempre', 'em primeiro lugar': 'primeiro',
  'com exceção de': 'exceto', 'na ausência de': 'sem', 'em tempo hábil': 'a tempo', 'no final das contas': '',
  'o fato de que': 'que', 'elo de ligação': 'elo', 'há anos atrás': 'há anos', 'planejar antecipadamente': 'planejar',
  'encarar de frente': 'encarar', 'surpresa inesperada': 'surpresa', 'de maneira geral': 'em geral'
};

/* Portuguese syllables: one per vowel group, plus one per hiatus. A falling diphthong (pai, mãe, céu) is one syllable;
   "u" after q/g before e/i (que, guia) is silent. Rising pairs (dia, rio, água) count as two, as in careful speech. */
const RD_V = 'aeiouáéíóúâêôãõàüy';
function rdSyllablesPt(word) {
  const w = word.toLowerCase().replace(/(?<=[qg])u(?=[eiéí])/g, '').replace(/(?<=q)u(?=[aoáó])/g, '');
  let n = 0, prev = '', glide = false;
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    if (RD_V.indexOf(c) < 0) { prev = ''; glide = false; continue; }
    const diph = prev && !glide && ((/[iu]/.test(c) && /[aeoáéóâêôu]/.test(prev) && !(c === 'u' && prev === 'u')) ||
      (/[aeiou]/.test(prev) && c === 'i' && prev !== 'i') || (/[ãõ]/.test(prev) && /[oe]/.test(c)));
    if (diph) glide = true; else { n++; glide = false; }
    prev = c;
  }
  return Math.max(1, n);
}
function rdSyllables(words, f) { let n = 0; words.forEach(function (w) { n += f(w); }); return n; }

function rdWords(s) { return s.match(RD_WORD) || []; }
function rdLetters(words) { let n = 0; words.forEach(function (w) { n += w.replace(/['’-]/g, '').length; }); return n; }
function rdAri(letters, words, sentences) { return words ? 4.71 * (letters / words) + 0.5 * (words / Math.max(1, sentences)) - 21.43 : 0; }
/* Flesch reading ease for Portuguese, then Flesch's ease-to-grade table (90-100: 5th grade ... 0-30: college graduate) */
function rdFleschPt(syll, words, sentences) { return 248.835 - 1.015 * (words / Math.max(1, sentences)) - 84.6 * (syll / words); }
const RD_EASE_GRADE = [[100, 4], [90, 5], [80, 6], [70, 7], [60, 8.5], [50, 11], [30, 14.5], [0, 18], [-50, 22]];
function rdEaseToGrade(e) {
  const t = RD_EASE_GRADE;
  if (e >= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (e >= t[i][0]) { const a = t[i - 1], b = t[i]; return b[1] + (a[1] - b[1]) * (e - b[0]) / (a[0] - b[0]); }
  }
  return t[t.length - 1][1];
}

/* everything that differs between languages */
const RD_LANGS = {
  en: {
    abbr: RD_ABBR_EN, simpler: RD_SIMPLER, simplerRe: rdPhraseRe(Object.keys(RD_SIMPLER)), weakRe: rdPhraseRe(RD_WEAK),
    passiveRe: /(?<![\p{L}])(am|is|are|was|were|be|been|being|is\s+not|are\s+not|was\s+not|were\s+not|isn['’]t|aren['’]t|wasn['’]t|weren['’]t)\s+(?:[\p{L}]+ly\s+)?([\p{L}]+)(?![\p{L}])/giu,
    isPart: function (p) { return RD_PART.has(p) || (p.length > 3 && /ed$/.test(p) && !RD_NOT_PART.has(p)); },
    isAdverb: function (w) { return w.length > 3 && /ly$/.test(w) && !RD_NOT_ADV.has(w); },
    grade: function (words, sentences) { return rdAri(rdLetters(words), words.length, sentences); }
  },
  pt: {
    abbr: RD_ABBR_PT, simpler: RD_SIMPLER_PT, simplerRe: rdPhraseRe(Object.keys(RD_SIMPLER_PT)), weakRe: rdPhraseRe(RD_WEAK_PT),
    passiveRe: new RegExp('(?<![\\p{L}])(' + RD_SER_PT + ')\\s+(?:[\\p{L}]+mente\\s+)?([\\p{L}]+)(?![\\p{L}])', 'giu'),
    /* -ado/-ido participles carry no accent, except the -ído of construído, incluído */
    isPart: function (p) {
      if (RD_PART_PT.has(p)) return true;
      if (RD_NOT_PART_PT.has(p) || p.length < 5) return false;
      return /(?:ad|id|íd)[oa]s?$/.test(p) && !/[áéóâêôãõú]/.test(p) && !/í(?!d[oa]s?$)/.test(p);
    },
    isAdverb: function (w) { return w.length > 6 && /mente$/.test(w) && !RD_NOT_ADV_PT.has(w); },
    grade: function (words, sentences) { return words.length ? rdEaseToGrade(rdFleschPt(rdSyllables(words, rdSyllablesPt), words.length, sentences)) : 0; }
  }
};
const RD_HINT = {
  vague: 'Try leaving this out.', passive: 'Passive voice. Say who does it.',
  weak: 'Weakens the sentence. Try leaving it out.', adverb: 'Adverb. A stronger verb often says it better.'
};

/* guess the language from common short words: 'en' or 'pt' */
const RD_COMMON_EN = new Set('the and of to is that it for with you this are was be have not on at by from or but they we what which their will would there been has'.split(' '));
const RD_COMMON_PT = new Set('de que não um uma os para com é em da das dos na nas nos por mais como mas ao se seu sua ou quando muito já também só pelo pela isso este esta ele ela são foi está'.split(' '));
function rdDetect(text) {
  let en = 0, pt = 0;
  (text.toLowerCase().match(RD_WORD) || []).slice(0, 3000).forEach(function (w) {
    if (RD_COMMON_EN.has(w)) en++;
    if (RD_COMMON_PT.has(w)) pt++;
    if (/[ãõç]/.test(w)) pt++;
  });
  return pt > en ? 'pt' : 'en';
}
function rdLang(lang, blocks) { return RD_LANGS[lang] ? lang : rdDetect(blocks.join('\n')); }

/* split a block of text into sentences: [{a, b}] with a..b trimmed */
function rdSentences(s, lang) {
  const abbr = (RD_LANGS[lang] || RD_LANGS.en).abbr;
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
      const w = (s.slice(Math.max(0, i - 12), i).match(/([\p{L}.º]+)$/u) || [])[1];
      if (w && (abbr.has(w.toLowerCase()) || /^\p{Lu}$/u.test(w))) continue; // e.g. / Mr. / J. Smith
    }
    let j = i + 1;
    while (j < s.length && /[.!?]/.test(s[j])) j++;
    while (j < s.length && /["'”’»)\]]/.test(s[j])) j++;
    if (j < s.length && !/\s/.test(s[j])) continue; // file.md, v1.2
    push(start, j); start = j; i = j - 1;
  }
  push(start, s.length);
  return out;
}

/* sentence level: null, 'hard' or 'vhard' (Hemingway skips sentences under 14 words) */
function rdLevel(words, lang) {
  if (words.length < 14) return null;
  const g = (RD_LANGS[lang] || RD_LANGS.en).grade(words, 1);
  return g >= 14 ? 'vhard' : g >= 10 ? 'hard' : null;
}

/* word-level marks in one sentence: [{a, b, kind, hint}] relative to the sentence */
function rdMarks(s, lang) {
  const L = RD_LANGS[lang] || RD_LANGS.en;
  const out = [], taken = [];
  function free(a, b) { return !taken.some(function (t) { return a < t.b && b > t.a; }); }
  function add(a, b, kind, hint) { out.push({ a: a, b: b, kind: kind, hint: hint }); taken.push({ a: a, b: b }); }
  let m;
  L.simplerRe.lastIndex = 0;
  while ((m = L.simplerRe.exec(s))) {
    const alt = L.simpler[m[0].toLowerCase().replace(/\s+/g, ' ')];
    add(m.index, m.index + m[0].length, 'complex', alt ? 'Simpler: ' + alt : RD_HINT.vague);
  }
  L.passiveRe.lastIndex = 0;
  while ((m = L.passiveRe.exec(s))) {
    if (L.isPart(m[2].toLowerCase()) && free(m.index, m.index + m[0].length)) add(m.index, m.index + m[0].length, 'passive', RD_HINT.passive);
    else L.passiveRe.lastIndex = m.index + m[1].length; // "is quickly fixed": still check the adverb below
  }
  L.weakRe.lastIndex = 0;
  while ((m = L.weakRe.exec(s))) {
    if (free(m.index, m.index + m[0].length)) add(m.index, m.index + m[0].length, 'adverb', RD_HINT.weak);
  }
  RD_WORD.lastIndex = 0;
  while ((m = RD_WORD.exec(s))) {
    const w = m[0].toLowerCase(), name = m.index > 0 && /^\p{Lu}/u.test(m[0]); // Kelly, Italy mid-sentence
    if (L.isAdverb(w) && !name && free(m.index, m.index + m[0].length)) add(m.index, m.index + m[0].length, 'adverb', RD_HINT.adverb);
  }
  return out.sort(function (x, y) { return x.a - y.a; });
}

/* analyze a list of text blocks (paragraphs, list items, cells...) in 'en', 'pt' or, for anything else, the detected language.
   Returns sentences [{blk, a, b, level}], marks [{blk, a, b, kind, hint}] and totals. */
function rdAnalyze(blocks, lang) {
  lang = rdLang(lang, blocks);
  const sentences = [], marks = [], all = [];
  let paras = 0;
  blocks.forEach(function (s, blk) {
    const ss = rdSentences(s, lang);
    let any = false;
    ss.forEach(function (r) {
      const t = s.slice(r.a, r.b), w = rdWords(t);
      if (!w.length) return;
      any = true;
      Array.prototype.push.apply(all, w);
      sentences.push({ blk: blk, a: r.a, b: r.b, level: rdLevel(w, lang), words: w.length });
      rdMarks(t, lang).forEach(function (k) { marks.push({ blk: blk, a: r.a + k.a, b: r.a + k.b, kind: k.kind, hint: k.hint }); });
    });
    if (any) paras++;
  });
  const n = sentences.length, words = all.length, count = function (f) { return sentences.filter(f).length; };
  const kinds = function (k) { return marks.filter(function (m) { return m.kind === k; }).length; };
  const grade = words ? Math.max(0, Math.round(RD_LANGS[lang].grade(all, n))) : 0;
  return {
    sentences: sentences, marks: marks,
    stats: {
      lang: lang, words: words, sentences: n, paragraphs: paras, letters: rdLetters(all), grade: grade,
      hard: count(function (x) { return x.level === 'hard'; }), vhard: count(function (x) { return x.level === 'vhard'; }),
      adverb: kinds('adverb'), passive: kinds('passive'), complex: kinds('complex'),
      // Hemingway's targets: about one adverb per three paragraphs, one passive per five sentences
      adverbGoal: Math.round(paras / 3), passiveGoal: Math.round(n / 5)
    }
  };
}
/* plain-words label for a grade */
function rdGradeLabel(g) { return g <= 6 ? 'Very easy' : g <= 9 ? 'Good' : g <= 12 ? 'OK' : g <= 16 ? 'Hard' : 'Very hard'; }

if (typeof module !== 'undefined' && module.exports) module.exports = { rdSentences: rdSentences, rdMarks: rdMarks, rdAnalyze: rdAnalyze, rdLevel: rdLevel, rdWords: rdWords, rdGradeLabel: rdGradeLabel, rdDetect: rdDetect, rdSyllablesPt: rdSyllablesPt };
