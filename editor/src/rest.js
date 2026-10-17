/* one-time move of settings, drafts and comments saved under the app's old name */
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.indexOf('markdown-workbench-') === 0) {
      const nk = 'markline-' + k.slice('markdown-workbench-'.length);
      if (localStorage.getItem(nk) === null) localStorage.setItem(nk, localStorage.getItem(k));
      localStorage.removeItem(k);
    }
  }
} catch (e) { /* storage unavailable */ }

/* ---------- markdown <-> html ---------- */
const MARKED_OPTS = { gfm: true, breaks: false, mangle: false, headerIds: false };
const renderer = new marked.Renderer();
renderer.code = function (code, info) {
  const lang = (info || '').trim().split(/\s+/)[0];
  if (lang === 'mermaid') return '<figure class="mm" data-src="' + esc(code) + '"></figure>\n';
  return '<pre><code' + (lang ? ' class="language-' + esc(lang) + '"' : '') + '>' + esc(code) + '\n</code></pre>\n';
};
MARKED_OPTS.renderer = renderer;

function sanitize(html) {
  const d = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
  d.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,frame,frameset,svg,math').forEach(function (n) { n.remove(); });
  d.querySelectorAll('*').forEach(function (el) {
    Array.from(el.attributes).forEach(function (a) {
      const n = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
      const urlAttr = n === 'href' || n === 'src' || n === 'xlink:href' || n === 'action' || n === 'formaction';
      if (n.indexOf('on') === 0 || n === 'style' || (urlAttr && /^(javascript|vbscript|data):/.test(v) && !(n === 'src' && /^data:image\//.test(v)))) el.removeAttribute(a.name);
    });
  });
  return d.body.innerHTML;
}

const td = createMarkdownConverter(TurndownService, window.turndownPluginGfm && window.turndownPluginGfm.gfm);

const doc = $('#doc'), srcEl = $('#src');
let mode = 'rendered', name = 'sample.md', fileHandle = null, dirty = false, saveTimer = null, countTimer = null, msgTimer = null;
const KEY = 'markline-draft-v1';

function ensureParagraphs() {
  function p() { const e = document.createElement('p'); e.innerHTML = '<br>'; return e; }
  if (!doc.firstElementChild) { doc.appendChild(p()); return; }
  let first = doc.firstElementChild;
  if (first.matches('figure.fm')) { first = first.nextElementSibling; if (!first) { doc.appendChild(p()); return; } }
  if (first.matches('figure.mm,table,pre,hr')) doc.insertBefore(p(), first);
  Array.from(doc.querySelectorAll(':scope > figure.mm')).forEach(function (f) {
    const nx = f.nextElementSibling;
    if (!nx || nx.matches('figure.mm')) f.after(p());
  });
  if (doc.lastElementChild.matches('figure.mm,table,pre,hr')) doc.appendChild(p());
}
/* YAML front matter (--- ... --- at the very top, as in SKILL.md files) is kept verbatim in its own box */
const FM_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
function fmFigure(text) {
  const f = document.createElement('figure');
  f.className = 'fm';
  f.setAttribute('contenteditable', 'false');
  const l = document.createElement('div');
  l.className = 'fm-label';
  l.textContent = 'Front matter';
  const t = document.createElement('textarea');
  t.className = 'fm-text';
  t.spellcheck = false;
  t.setAttribute('aria-label', 'Front matter (YAML)');
  t.value = text;
  t.wrap = 'soft';
  function fit() { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }
  t.addEventListener('input', fit);
  f.appendChild(l); f.appendChild(t);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(f); else setTimeout(fit, 0);
  return f;
}
function blockHtml(html) {
  return Array.from(new DOMParser().parseFromString(html, 'text/html').body.children, function (c) { return c.outerHTML; });
}
/* top-level blocks of the last render, used to highlight what changed on disk */
let lastBlocks = { els: [], html: [] };
function renderBlocks(md) {
  const m = FM_RE.exec(md);
  return blockHtml(sanitize(marked.parse(m ? md.slice(m[0].length) : md, MARKED_OPTS)));
}
function loadMarkdown(md) {
  let fm = null;
  const m = FM_RE.exec(md);
  if (m) { fm = m[1]; md = md.slice(m[0].length); }
  const html = sanitize(marked.parse(md, MARKED_OPTS));
  doc.innerHTML = html;
  lastBlocks = { els: Array.from(doc.children), html: blockHtml(html) };
  if (fm !== null) doc.insertBefore(fmFigure(fm), doc.firstChild);
  doc.querySelectorAll('input[type=checkbox]').forEach(function (c) { c.removeAttribute('disabled'); });
  doc.querySelectorAll('figure.mm').forEach(initBlock);
  ensureParagraphs();
}
function docToMarkdown() {
  const c = doc.cloneNode(true);
  let head = '';
  const fmEl = doc.querySelector('figure.fm textarea');
  c.querySelectorAll('figure.fm').forEach(function (n) { n.remove(); });
  if (fmEl) head = '---\n' + fmEl.value.replace(/\s+$/, '') + '\n---\n\n';
  c.querySelectorAll('img[data-ml-src]').forEach(function (i) { i.setAttribute('src', i.getAttribute('data-ml-src')); i.removeAttribute('data-ml-src'); });
  c.querySelectorAll('pre br').forEach(function (b) { b.replaceWith('\n'); });
  let md = td.turndown(c);
  md = md.replace(/​/g, '').replace(/\n{3,}/g, '\n\n').trim();
  return head ? (md ? head + md + '\n' : head.replace(/\n+$/, '\n')) : md + '\n';
}
function currentMarkdown() { return mode === 'source' ? srcEl.value : docToMarkdown(); }

/* ---------- status ---------- */
function updateStatus() {
  $('#fname').textContent = name;
  $('#dot').hidden = !dirty;
  $('#bSave').classList.toggle('primary', dirty);
  $('#bSave').textContent = dirty ? 'Save' : 'Saved';
  document.title = (dirty ? '● ' : '') + name + ' – Markline';
}
function toast(t) {
  const m = $('#msg');
  m.textContent = t;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(function () { m.textContent = ''; }, 5000);
}
function updateCount() {
  const t = mode === 'source' ? srcEl.value : doc.innerText;
  const n = (t.trim().match(/\S+/g) || []).length;
  $('#wc').textContent = n + (n === 1 ? ' word' : ' words') + ' \u00b7 ' + Math.max(1, Math.round(n / 220)) + ' min read';
}
/* undo/redo: snapshots of the markdown, taken after a pause in typing. Native undo breaks when the DOM is rebuilt (highlights, diagrams).
   Each file keeps its own list for the session, so switching files and coming back keeps the history. */
const HIST_MAX = 500;
const histStore = {};
let H = { list: [], hi: -1 }, histTimer = null, histPending = false, histStart = 0, idleCaret = null, pendingBeforeCaret = null;
function histKey() { return fileHandle && fileHandle.native || null; }
function snapHtml() {
  doc.querySelectorAll('figure.fm textarea').forEach(function (t) { t.textContent = t.value; });
  return doc.innerHTML;
}
function encodePt(node, off) {
  const path = [off];
  let n = node;
  while (n && n !== doc) {
    const p = n.parentNode;
    if (!p) return null;
    path.push(Array.prototype.indexOf.call(p.childNodes, n));
    n = p;
  }
  return n === doc ? path.reverse() : null;
}
function decodePt(path) {
  if (!path || path.length < 1) return null;
  let n = doc;
  for (let i = 0; i < path.length - 1; i++) {
    if (!n.childNodes || !n.childNodes.length) break;
    const idx = Math.min(Math.max(0, path[i]), n.childNodes.length - 1);
    n = n.childNodes[idx];
  }
  const max = n.nodeType === 3 ? n.data.length : (n.childNodes ? n.childNodes.length : 0);
  return { node: n, off: Math.min(Math.max(0, path[path.length - 1]), max) };
}
function readCaret() {
  if (mode === 'source') return { srcStart: srcEl.selectionStart, srcEnd: srcEl.selectionEnd };
  const s = window.getSelection();
  if (!s.rangeCount || !s.anchorNode || !doc.contains(s.anchorNode)) return null;
  const el = s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode;
  if (el && el.closest && el.closest('.mm,.fm')) return null;
  const r = s.getRangeAt(0), sp = encodePt(r.startContainer, r.startOffset), ep = encodePt(r.endContainer, r.endOffset);
  return sp && ep ? { s: sp, e: ep } : null;
}
function restoreCaret(c) {
  if (mode === 'source') {
    srcEl.focus({ preventScroll: true });
    if (c && c.srcStart != null) srcEl.setSelectionRange(c.srcStart, c.srcEnd != null ? c.srcEnd : c.srcStart);
    return true;
  }
  if (!c || !c.s) return false;
  const sp = decodePt(c.s), ep = decodePt(c.e || c.s);
  if (!sp || !ep) return false;
  try {
    const r = document.createRange();
    r.setStart(sp.node, sp.off);
    r.setEnd(ep.node, ep.off);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    doc.focus({ preventScroll: true });
    return true;
  } catch (e) { return false; }
}
document.addEventListener('selectionchange', function () {
  if (!histPending) { const c = readCaret(); if (c) idleCaret = c; }
});
['keyup', 'mouseup', 'select'].forEach(function (ev) {
  srcEl.addEventListener(ev, function () { if (!histPending && mode === 'source') idleCaret = readCaret(); });
});
function onBeforeEdit(e) {
  if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
    const t = e.target, el = t && t.nodeType === 3 ? t.parentElement : t;
    if (el && el !== srcEl && el.closest && el.closest('textarea,input')) return;
    e.preventDefault();
    histGo(e.inputType === 'historyRedo' ? 1 : -1);
    return;
  }
  if (!histPending) pendingBeforeCaret = readCaret() || idleCaret;
}
doc.addEventListener('beforeinput', onBeforeEdit);
srcEl.addEventListener('beforeinput', onBeforeEdit);
function histReset() {
  clearTimeout(histTimer); histPending = false; pendingBeforeCaret = null; idleCaret = null;
  const md = currentMarkdown(), html = mode === 'rendered' ? snapHtml() : null, key = histKey(), old = key && histStore[key];
  if (old && old.list.length) {
    H = old;
    // the file changed on disk since we last saw it (an agent edited it, or Reload): keep the old versions and add this one
    if (H.list[H.list.length - 1].md !== md) { H.list.push({ md: md, html: html, t: Date.now(), why: 'reload' }); histTrim(); }
    else if (html != null) H.list[H.list.length - 1].html = html;
    H.hi = H.list.length - 1;
  } else {
    H = { list: [{ md: md, html: html, t: Date.now(), why: 'open' }], hi: 0 };
    if (key) histStore[key] = H;
  }
  histUi();
}
function histTrim() { while (H.list.length > HIST_MAX) { H.list.shift(); H.hi--; } }
function histAdd(entry) { H.list.length = H.hi + 1; H.list.push(entry); H.hi = H.list.length - 1; histTrim(); }
function histPush() {
  clearTimeout(histTimer);
  const wasPending = histPending;
  histPending = false;
  if (H.hi < 0) { histUi(); return; }
  const md = currentMarkdown(), html = mode === 'rendered' ? snapHtml() : null, cur = H.list[H.hi];
  if (md !== cur.md || (wasPending && mode === 'rendered' && html !== cur.html)) {
    const ac = readCaret() || idleCaret;
    histAdd({ md: md, html: html, beforeCaret: pendingBeforeCaret || cur.afterCaret, afterCaret: ac, t: Date.now(), why: 'edit' });
  }
  pendingBeforeCaret = null;
  idleCaret = readCaret() || idleCaret;
  histUi();
}
// show a snapshot, keeping the scroll position and restoring the exact caret position
function histShow(entry, caret) {
  clearTimeout(histTimer); histPending = false; pendingBeforeCaret = null;
  const md = entry.md, sc = $('#scroll'), top = sc.scrollTop, sTop = srcEl.scrollTop;
  if (mode === 'source') {
    srcEl.value = md;
    numbers();
    restoreCaret(caret);
    srcEl.scrollTop = sTop;
  } else {
    let changedIdx = -1;
    if (entry.html != null) {
      const tmp = document.createElement('div');
      tmp.innerHTML = entry.html;
      const curKids = Array.from(doc.children), newKids = Array.from(tmp.children);
      let p = 0, s = 0;
      while (p < curKids.length && p < newKids.length && curKids[p].outerHTML === newKids[p].outerHTML) p++;
      while (s < curKids.length - p && s < newKids.length - p && curKids[curKids.length - 1 - s].outerHTML === newKids[newKids.length - 1 - s].outerHTML) s++;
      for (let i = curKids.length - 1 - s; i >= p; i--) curKids[i].remove();
      const anchor = doc.children[p] || null;
      const inserted = newKids.slice(p, newKids.length - s);
      inserted.forEach(function (el) { doc.insertBefore(el, anchor); });
      inserted.forEach(function (el) {
        if (el.matches('figure.fm')) {
          const t = el.querySelector('textarea');
          if (t) {
            t.value = t.textContent;
            const fit = function () { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; };
            t.addEventListener('input', fit);
            setTimeout(fit, 0);
          }
        }
        if (el.matches('figure.mm')) initBlock(el);
        el.querySelectorAll('figure.mm').forEach(initBlock);
        el.querySelectorAll('input[type=checkbox]').forEach(function (c) { c.removeAttribute('disabled'); });
      });
      if (p < doc.children.length) changedIdx = p;
      lastBlocks = { els: Array.from(doc.children), html: Array.from(doc.children, function (c) { return c.outerHTML; }) };
    } else {
      const before = Array.from(doc.children).map(function (c) { return c.outerHTML; });
      loadMarkdown(md);
      resolveImages();
      const kids = Array.from(doc.children);
      let i = 0;
      while (i < kids.length && i < before.length && kids[i].outerHTML === before[i]) i++;
      if (i < kids.length) changedIdx = i;
      entry.html = snapHtml();
    }
    if (window.reapplyChanges) window.reapplyChanges();
    if (!restoreCaret(caret)) {
      if (changedIdx >= 0 && doc.children[changedIdx] && !doc.children[changedIdx].matches('figure.mm,figure.fm')) {
        const at = doc.children[changedIdx], r = document.createRange();
        r.selectNodeContents(at); r.collapse(false);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      }
      doc.focus({ preventScroll: true });
    }
  }
  sc.scrollTop = top;
  idleCaret = readCaret() || caret || idleCaret;
  dirty = currentMarkdown() !== cleanMd;
  updateStatus();
  clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 900);
  updateCount();
}
function histGo(step) {
  histPush();
  const n = H.hi + step;
  if (H.hi < 0 || n < 0 || n >= H.list.length) return;
  const caret = step < 0 ? (H.list[H.hi].beforeCaret || H.list[n].afterCaret) : (H.list[n].afterCaret || H.list[n].beforeCaret);
  H.hi = n;
  histShow(H.list[n], caret);
  histUi();
}
// bring back an older version as a new entry at the end, so nothing is lost (not even undone versions)
function histRestore(i) {
  histPush();
  const e = H.list[i];
  if (!e || i === H.hi) return;
  const bc = readCaret() || idleCaret;
  H.list.push({ md: e.md, html: e.html, beforeCaret: bc, afterCaret: e.afterCaret || e.beforeCaret, t: Date.now(), why: 'restore', from: e.t });
  H.hi = H.list.length - 1; histTrim();
  histShow(H.list[H.hi], e.afterCaret || e.beforeCaret);
  histUi();
  toast('Restored the version from ' + histTime(e.t));
}
document.addEventListener('keydown', function (e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k !== 'z' && k !== 'y') return;
  const t = e.target, el = t && t.nodeType === 3 ? t.parentElement : t;
  if (el && el !== srcEl && el.closest && el.closest('textarea,input')) return;
  e.preventDefault();
  e.stopPropagation();
  histGo(k === 'y' || e.shiftKey ? 1 : -1);
}, true);

