/* ---------- readability (Hemingway-style) ----------
   Readability on: the rendered page colors hard sentences (yellow), very hard ones (red), adverbs and weakeners (blue),
   passive voice (green) and phrases with a simpler alternative (purple). The panel shows the grade and the counts.
   Colors are CSS highlights, so the document and the saved markdown are never touched. */
(function () {
const panel = $('#rpanel'), btn = $('#bRead'), chip = $('#rChip'), tip = $('#rtip');
const HL = !!(window.CSS && CSS.highlights && window.Highlight);
const ON_KEY = 'markline-read-on-v1', HIDE_KEY = 'markline-read-hide-v1', LANG_KEY = 'markline-read-lang-v1';
const LANG_NAMES = { en: 'English', pt: 'Portuguese' };
const KINDS = [
  { k: 'vhard', hl: 'ml-rv', text: function (s) { return '<b>' + s.vhard + '</b> of ' + s.sentences + plural(s.sentences, ' sentence is', ' sentences are') + ' very hard to read.'; }, hint: 'Very hard to read. Split it into shorter sentences.' },
  { k: 'hard', hl: 'ml-rh', text: function (s) { return '<b>' + s.hard + '</b> of ' + s.sentences + plural(s.sentences, ' sentence is', ' sentences are') + ' hard to read.'; }, hint: 'Hard to read. Cut words or split it.' },
  { k: 'adverb', hl: 'ml-ra', text: function (s) { return '<b>' + s.adverb + '</b>' + plural(s.adverb, ' adverb or weakener', ' adverbs and weakeners') + '. ' + goal(s.adverb, s.adverbGoal); } },
  { k: 'passive', hl: 'ml-rp', text: function (s) { return '<b>' + s.passive + '</b>' + plural(s.passive, ' use', ' uses') + ' of passive voice. ' + goal(s.passive, s.passiveGoal); } },
  { k: 'complex', hl: 'ml-rc', text: function (s) { return '<b>' + s.complex + '</b>' + plural(s.complex, ' phrase has', ' phrases have') + ' a simpler alternative.'; } }
];
let on = false, lang = 'auto', hidden = new Set(), items = [], cursor = {}, timer = null, last = null;

function plural(n, one, many) { return n === 1 ? one : many; }
function goal(n, g) { return n <= g ? 'Well done.' : 'Aim for ' + g + ' or fewer.'; }
function narrow() { return window.matchMedia && matchMedia('(max-width: 700px)').matches; }

/* ---------- read the rendered page as text blocks, remembering which text node each character came from ---------- */
const BLK = 'p,li,h1,h2,h3,h4,h5,h6,td,th,dd,dt,blockquote,div';
function collect() {
  const w = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  const blocks = [];
  let cur = null, br = false, n;
  while ((n = w.nextNode())) {
    if (n.nodeType === 1) { if (n.nodeName === 'BR') br = true; continue; }
    const pe = n.parentElement;
    if (!n.nodeValue || !pe || pe.closest('figure.mm, figure.fm, pre, code, div.raw')) continue;
    const blk = pe.closest(BLK);
    if (!cur || cur.el !== blk) { cur = { el: blk, s: '', segs: [] }; blocks.push(cur); br = false; }
    if (br && cur.s) cur.s += '\n';
    br = false;
    cur.segs.push({ node: n, start: cur.s.length, len: n.nodeValue.length });
    cur.s += n.nodeValue;
  }
  return blocks;
}
function point(b, i, end) {
  const segs = b.segs;
  for (let j = 0; j < segs.length; j++) {
    const g = segs[j];
    if (end ? (i > g.start && i <= g.start + g.len) : (i >= g.start && i < g.start + g.len)) return { node: g.node, off: i - g.start };
    if (!end && i < g.start) return { node: g.node, off: 0 }; // inside an added line break
  }
  return null;
}
function range(b, a, z) {
  const p = point(b, a, false), q = point(b, z, true);
  if (!p || !q) return null;
  const r = document.createRange();
  try { r.setStart(p.node, p.off); r.setEnd(q.node, q.off); } catch (e) { return null; }
  return r;
}

/* ---------- analyze and paint ---------- */
function clear() {
  if (!HL) return;
  KINDS.forEach(function (x) { CSS.highlights.delete(x.hl); });
  CSS.highlights.delete('ml-rx');
}
function refresh() {
  clearTimeout(timer); timer = null;
  if (!on) return;
  if (mode !== 'rendered') { $('#rSrcNote').hidden = false; clear(); return; }
  $('#rSrcNote').hidden = true;
  const blocks = collect(), res = rdAnalyze(blocks.map(function (b) { return b.s; }), lang);
  items = [];
  res.sentences.forEach(function (s) { if (s.level) items.push({ kind: s.level, r: range(blocks[s.blk], s.a, s.b), hint: null }); });
  res.marks.forEach(function (m) { items.push({ kind: m.kind, r: range(blocks[m.blk], m.a, m.b), hint: m.hint }); });
  items = items.filter(function (x) { return x.r; });
  last = res.stats;
  paint();
  render(res.stats);
}
function paint() {
  if (!HL) return;
  clear();
  KINDS.forEach(function (x, i) {
    if (hidden.has(x.k)) return;
    const rs = items.filter(function (it) { return it.kind === x.k; }).map(function (it) { return it.r; });
    if (!rs.length) return;
    const h = new Highlight(...rs);
    h.priority = x.k === 'hard' || x.k === 'vhard' ? 0 : 1; // word colors on top of sentence colors
    CSS.highlights.set(x.hl, h);
  });
}
function schedule() { if (on) { clearTimeout(timer); timer = setTimeout(refresh, 400); } }
new MutationObserver(schedule).observe(doc, { childList: true, characterData: true, subtree: true });
new MutationObserver(schedule).observe(doc, { attributes: true, attributeFilter: ['hidden'] });

/* ---------- panel ---------- */
function render(s) {
  $('#rGradeN').textContent = s.words ? 'Grade ' + s.grade : 'Grade –';
  $('#rGradeL').textContent = s.words ? rdGradeLabel(s.grade) : '';
  $('#rGradeL').dataset.g = s.grade <= 9 ? 'good' : s.grade <= 12 ? 'ok' : 'bad';
  $('#rStats').innerHTML = '<span><b>' + s.words + '</b> words</span><span><b>' + s.sentences + '</b> sentences</span><span><b>' + Math.max(1, Math.round(s.words / 220)) + '</b> min read</span>';
  $('#rList').innerHTML = '';
  KINDS.forEach(function (x) {
    const row = document.createElement('div');
    row.className = 'rrow';
    row.dataset.k = x.k;
    row.classList.toggle('off', hidden.has(x.k));
    const n = s[x.k];
    row.innerHTML = '<label class="rsw" title="Show or hide these highlights"><input type="checkbox"' + (hidden.has(x.k) ? '' : ' checked') + '><i></i></label>' +
      '<button type="button" class="rtxt"' + (n ? ' title="Go to the next one"' : ' disabled') + '>' + x.text(s) + '</button>';
    row.querySelector('input').addEventListener('change', function (e) {
      if (e.target.checked) hidden.delete(x.k); else hidden.add(x.k);
      try { localStorage.setItem(HIDE_KEY, Array.from(hidden).join(',')); } catch (er) { /* ignore */ }
      row.classList.toggle('off', !e.target.checked);
      paint();
    });
    row.querySelector('.rtxt').addEventListener('click', function () { next(x.k); });
    $('#rList').appendChild(row);
  });
  // "Auto" names the language it picked for this document
  $('#rLang').options[0].textContent = 'Auto' + (s.words ? ' (' + LANG_NAMES[s.lang] + ')' : '');
  chip.hidden = !on || !s.words;
  chip.textContent = 'Grade ' + s.grade;
  chip.dataset.g = $('#rGradeL').dataset.g;
}
/* jump to the next item of a kind and mark it */
function next(k) {
  const list = items.filter(function (it) { return it.kind === k; });
  if (!list.length) return;
  const i = ((cursor[k] == null ? -1 : cursor[k]) + 1) % list.length;
  cursor[k] = i;
  const it = list[i], rect = it.r.getBoundingClientRect(), sc = $('#scroll'), top = sc.getBoundingClientRect().top;
  sc.scrollBy({ top: rect.top - top - sc.clientHeight / 3, behavior: 'smooth' });
  if (HL) CSS.highlights.set('ml-rx', new Highlight(it.r));
  if (narrow()) showPanel(false);
  setTimeout(function () { showTip(it, it.r.getBoundingClientRect()); }, 350);
}
function showPanel(v) {
  panel.hidden = !v;
  if (v && narrow()) {
    if (!$('#cpanel').hidden) $('#cClose').click();
    if (!$('#npanel').hidden) $('#nClose').click();
  }
}
function setOn(v, openPanel) {
  on = v;
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
  try { localStorage.setItem(ON_KEY, on ? '1' : ''); } catch (e) { /* ignore */ }
  if (on) { refresh(); if (openPanel) showPanel(true); }
  else { clear(); items = []; showPanel(false); chip.hidden = true; hideTip(); }
}
btn.addEventListener('click', function () { setOn(!on, true); });
$('#rClose').addEventListener('click', function () { showPanel(false); });
$('#rOff').addEventListener('click', function () { setOn(false); });
chip.addEventListener('click', function () { showPanel(panel.hidden); });
/* on a phone the right-hand panels overlap: opening Comments or Notes hides this one */
['#bCom', '#bNotes'].forEach(function (s) { $(s).addEventListener('click', function () { if (narrow() && !panel.hidden) showPanel(false); }); });
document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'r' && !btn.hidden) { e.preventDefault(); setOn(!on, true); }
  else if (e.key === 'Escape') hideTip();
});
const prevLoaded = window.onDocLoaded;
window.onDocLoaded = function () { if (prevLoaded) prevLoaded(); cursor = {}; hideTip(); schedule(); };