/* ---------- history panel ---------- */
const histBox = $('#histbox');
function histTime(t) {
  const d = new Date(t), now = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return d.toDateString() === now.toDateString() ? time : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}
function histWords(s) { return (s.match(/\S+/g) || []).length; }
function histClip(s) {
  s = s.replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, '').replace(/[*_`]+/g, '').trim();
  return s.length > 70 ? s.slice(0, 69) + '\u2026' : s;
}
// what changed between two snapshots: the first changed line and how many words were added or removed
function histDescribe(i) {
  const e = H.list[i];
  if (e.why === 'open' || i === 0) return { text: 'Opened', meta: '' };
  if (e.why === 'reload') return { text: 'Reloaded from disk', meta: '' };
  if (e.why === 'restore') return { text: 'Restored the version from ' + histTime(e.from), meta: '' };
  const a = H.list[i - 1].md.split('\n'), b = e.md.split('\n');
  let p = 0, s = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const added = b.slice(p, b.length - s).filter(function (l) { return l.trim(); });
  const removed = a.slice(p, a.length - s).filter(function (l) { return l.trim(); });
  const dw = histWords(e.md) - histWords(H.list[i - 1].md);
  const text = added.length ? histClip(added[0]) : removed.length ? 'Deleted: ' + histClip(removed[0]) : 'Blank lines';
  return { text: text || 'Formatting', meta: dw > 0 ? '+' + dw + (dw === 1 ? ' word' : ' words') : dw < 0 ? '\u2212' + -dw + (dw === -1 ? ' word' : ' words') : 'Edited' };
}
function histRender() {
  if (histBox.hidden) return;
  const ul = $('#histList');
  ul.textContent = '';
  $('#histCount').textContent = H.list.length ? '(' + H.list.length + ')' : '';
  for (let i = H.list.length - 1; i >= 0; i--) {
    const d = histDescribe(i), li = document.createElement('li');
    li.className = 'hitem' + (i === H.hi ? ' cur' : '') + (i > H.hi ? ' undone' : '');
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.title = i === H.hi ? 'This is what you see now' : 'Bring this version back';
    const top = document.createElement('div'); top.className = 'hmeta';
    const tm = document.createElement('span'); tm.textContent = histTime(H.list[i].t); top.appendChild(tm);
    if (d.meta) { const m = document.createElement('span'); m.textContent = d.meta; top.appendChild(m); }
    if (i === H.hi) { const c = document.createElement('span'); c.className = 'htag'; c.textContent = 'Current'; top.appendChild(c); }
    else if (i > H.hi) { const c = document.createElement('span'); c.className = 'htag'; c.textContent = 'Undone'; top.appendChild(c); }
    const tx = document.createElement('div'); tx.className = 'htext'; tx.textContent = d.text;
    li.appendChild(top); li.appendChild(tx);
    const go = function () { if (i !== H.hi) histRestore(i); };
    li.addEventListener('click', go);
    li.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
    ul.appendChild(li);
  }
}
function histUi() {
  $('#bUndo').disabled = !(H.hi > 0 || histPending);
  $('#bRedo').disabled = !(H.hi < H.list.length - 1);
  histRender();
}
function toggleHist(on) {
  histBox.hidden = on == null ? !histBox.hidden : !on;
  $('#bHist').setAttribute('aria-pressed', String(!histBox.hidden));
  $('#bHist').classList.toggle('on', !histBox.hidden);
  if (!histBox.hidden) { histPush(); histRender(); }
}
$('#bUndo').addEventListener('click', function () { histGo(-1); });
$('#bRedo').addEventListener('click', function () { histGo(1); });
$('#bHist').addEventListener('click', function () { toggleHist(); });
$('#histClose').addEventListener('click', function () { toggleHist(false); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !histBox.hidden) toggleHist(false); });

function markDirty() {
  if (!histPending) {
    if (!pendingBeforeCaret) pendingBeforeCaret = idleCaret || readCaret();
    histStart = Date.now();
    histPending = true;
    histUi();
  }
  clearTimeout(histTimer); histTimer = setTimeout(histPush, 350);
  dirty = true; updateStatus();
  clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 900);
  clearTimeout(countTimer); countTimer = setTimeout(updateCount, 300);
}
function saveDraft() {
  try { localStorage.setItem(KEY, JSON.stringify({ name: name, md: currentMarkdown(), path: fileHandle && fileHandle.native || null, dirty: dirty })); } catch (e) { /* storage unavailable */ }
}
function ask(text, yesLabel, fn) {
  $('#confirmText').textContent = text;
  $('#confirmYes').textContent = yesLabel || 'Continue';
  askFn = fn;
  $('#confirm').hidden = false;
}
$('#confirmYes').addEventListener('click', function () { const f = askFn; askFn = null; $('#confirm').hidden = true; if (f) f(); });
$('#confirmNo').addEventListener('click', function () { askFn = null; $('#confirm').hidden = true; });
function guard(fn) {
  if (dirty && currentMarkdown() === cleanMd) { dirty = false; updateStatus(); }
  if (dirty) ask('You have unsaved changes. Discard them?', 'Discard', fn); else fn();
}
/* leaving the current file: write it back silently when it already lives on disk, otherwise ask */
function hasTarget() { return !!(fileHandle && (fileHandle.native || fileHandle.createWritable)); }
async function leave(fn) {
  if (dirty && currentMarkdown() === cleanMd) { dirty = false; updateStatus(); }
  if (!dirty || !hasTarget()) { guard(fn); return; }
  const prev = name;
  const r = await io.save();
  if (r === 'file') { afterSave(); toast('Saved ' + mdName(prev)); fn(); }
  else guard(fn);
}

/* ---------- file adapter (swap this object for Tauri's dialogs later) ---------- */
const MD_TYPES = [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }];
let dlPromise = null;
function getDownloads() {
  if (!dlPromise) dlPromise = (window.claude && window.claude.use) ? window.claude.use('downloads').catch(function () { return null; }) : Promise.resolve(null);
  return dlPromise;
}
function mdName(n) { return /\.(md|markdown)$/i.test(n) ? n : (n.replace(/\.[^.]*$/, '') || 'untitled') + '.md'; }
// Relative image paths resolve against the folder of the open file. The markdown keeps the original path in data-ml-src.
function resolveImages() {
  const p = fileHandle && fileHandle.native;
  if (!p) return;
  const sep = p.indexOf('\\') >= 0 && p.indexOf('/') < 0 ? '\\' : '/';
  doc.querySelectorAll('img').forEach(function (img) {
    const src = img.getAttribute('src') || '';
    if (!src || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)) return;
    let rel = src.split(/[?#]/)[0];
    try { rel = decodeURIComponent(rel); } catch (e) { /* keep raw */ }
    const parts = p.split(/[\\/]/); parts.pop();
    rel.split('/').forEach(function (seg) {
      if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg);
    });
    if (!rel.indexOf('/')) return;
    const abs = parts.join(sep);
    img.setAttribute('data-ml-src', src);
    img.setAttribute('src', window.__MARKLINE_WEB__ ? '/file?path=' + encodeURIComponent(abs) : window.__TAURI__.core.convertFileSrc(abs));
  });
}
let diskText = '', cleanMd = null;
function markClean() { dirty = false; cleanMd = currentMarkdown(); updateStatus(); saveDraft(); }
const scrollPos = {};
function loadDoc(text, fname, handle) {
  const sc = $('#scroll'), was = fileHandle && fileHandle.native;
  if (was) scrollPos[was] = sc.scrollTop;
  mode = 'rendered';
  setModeUi();
  name = fname || 'untitled.md';
  fileHandle = handle || null;
  diskText = text;
  loadMarkdown(text);
  resolveImages();
  markClean();
  histReset();
  updateCount();
  if (window.syncActive) window.syncActive();
  if (window.onDocLoaded) window.onDocLoaded();
  const top = handle && handle.native && scrollPos[handle.native] || 0;
  sc.scrollTop = top;
  requestAnimationFrame(function () { sc.scrollTop = top; });
}
const TAURI = window.__TAURI__ && window.__TAURI__.core ? window.__TAURI__.core : null;
const io = {
  open: async function () {
    if (TAURI) {
      const f = await TAURI.invoke('open_file');
      if (f) loadDoc(f.text, f.name, { native: f.path });
      return;
    }
    if (window.showOpenFilePicker) {
      try {
        const r = await window.showOpenFilePicker({ types: MD_TYPES });
        const h = r[0], file = await h.getFile();
        loadDoc(await file.text(), file.name, h);
        return;
      } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    $('#file').click();
  },
  save: async function () {
    const md = currentMarkdown();
    if (TAURI) {
      const res = await TAURI.invoke('save_file', { path: fileHandle && fileHandle.native || null, suggested: mdName(name), text: md });
      if (!res) return 'cancel';
      fileHandle = { native: res.path }; name = res.name;
      return 'file';
    }
    if (fileHandle && fileHandle.createWritable) {
      try { const w = await fileHandle.createWritable(); await w.write(md); await w.close(); return 'file'; }
      catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
    }
    if (window.showSaveFilePicker) {
      try {
        const h = await window.showSaveFilePicker({ suggestedName: mdName(name), types: MD_TYPES });
        const w = await h.createWritable(); await w.write(md); await w.close();
        fileHandle = h; name = h.name || name;
        return 'file';
      } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
    }
    const dl = await getDownloads();
    if (dl) {
      try { await dl.save({ filename: mdName(name), data: md }); return 'download'; }
      catch (e) { if (e && e.code === 'declined') return 'cancel'; }
    }
    try { await navigator.clipboard.writeText(md); return 'clipboard'; } catch (e) { return 'failed'; }
  }
};
function afterSave() {
  markClean();
  if (window.syncActive) window.syncActive();
  if (window.onDocSaved) window.onDocSaved();
}
async function doSave() {
  const r = await io.save();
  if (r === 'file' || r === 'download') { afterSave(); toast('Saved ' + mdName(name)); }
  else if (r === 'clipboard') toast('Copied the markdown to your clipboard. This page cannot write files here.');
  else if (r === 'failed') toast('Could not save. Switch to Source and copy the text.');
}
function readFile(file, handle) {
  const rd = new FileReader();
  rd.onload = function () { loadDoc(String(rd.result), file.name, handle); toast('Opened ' + file.name); };
  rd.onerror = function () { toast('Could not read that file.'); };
  rd.readAsText(file);
}
$('#file').addEventListener('change', function (e) {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (f) readFile(f, null);
});
window.addEventListener('dragover', function (e) { e.preventDefault(); });
window.addEventListener('drop', function (e) {
  e.preventDefault();
  const dt = e.dataTransfer;
  const f = dt && dt.files && dt.files[0];
  if (!f) return;
  const item = dt.items && dt.items[0];
  const hp = item && item.getAsFileSystemHandle ? item.getAsFileSystemHandle().catch(function () { return null; }) : Promise.resolve(null);
  leave(function () { hp.then(function (h) { readFile(f, h && h.kind === 'file' ? h : null); }); });
});
// A click on a link opens it: web links in the system browser, relative markdown links in the editor.
doc.addEventListener('click', function (e) {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href') || '';
  if (/^(https?:|mailto:)/i.test(href)) {
    e.preventDefault();
    if (TAURI && !window.__MARKLINE_WEB__) TAURI.invoke('open_url', { url: href }).catch(function () { toast('Could not open ' + href); });
    else window.open(href, '_blank', 'noopener');
    return;
  }
  const cur = fileHandle && fileHandle.native;
  if (!cur || !TAURI) return;
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) return;
  let rel = href.split(/[?#]/)[0];
  try { rel = decodeURIComponent(rel); } catch (err) { /* keep raw */ }
  if (!/\.(md|markdown|txt)$/i.test(rel)) return;
  e.preventDefault();
  const parts = cur.split(/[\\/]/);
  const sep = cur.indexOf('\\') >= 0 && cur.indexOf('/') < 0 ? '\\' : '/';
  parts.pop();
  rel.split('/').forEach(function (seg) {
    if (seg === '..') parts.pop(); else if (seg && seg !== '.') parts.push(seg);
  });
  const abs = (rel[0] === '/' ? '' : parts.join(sep)) + (rel[0] === '/' ? rel : '');
  leave(async function () {
    try { const f = await TAURI.invoke('read_file', { path: abs }); loadDoc(f.text, f.name, { native: f.path }); }
    catch (err) { toast('Could not open ' + rel); }
  });
});
$('#bOpen').addEventListener('click', function () { leave(function () { io.open(); }); });
$('#bSave').addEventListener('click', doSave);
$('#bNew').addEventListener('click', function () {
  leave(function () { loadDoc('', 'untitled.md', null); doc.focus(); });
});
document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); doSave(); }
});

/* ---------- settings: theme, text sizes, font, page width ---------- */
const TKEY = 'markline-theme-v1', THEMES = ['auto', 'dark', 'light'];
const ZKEY = 'markline-zoom-v1', WKEY = 'markline-width-v1', PKEY = 'markline-prefs-v1';
const WSTEPS = [['Narrow', '660px'], ['Default', '792px'], ['Wide', '980px'], ['Wider', '1200px'], ['Widest', '1500px'], ['Full', 'none']];
const ZSTEPS = [0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const FONTS = { sans: '', serif: "Georgia, 'Times New Roman', serif", mono: 'var(--font-mono)' };
const PDEF = { ui: 1, code: 14, lh: 1.65, font: 'sans', nums: false };
const rootStyle = document.documentElement.style;
let theme = 'auto', zoom = 1, widx = 1, prefs = Object.assign({}, PDEF);
try {
  const t = localStorage.getItem(TKEY); if (THEMES.indexOf(t) >= 0) theme = t;
  const z = parseFloat(localStorage.getItem(ZKEY)); if (z >= 0.6 && z <= 3) zoom = z;
  const w = parseInt(localStorage.getItem(WKEY), 10); if (w >= 0 && w < WSTEPS.length) widx = w;
  Object.assign(prefs, JSON.parse(localStorage.getItem(PKEY) || '{}'));
} catch (e) { /* defaults */ }
function keep(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
/* Source view gutter: an invisible copy of the text wraps like the textarea, so each number sits on its real markdown line */
function numbers() {
  if (mode !== 'source' || !$('#srcwrap').classList.contains('nums')) return;
  const inner = $('#srcnumin'), frag = document.createDocumentFragment();
  srcEl.value.split('\n').forEach(function (t, i) {
    const d = document.createElement('div'); d.dataset.n = String(i + 1); d.textContent = t || ' '; frag.appendChild(d);
  });
  inner.textContent = ''; inner.appendChild(frag);
  inner.style.width = srcEl.clientWidth + 'px';
  inner.style.transform = 'translateY(' + -srcEl.scrollTop + 'px)';
}
srcEl.addEventListener('input', numbers);
srcEl.addEventListener('scroll', numbers);
window.addEventListener('resize', numbers);
function setTheme(t) {
  theme = t;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  $('#setTheme').value = t;
  keep(TKEY, t);
}
function setZoom(z) {
  zoom = Math.min(3, Math.max(0.6, Math.round(z * 100) / 100));
  rootStyle.setProperty('--zoom', String(zoom));
  $('#setText').value = Math.round(zoom * 100);
  $('#setTextV').textContent = Math.round(zoom * 100) + '%';
  keep(ZKEY, String(zoom));
  numbers();
}
function stepZoom(dir) {
  let i = 0;
  for (let k = 0; k < ZSTEPS.length; k++) if (ZSTEPS[k] <= zoom + 0.001) i = k;
  setZoom(ZSTEPS[Math.min(ZSTEPS.length - 1, Math.max(0, i + dir))]);
}
function setWidth(i) {
  widx = Math.min(WSTEPS.length - 1, Math.max(0, i));
  rootStyle.setProperty('--colw', WSTEPS[widx][1]);
  $('#setWidth').value = String(widx);
  keep(WKEY, String(widx));
  numbers();
}
function setPrefs(p) {
  Object.assign(prefs, p);
  rootStyle.setProperty('--uizoom', String(prefs.ui));
  rootStyle.setProperty('--code', prefs.code + 'px');
  rootStyle.setProperty('--lh', String(prefs.lh));
  if (FONTS[prefs.font]) rootStyle.setProperty('--font-doc', FONTS[prefs.font]); else rootStyle.removeProperty('--font-doc');
  $('#setUi').value = Math.round(prefs.ui * 100); $('#setUiV').textContent = Math.round(prefs.ui * 100) + '%';
  $('#setCode').value = prefs.code; $('#setCodeV').textContent = prefs.code + 'px';
  $('#setLh').value = prefs.lh; $('#setLhV').textContent = Number(prefs.lh).toFixed(2);
  $('#setFont').value = prefs.font;
  $('#setNums').checked = !!prefs.nums;
  $('#srcwrap').classList.toggle('nums', !!prefs.nums);
  numbers();
  keep(PKEY, JSON.stringify(prefs));
}
WSTEPS.forEach(function (w, i) { const o = document.createElement('option'); o.value = String(i); o.textContent = w[0]; $('#setWidth').appendChild(o); });
$('#setTheme').addEventListener('change', function (e) { setTheme(e.target.value); });
$('#setText').addEventListener('input', function (e) { setZoom(e.target.value / 100); });
$('#setUi').addEventListener('input', function (e) { setPrefs({ ui: e.target.value / 100 }); });
$('#setCode').addEventListener('input', function (e) { setPrefs({ code: Number(e.target.value) }); });
$('#setLh').addEventListener('input', function (e) { setPrefs({ lh: Number(e.target.value) }); });
$('#setNums').addEventListener('change', function (e) { setPrefs({ nums: e.target.checked }); });
$('#setFont').addEventListener('change', function (e) { setPrefs({ font: e.target.value }); });
$('#setWidth').addEventListener('change', function (e) { setWidth(parseInt(e.target.value, 10)); });
$('#setReset').addEventListener('click', function () { setTheme('auto'); setZoom(1); setWidth(1); setPrefs(PDEF); });
const setBox = $('#settings');
function toggleSettings(on) {
  setBox.hidden = on == null ? !setBox.hidden : !on;
  $('#bSet').setAttribute('aria-pressed', String(!setBox.hidden));
  $('#bSet').classList.toggle('on', !setBox.hidden);
}
$('#bSet').addEventListener('click', function () { toggleSettings(); });
$('#setClose').addEventListener('click', function () { toggleSettings(false); });
document.addEventListener('keydown', function (e) {
  const m = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape' && !setBox.hidden) toggleSettings(false);
  else if (m && !e.altKey && e.key === ',') { e.preventDefault(); toggleSettings(); }
  else if (m && !e.altKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); stepZoom(1); }
  else if (m && !e.altKey && (e.key === '-' || e.key === '_')) { e.preventDefault(); stepZoom(-1); }
  else if (m && !e.altKey && e.key === '0') { e.preventDefault(); setZoom(1); }
});
document.addEventListener('wheel', function (e) {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault(); stepZoom(e.deltaY < 0 ? 1 : -1);
}, { passive: false });
setTheme(theme); setZoom(zoom); setWidth(widx); setPrefs({});

/* ---------- folder panel (desktop app only) ---------- */
(function () {
  if (!TAURI) return;
  const side = $('#side'), tree = $('#tree'), rail = $('#rail');
  const RKEY = 'markline-folder-v1', OKEY = 'markline-panel-v1';
  let root = null, tab = 'files', outTimer = null;
  const open = new Set(), outline = $('#outline'), TKEY = 'markline-tab-v1';
  rail.hidden = false;
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function base(p) { return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p; }
  function showPanel(on) {
    side.hidden = !on;
    syncRail();
    lsSet(OKEY, on ? '1' : '0');
    if (on && tab === 'files' && !root) pickFolder();
    drawOutline();
  }
  function curPath() { return fileHandle && fileHandle.native || null; }
  function syncActive() {
    const cp = curPath();
    tree.querySelectorAll('.row.active').forEach(function (n) { n.classList.remove('active'); });
    if (!cp) return;
    tree.querySelectorAll('.row[data-path]').forEach(function (n) { if (n.dataset.path === cp) n.classList.add('active'); });
  }
  window.syncActive = syncActive;
  async function fill(ul, path) {
    ul.innerHTML = '';
    let items;
    try { items = await TAURI.invoke('list_dir', { path: path }); }
    catch (e) { const d = document.createElement('div'); d.className = 'err'; d.textContent = 'Cannot read this folder'; ul.appendChild(d); return; }
    if (!items.length) { const d = document.createElement('div'); d.className = 'err'; d.textContent = path === root ? 'No markdown files here' : '(empty)'; d.style.color = 'var(--muted)'; ul.appendChild(d); }
    items.forEach(function (it) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'row';
      row.dataset.path = it.path;
      row.setAttribute('role', 'treeitem');
      row.title = it.path;
      row.innerHTML = '<span class="tic">' + (it.is_dir ? (open.has(it.path) ? '&#9662;' : '&#9656;') : '<svg class="ic" width="14" height="14"><use href="#i-file"/></svg>') + '</span><span class="nm"></span>';
      row.querySelector('.nm').textContent = it.name;
      li.appendChild(row);
      if (it.is_dir) {
        const sub = document.createElement('ul');
        li.appendChild(sub);
        if (open.has(it.path)) fill(sub, it.path).then(syncActive);
        row.addEventListener('click', function () {
          if (open.has(it.path)) { open.delete(it.path); sub.innerHTML = ''; row.querySelector('.tic').innerHTML = '&#9656;'; }
          else { open.add(it.path); row.querySelector('.tic').innerHTML = '&#9662;'; fill(sub, it.path).then(syncActive); }
        });
      } else {
        row.addEventListener('click', function () {
          if (it.path === curPath()) return;
          leave(async function () {
            try { const f = await TAURI.invoke('read_file', { path: it.path }); loadDoc(f.text, f.name, { native: f.path }); }
            catch (e) { toast('Could not open ' + it.name); }
          });
        });
      }
      ul.appendChild(li);
    });
  }
  async function render() {
    tree.innerHTML = '';
    if (!root) { tree.innerHTML = '<div class="empty">No folder open.<br>Click <b>Open&hellip;</b> to choose one.</div>'; $('#sideName').textContent = 'Folder'; $('#sideName').title = ''; return; }
    $('#sideName').textContent = base(root);
    $('#sideName').title = root;
    const ul = document.createElement('ul');
    tree.appendChild(ul);
    await fill(ul, root);
    syncActive();
  }
  async function pickFolder() {
    const p = await TAURI.invoke('pick_folder');
    if (!p) return;
    root = p; open.clear(); lsSet(RKEY, p);
    render();
  }
  function drawOutline() {
    if (side.hidden || tab !== 'outline') return;
    outline.textContent = '';
    function note(t) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = t; outline.appendChild(d); }
    if (mode !== 'rendered') { note('Switch to Rendered to see the outline.'); return; }
    const hs = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(function (h) { return h.textContent.trim(); });
    if (!hs.length) { note('No headings in this document.'); return; }
    const top = Math.min.apply(null, hs.map(function (h) { return +h.tagName[1]; }));
    hs.forEach(function (h) {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.paddingLeft = (8 + (+h.tagName[1] - top) * 14) + 'px';
      row.textContent = row.title = h.textContent.trim();
      row.addEventListener('click', function () {
        h.scrollIntoView({ block: 'start', behavior: 'smooth' });
        if (window.matchMedia('(max-width: 700px)').matches) showPanel(false);
      });
      outline.appendChild(row);
    });
  }
  function setTab(next) {
    tab = next; lsSet(TKEY, next);
    const files = next === 'files';
    tree.hidden = !files; outline.hidden = files;
    $('#sideOpen').hidden = $('#sideRefresh').hidden = !files;
    $('#sideName').textContent = files ? (root ? base(root) : 'Folder') : 'Outline';
    $('#sideName').title = files && root || '';
    syncRail();
    drawOutline();
  }
  function syncRail() {
    ['files', 'outline'].forEach(function (t) {
      const b = $(t === 'files' ? '#tabFiles' : '#tabOutline'), on = !side.hidden && tab === t;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    });
  }
  // a rail tab opens its panel, switches to it, or hides the panel when it is already showing
  function pickTab(next) {
    if (!side.hidden && tab === next) { showPanel(false); return; }
    setTab(next); showPanel(true);
  }
  $('#tabFiles').addEventListener('click', function () { pickTab('files'); });
  $('#tabOutline').addEventListener('click', function () { pickTab('outline'); });
  new MutationObserver(function () { clearTimeout(outTimer); outTimer = setTimeout(drawOutline, 300); })
    .observe(doc, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  $('#sideOpen').addEventListener('click', pickFolder);
  $('#sideRefresh').addEventListener('click', render);
  $('#sideClose').addEventListener('click', function () { showPanel(false); });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === '\\') { e.preventDefault(); showPanel(side.hidden); }
  });
  // a file opened some other way (Open..., command line) inside the open folder gets highlighted too
  root = lsGet(RKEY);
  window.marklineRoot = function () { return root; };
  if (lsGet(OKEY) === '1') { side.hidden = false; render(); }
  setTab(lsGet(TKEY) === 'outline' ? 'outline' : 'files');
  // launched on a folder (`markline DIR` or "Open With Markline" in the file manager): show it in the Files panel
  TAURI.invoke('initial_folder').then(function (p) {
    if (!p) return;
    root = p; open.clear(); lsSet(RKEY, p);
    setTab('files'); showPanel(true); render();
  }).catch(function () {});
})();

/* ---------- modes ---------- */
function setModeUi() {
  $('#mR').classList.toggle('on', mode === 'rendered');
  $('#mS').classList.toggle('on', mode === 'source');
  $('#mR').setAttribute('aria-pressed', String(mode === 'rendered'));
  $('#mS').setAttribute('aria-pressed', String(mode === 'source'));
  doc.hidden = mode !== 'rendered';
  $('#srcwrap').hidden = mode !== 'source';
  $('#tools').classList.toggle('off', mode !== 'rendered');
  histUi();
}
function setMode(next) {
  if (next === mode) return;
  if (next === 'source') { histPush(); srcEl.value = docToMarkdown(); mode = 'source'; setModeUi(); numbers(); srcEl.focus(); }
  else { const md = srcEl.value; mode = 'rendered'; setModeUi(); loadMarkdown(md); resolveImages(); if (window.reapplyChanges) window.reapplyChanges(); histPush(); doc.focus(); }
  updateCount();
}
$('#mR').addEventListener('click', function () { setMode('rendered'); });
$('#mS').addEventListener('click', function () { setMode('source'); });
srcEl.addEventListener('input', function (e) {
  markDirty();
  if (histPending && Date.now() - histStart > 1200 && (e.data === ' ' || e.inputType === 'insertLineBreak')) histPush();
});

/* ---------- editing ---------- */
let saved = null;
document.addEventListener('selectionchange', function () {
  const s = window.getSelection();
  if (!s.rangeCount || !s.anchorNode || !doc.contains(s.anchorNode)) return;
  const el = s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode;
  if (el && el.closest && el.closest('.mm')) return;
  saved = s.getRangeAt(0).cloneRange();
});
function focusDoc() {
  doc.focus();
  if (saved) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(saved); }
}
function curBlock() {
  const s = window.getSelection();
  let n = s.rangeCount ? s.anchorNode : null;
  if (!n) return null;
  if (n.nodeType === 3) n = n.parentElement;
  while (n && n !== doc) {
    if (/^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE)$/.test(n.nodeName)) return n;
    n = n.parentElement;
  }
  return null;
}
function topBlock() {
  const s = window.getSelection();
  let n = s.rangeCount ? s.anchorNode : null;
  while (n && n.parentNode !== doc) n = n.parentNode;
  return n && n.nodeType === 1 ? n : null;
}
function insertAfterTop(el) {
  const b = topBlock();
  if (b && b.nodeName === 'P' && !b.textContent.replace(/​/g, '').trim() && !b.querySelector('img')) b.replaceWith(el);
  else if (b) b.after(el);
  else doc.appendChild(el);
  ensureParagraphs();
}
function toggleBlock(tag) {
  const blk = curBlock();
  if (tag === 'blockquote' && blk) {
    const bq = blk.closest('blockquote');
    if (bq) { while (bq.firstChild) bq.parentNode.insertBefore(bq.firstChild, bq); bq.remove(); return; }
  }
  const cur = blk ? blk.nodeName.toLowerCase() : '';
  document.execCommand('formatBlock', false, '<' + (cur === tag ? 'p' : tag) + '>');
}
function blockOf(n) {
  if (n.nodeType === 3) n = n.parentElement;
  while (n && n !== doc) {
    if (/^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE|TD|TH)$/.test(n.nodeName)) return n;
    n = n.parentElement;
  }
  return null;
}
/* true when everything selected (or the caret) sits inside an element matching sel */
function coveredBy(sel, exclude) {
  const s = window.getSelection();
  if (!s.rangeCount) return false;
  const r = s.getRangeAt(0);
  let ca = r.commonAncestorContainer;
  if (ca.nodeType === 3) ca = ca.parentElement;
  if (!ca || !ca.closest) return false;
  if (exclude && ca.closest(exclude)) return false;
  const x = ca.closest(sel);
  if (x && x !== doc && doc.contains(x)) return true;
  if (r.collapsed) return false;
  const frag = r.cloneContents();
  const w = document.createTreeWalker(frag, NodeFilter.SHOW_TEXT);
  let seen = 0, n;
  while ((n = w.nextNode())) {
    if (!n.data.trim()) continue;
    seen++;
    const p = n.parentElement;
    if (!p || !p.closest(sel)) return false;
  }
  return seen > 0;
}
function unwrapCodeInSelection() {
  const s = window.getSelection();
  const r = s.getRangeAt(0);
  const codes = Array.from(doc.querySelectorAll('code')).filter(function (c) {
    if (c.closest('pre')) return false;
    const cr = document.createRange();
    cr.selectNodeContents(c);
    return r.compareBoundaryPoints(Range.END_TO_START, cr) < 0 && r.compareBoundaryPoints(Range.START_TO_END, cr) > 0;
  });
  if (!codes.length) return false;
  let first = null, last = null;
  codes.forEach(function (c) {
    const kids = Array.from(c.childNodes);
    if (!kids.length) { c.remove(); return; }
    if (!first) first = kids[0];
    last = kids[kids.length - 1];
    c.replaceWith.apply(c, kids);
  });
  if (first && last) {
    const nr = document.createRange();
    nr.setStartBefore(first); nr.setEndAfter(last);
    s.removeAllRanges(); s.addRange(nr);
  }
  return true;
}
function exitCode() {
  const s = window.getSelection();
  let e = s.anchorNode;
  if (e.nodeType === 3) e = e.parentElement;
  const code = e && e.closest ? e.closest('code') : null;
  if (!code) return;
  const z = document.createTextNode('​');
  code.after(z);
  s.collapse(z, 1);
}
function inlineCode() {
  const s = window.getSelection();
  if (!s.rangeCount) return;
  const r = s.getRangeAt(0);
  if (coveredBy('code', 'pre')) {
    if (r.collapsed) exitCode(); else unwrapCodeInSelection();
    return;
  }
  if (r.collapsed) { toast('Select some text first.'); return; }
  const b1 = blockOf(r.startContainer), b2 = blockOf(r.endContainer);
  if (b1 && b1.nodeName === 'PRE') { toast('This is already a code block.'); return; }
  if (b1 !== b2) { toast('Select text within one paragraph.'); return; }
  // insert the element directly: Chrome's insertHTML turns <code> into a styled <span>
  const nc = document.createElement('code');
  nc.textContent = s.toString();
  r.deleteContents();
  r.insertNode(nc);
  const nr = document.createRange();
  nr.selectNodeContents(nc);
  s.removeAllRanges(); s.addRange(nr);
}
/* one Code button: words inside a line become inline code, several lines (or nothing) become a code block */
function codeTool() {
  const s = window.getSelection();
  if (!s.rangeCount) return;
  const r = s.getRangeAt(0);
  const b1 = blockOf(r.startContainer), b2 = blockOf(r.endContainer);
  if (b1 && b1.nodeName === 'PRE') { toast('This is already a code block.'); return; }
  if (coveredBy('code', 'pre') || (!r.collapsed && b1 === b2)) { inlineCode(); return; }
  if (r.collapsed) { insertCodeBlock(); return; }
  const text = s.toString().replace(/\n{2,}/g, '\n').replace(/\n+$/, '');
  const top1 = topBlock();
  r.deleteContents();
  const pre = document.createElement('pre'), code = document.createElement('code');
  code.textContent = text; pre.appendChild(code);
  if (top1 && doc.contains(top1)) top1.after(pre); else doc.appendChild(pre);
  // drop the paragraphs the selection emptied out
  [pre.previousElementSibling, pre.nextElementSibling].forEach(function (b) {
    if (b && b.nodeName === 'P' && !b.textContent.replace(/\u200B/g, '').trim() && !b.querySelector('img')) b.remove();
  });
  ensureParagraphs();
  s.collapse(code, code.childNodes.length);
}
function insertCodeBlock() {
  const pre = document.createElement('pre'), code = document.createElement('code');
  code.appendChild(document.createElement('br')); pre.appendChild(code);
  insertAfterTop(pre);
  window.getSelection().collapse(code, 0);
}
function insertTable() {
  const t = document.createElement('table');
  t.innerHTML = '<thead><tr><th>Column</th><th>Column</th><th>Column</th></tr></thead><tbody><tr><td><br></td><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td><td><br></td></tr></tbody>';
  insertAfterTop(t);
  window.getSelection().collapse(t.querySelector('td'), 0);
}
function insertDiagram(kind) {
  const fig = document.createElement('figure');
  fig.className = 'mm';
  fig.setAttribute('data-src', STARTERS[kind] || STARTERS.flow);
  insertAfterTop(fig);
  initBlock(fig);
  selectFig(fig);
  fig.scrollIntoView({ block: 'nearest' });
}
function runTool(t) {
  if (mode !== 'rendered') return;
  histPush();
  focusDoc();
  const bc = readCaret() || idleCaret;
  if (t.indexOf('d:') === 0) { insertDiagram(t.slice(2)); pendingBeforeCaret = bc; markDirty(); histPush(); return; }
  switch (t) {
    case 'h1': case 'h2': case 'h3': toggleBlock(t); break;
    case 'bold': document.execCommand('bold'); break;
    case 'italic': document.execCommand('italic'); break;
    case 'code': codeTool(); break;
    case 'ul': document.execCommand('insertUnorderedList'); break;
    case 'ol': document.execCommand('insertOrderedList'); break;
    case 'quote': toggleBlock('blockquote'); break;
    case 'table': insertTable(); break;
  }
  pendingBeforeCaret = bc;
  markDirty();
  histPush();
  updateToolState();
}
function updateToolState() {
  const s = window.getSelection();
  if (!s.rangeCount || !s.anchorNode || !doc.contains(s.anchorNode)) return;
  const a = s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode;
  const on = {};
  if (a && a.closest && !a.closest('.mm')) {
    let c = s.getRangeAt(0).commonAncestorContainer;
    if (c.nodeType === 3) c = c.parentElement;
    const up = function (el, sel) {
      const x = el && el.closest ? el.closest(sel) : null;
      return x && x !== doc && doc.contains(x) ? x : null;
    };
    const blk = curBlock();
    if (blk && /^H[1-3]$/.test(blk.nodeName)) on[blk.nodeName.toLowerCase()] = true;
    on.bold = coveredBy('b,strong');
    on.italic = coveredBy('i,em');
    on.ul = !!up(a, 'ul');
    on.ol = !!up(a, 'ol');
    on.quote = !!up(a, 'blockquote');
    on.code = coveredBy('code', 'pre') || !!up(a, 'pre');
    on.table = !!up(a, 'table');
  }
  document.querySelectorAll('#tools [data-tool]').forEach(function (b) {
    const v = !!on[b.dataset.tool];
    b.classList.toggle('on', v);
    b.setAttribute('aria-pressed', String(v));
  });
}
document.addEventListener('selectionchange', updateToolState);
doc.addEventListener('input', updateToolState);
$('#tools').addEventListener('mousedown', function (e) { if (e.target.closest('button, summary')) e.preventDefault(); });
$('#tools').addEventListener('click', function (e) {
  const b = e.target.closest('[data-tool]');
  if (!b) return;
  $('#dmenu').open = false;
  runTool(b.dataset.tool);
});
document.addEventListener('click', function (e) { if (!e.target.closest('#dmenu')) $('#dmenu').open = false; });

/* markdown shortcuts while typing */
function spaceShortcut() {
  const s = window.getSelection();
  if (!s.rangeCount || !s.isCollapsed) return false;
  const blk = curBlock();
  if (!blk || !/^(P|DIV)$/.test(blk.nodeName) || blk.parentElement !== doc) return false;
  const r = document.createRange();
  r.selectNodeContents(blk);
  r.setEnd(s.anchorNode, s.anchorOffset);
  const t = r.toString().replace(/​/g, '');
  let cmd;
  if (/^#{1,6}$/.test(t)) cmd = function () { document.execCommand('formatBlock', false, '<h' + t.length + '>'); };
  else if (/^[-*+]$/.test(t)) cmd = function () { document.execCommand('insertUnorderedList'); };
  else if (/^\d+\.$/.test(t)) cmd = function () { document.execCommand('insertOrderedList'); };
  else if (t === '>') cmd = function () { document.execCommand('formatBlock', false, '<blockquote>'); };
  else return false;
  r.deleteContents();
  if (!blk.firstChild) blk.appendChild(document.createElement('br'));
  s.collapse(blk, 0);
  cmd();
  return true;
}
function enterShortcut() {
  const s = window.getSelection();
  if (!s.rangeCount) return false;
  const blk = curBlock();
  if (!blk) return false;
  if (blk.nodeName === 'PRE') {
    const r1 = document.createRange(); r1.selectNodeContents(blk); r1.setEnd(s.anchorNode, s.anchorOffset);
    const r2 = document.createRange(); r2.selectNodeContents(blk); r2.setStart(s.anchorNode, s.anchorOffset);
    const before = r1.toString(), after = r2.toString();
    if (/\n$/.test(before) && (after === '' || after === '\n')) {
      const w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
      let last = null, nn;
      while ((nn = w.nextNode())) last = nn;
      if (last) last.data = last.data.replace(/\n{1,2}$/, '');
      const p = document.createElement('p'); p.innerHTML = '<br>';
      blk.after(p); s.collapse(p, 0);
      return true;
    }
    document.execCommand('insertLineBreak');
    return true;
  }
  if (!s.isCollapsed || !/^(P|DIV)$/.test(blk.nodeName) || blk.parentElement !== doc) return false;
  const t = blk.textContent.replace(/​/g, '').trim();
  const m = /^```([\w+#.-]*)$/.exec(t);
  if (m) {
    const pre = document.createElement('pre'), code = document.createElement('code');
    if (m[1]) code.className = 'language-' + m[1];
    code.appendChild(document.createElement('br')); pre.appendChild(code);
    blk.replaceWith(pre); ensureParagraphs();
    s.collapse(code, 0);
    return true;
  }
  if (/^(---|\*\*\*|___)$/.test(t)) {
    const hr = document.createElement('hr'), p = document.createElement('p');
    p.innerHTML = '<br>';
    blk.replaceWith(hr); hr.after(p); s.collapse(p, 0);
    return true;
  }
  return false;
}
function applyInline() {
  const s = window.getSelection();
  if (!s.rangeCount || !s.isCollapsed || !s.anchorNode || s.anchorNode.nodeType !== 3) return;
  const node = s.anchorNode, off = s.anchorOffset;
  if (node.parentElement && node.parentElement.closest('pre,code')) return;
  const text = node.data.slice(0, off);
  let m, start, tag, content, attrs = null;
  if ((m = /\[([^\[\]]+)\]\(([^)\s]+)\)$/.exec(text))) { start = m.index; tag = 'a'; content = m[1]; attrs = { href: m[2] }; }
  else if ((m = /`([^`]+)`$/.exec(text))) { start = m.index; tag = 'code'; content = m[1]; }
  else if ((m = /\*\*([^*]+)\*\*$/.exec(text))) { start = m.index; tag = 'strong'; content = m[1]; }
  else if ((m = /(^|[^*])\*([^*\s][^*]*)\*$/.exec(text))) { start = m.index + m[1].length; tag = 'em'; content = m[2]; }
  else if ((m = /(^|[^\w_])_([^_\s][^_]*)_$/.exec(text))) { start = m.index + m[1].length; tag = 'em'; content = m[2]; }
  else return;
  if (attrs && /^(javascript|data|vbscript):/i.test(attrs.href)) return;
  const r = document.createRange();
  r.setStart(node, start); r.setEnd(node, off);
  r.deleteContents();
  const el = document.createElement(tag);
  el.textContent = content;
  if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
  r.insertNode(el);
  const z = document.createTextNode('​');
  el.after(z);
  s.collapse(z, 1);
}
doc.addEventListener('keydown', function (e) {
  if (e.target !== doc && e.target.closest && e.target.closest('.mm')) return;
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') { if (spaceShortcut()) { e.preventDefault(); markDirty(); histPush(); } }
  else if (e.key === 'Enter' && !e.shiftKey) { if (enterShortcut()) { e.preventDefault(); markDirty(); histPush(); } }
});
doc.addEventListener('input', function (e) {
  if (e.target !== doc && e.target.closest && e.target.closest('.mm')) return;
  if (e.inputType === 'insertText') applyInline();
  markDirty();
  if (histPending && Date.now() - histStart > 1200 && (e.data === ' ' || e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak')) histPush();
});
doc.addEventListener('mmchange', function () { markDirty(); histPush(); });
doc.addEventListener('paste', function (e) {
  if (e.target !== doc && e.target.closest && e.target.closest('.mm')) return;
  const text = e.clipboardData && e.clipboardData.getData('text/plain');
  if (!text) return;
  e.preventDefault();
  histPush();
  const bc = readCaret() || idleCaret;
  if (text.indexOf('\n') < 0) { document.execCommand('insertText', false, text); pendingBeforeCaret = bc; markDirty(); histPush(); return; }
  document.execCommand('insertHTML', false, sanitize(marked.parse(text, MARKED_OPTS)));
  doc.querySelectorAll('figure.mm').forEach(initBlock);
  ensureParagraphs();
  pendingBeforeCaret = bc;
  markDirty();
  histPush();
});
doc.addEventListener('change', function (e) { if (e.target.type === 'checkbox') { markDirty(); histPush(); } });

/* ---------- start ---------- */
const SAMPLE = [
  '# Order service',
  '',
  '> Sample document. Click the diagram to edit it, or type `## ` at the start of a line for a heading.',
  '',
  'The order service accepts requests from the gateway, writes to Postgres, and publishes an `OrderCreated` event. Payments run asynchronously.',
  '',
  '## Request flow',
  '',
  '```mermaid',
  'flowchart LR',
  '    Client --> Gateway',
  '    Gateway --> Order[Order service]',
  '    Order -->|write| DB[(Postgres)]',
  '    Order -->|OrderCreated| Q([Queue])',
  '    Q --> Pay[Payment worker]',
  '```',
  '',
  '## Architecture',
  '',
  '```mermaid',
  'flowchart LR',
  '    Client([Client]) --> GW[API gateway]',
  '    subgraph cluster[Order platform]',
  '        GW --> Order[Order service]',
  '        Order --> Pay[Payment worker]',
  '    end',
  '    subgraph data[Data]',
  '        DB[(Postgres)]',
  '        Q([Queue])',
  '    end',
  '    Order -->|write| DB',
  '    Order -->|OrderCreated| Q',
  '    Q --> Pay',
  '```',
  '',
  '## Schema',
  '',
  '```mermaid',
  'erDiagram',
  '    CUSTOMER {',
  '        bigint id PK',
  '        varchar email UK',
  '    }',
  '    ORDERS {',
  '        bigint id PK',
  '        bigint customer_id FK',
  '        int amount_cents',
  '    }',
  '    CUSTOMER ||--o{ ORDERS : places',
  '```',
  '',
  '## Domain model',
  '',
  '```mermaid',
  'classDiagram',
  '    class Order {',
  '        +Long id',
  '        +place() void',
  '    }',
  '    class OrderRepository {',
  '        <<interface>>',
  '        +save(Order) Order',
  '    }',
  '    OrderRepository ..> Order : uses',
  '```',
  '',
  '## Failure handling',
  '',
  '- Retry payment up to three times with backoff',
  '- Move failed messages to a dead-letter queue',
  '- Alert when the queue depth stays above 1000',
  '',
  '## Endpoints',
  '',
  '| Method | Path | Purpose |',
  '| --- | --- | --- |',
  '| POST | /orders | Create an order |',
  '| GET | /orders/{id} | Fetch an order |',
  '',
  '```java',
  'record OrderCreated(String orderId, long amountCents) {}',
  '```',
  ''
].join('\n');

let startMd = SAMPLE, restored = false, draft = null;
try {
  const d = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (d && typeof d.md === 'string') { startMd = d.md; name = d.name || name; restored = true; draft = d; }
} catch (e) { /* no draft */ }
loadMarkdown(startMd); histReset();
setModeUi(); updateStatus(); updateCount();
getDownloads();
if (restored) toast('Restored your last draft.');
/* The draft remembers which file it came from, so Save writes back to that file after a restart or a page reload.
   Without unsaved edits the file is read again, because it may have changed on disk. */
async function reopenDraft() {
  if (!draft.dirty) { const f = await TAURI.invoke('read_file', { path: draft.path }); loadDoc(f.text, f.name, { native: f.path }); return; }
  loadDoc(draft.md, draft.name, { native: draft.path });
  dirty = true; cleanMd = null; updateStatus(); saveDraft();
}
if (TAURI) TAURI.invoke('initial_file').then(function (f) {
  if (f) loadDoc(f.text, f.name, { native: f.path });
  else if (draft && draft.path) return reopenDraft();
}).catch(function () {});