/* ---------- tips: point at (or tap) a colored passage to see why ---------- */
function at(x, y) {
  let node = null, off = 0;
  if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { node = p.offsetNode; off = p.offset; } }
  else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (r) { node = r.startContainer; off = r.startOffset; } }
  if (!node) return null;
  let best = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (hidden.has(it.kind)) continue;
    let inside = false;
    try { inside = it.r.comparePoint(node, off) === 0; } catch (e) { inside = false; }
    if (!inside) continue;
    const hit = Array.prototype.some.call(it.r.getClientRects(), function (c) { return x >= c.left && x <= c.right && y >= c.top && y <= c.bottom; });
    if (!hit) continue;
    if (!best || (best.hint === null && it.hint !== null)) best = it; // a word beats its sentence
  }
  return best;
}
function hintOf(it) { return it.hint || KINDS.find(function (x) { return x.k === it.kind; }).hint; }
function showTip(it, rect) {
  tip.textContent = hintOf(it);
  tip.dataset.k = it.kind;
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let left = Math.min(Math.max(8, rect.left), window.innerWidth - w - 8), top = rect.top - h - 6;
  if (top < 8) top = rect.bottom + 6;
  tip.style.left = left + 'px'; tip.style.top = top + 'px';
}
function hideTip() { tip.hidden = true; }
let raf = 0, shown = null;
function onPoint(e) {
  if (!on || mode !== 'rendered' || !items.length) return;
  const x = e.clientX, y = e.clientY;
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(function () {
    const it = at(x, y);
    if (!it) { if (shown) { hideTip(); shown = null; } return; }
    if (it === shown && !tip.hidden) return;
    shown = it;
    const rects = Array.prototype.filter.call(it.r.getClientRects(), function (c) { return y >= c.top - 2 && y <= c.bottom + 2; });
    showTip(it, rects[0] || it.r.getBoundingClientRect());
  });
}
doc.addEventListener('mousemove', onPoint);
doc.addEventListener('click', onPoint);
doc.addEventListener('mouseleave', function () { hideTip(); shown = null; });
$('#scroll').addEventListener('scroll', function () { hideTip(); shown = null; }, { passive: true });
doc.addEventListener('input', function () { hideTip(); shown = null; if (HL) CSS.highlights.delete('ml-rx'); });

$('#rLang').addEventListener('change', function (e) {
  lang = e.target.value;
  try { localStorage.setItem(LANG_KEY, lang === 'auto' ? '' : lang); } catch (er) { /* ignore */ }
  cursor = {}; hideTip(); refresh();
});
try { lang = localStorage.getItem(LANG_KEY) || 'auto'; } catch (e) { /* ignore */ }
if (!LANG_NAMES[lang]) lang = 'auto';
$('#rLang').value = lang;
try { hidden = new Set((localStorage.getItem(HIDE_KEY) || '').split(',').filter(Boolean)); } catch (e) { /* ignore */ }
/* the tool is optional: Settings > Readability shows or hides it */
window.onReadPref = function (enabled) {
  btn.hidden = !enabled;
  if (!enabled && on) setOn(false);
};
btn.hidden = !prefs.read;
try { if (prefs.read && localStorage.getItem(ON_KEY)) setOn(true, !narrow()); } catch (e) { /* ignore */ }
window.__marklineRead = { refresh: refresh, stats: function () { return last; }, items: function () { return items; } };
})();
