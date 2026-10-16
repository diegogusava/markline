/* ---------- review comments ----------
   Comments anchor to quoted text (plus a little context), not to line numbers, so they survive edits.
   They live in a sidecar file NAME.md.comments.json (localStorage when there is no file path).
   Line numbers are computed from the current markdown whenever they are shown or exported. */
(function () {
const panel = $('#cpanel'), listEl = $('#clist'), fab = $('#cfab'), compose = $('#ccompose'), cIn = $('#cIn');
const HL = !!(window.CSS && CSS.highlights && window.Highlight);
let comments = [], activeId = null, pending = null, editingId = null, loadTok = 0, lastText = null, ranges = new Map();
let hlTimer = null, listTimer = null, chain = Promise.resolve();

/* ---------- text folding: drops markdown marks, collapses whitespace, keeps a map to original indexes ---------- */
const DROP = /[*_`~|#>​]/;
function fold(str, keep) {
  let s = '', map = [], sp = true;
  for (let i = 0; i < str.length; i++) {
    if (keep && !keep[i]) continue;
    const ch = str[i];
    if (DROP.test(ch)) continue;
    if (/\s/.test(ch)) { if (!sp) { s += ' '; map.push(i); sp = true; } continue; }
    s += ch; map.push(i); sp = false;
  }
  if (s.endsWith(' ')) { s = s.slice(0, -1); map.pop(); }
  return { s: s, map: map };
}
function mdKeep(md) {
  const k = new Uint8Array(md.length).fill(1);
  function zero(a, b) { for (let i = a; i < b; i++) k[i] = 0; }
  let m;
  const link = /!?\[([^\]\n]*)\]\(([^)\n]*)\)/g;
  while ((m = link.exec(md))) {
    const pre = m[0][0] === '!' ? 2 : 1;
    zero(m.index, m.index + pre);
    zero(m.index + pre + m[1].length, m.index + m[0].length);
  }
  [/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, /^[ \t|:-]*-{3,}[ \t|:-]*$/gm, /^[ \t]*(?:```|~~~)[^\n]*$/gm].forEach(function (re) {
    let x;
    while ((x = re.exec(md))) { if (x[0].length) zero(x.index, x.index + x[0].length); else re.lastIndex++; }
  });
  return k;
}
function commonSuffix(a, b) { let n = 0; while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++; return n; }
function commonPrefix(a, b) { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; }
/* find q in folded hay; the occurrence whose surroundings best match pre/suf wins */
function locate(hay, q, pre, suf) {
  if (!q) return null;
  let best = null, bestScore = -1, i = hay.s.indexOf(q);
  while (i !== -1) {
    const sc = commonSuffix(hay.s.slice(Math.max(0, i - pre.length), i), pre) + commonPrefix(hay.s.slice(i + q.length, i + q.length + suf.length), suf);
    if (sc > bestScore) { bestScore = sc; best = i; }
    i = hay.s.indexOf(q, i + 1);
  }
  return best === null ? null : { a: best, b: best + q.length };
}
function ctx(raw, a, b) {
  return { pre: fold(raw.slice(Math.max(0, a - 80), a)).s.slice(-30), suf: fold(raw.slice(b, b + 80)).s.slice(0, 30) };
}

/* ---------- markdown side (line numbers, source-view selection) ---------- */
function mdIndex(md) {
  const hay = fold(md, mdKeep(md));
  function line(i) { let n = 1; for (let p = md.indexOf('\n'); p !== -1 && p < i; p = md.indexOf('\n', p + 1)) n++; return n; }
  return {
    find: function (c) {
      const q = fold(c.quote).s;
      let r = locate(hay, q, c.pre || '', c.suf || '');
      if (!r && q.length > 40) {
        const h = locate(hay, q.slice(0, 40), c.pre || '', ''), t = locate(hay, q.slice(-40), '', c.suf || '');
        if (h && t && t.b >= h.a) r = { a: h.a, b: t.b };
      }
      if (!r) return null;
      const s = hay.map[r.a], e = hay.map[r.b - 1] + 1;
      return { s: s, e: e, l1: line(s), l2: line(e - 1) };
    }
  };
}

/* ---------- rendered side ---------- */
function flatDoc() {
  const w = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
  let s = '', segs = [], prev = null, n;
  while ((n = w.nextNode())) {
    const pe = n.parentElement;
    if (!n.nodeValue || !pe || pe.closest('figure.mm, figure.fm')) continue;
    const blk = pe.closest('p,li,h1,h2,h3,h4,h5,h6,pre,td,th,blockquote,div');
    if (prev && blk !== prev) s += ' ';
    prev = blk;
    segs.push({ node: n, start: s.length, len: n.nodeValue.length });
    s += n.nodeValue;
  }
  return { s: s, segs: segs };
}
function pointToFlat(flat, node, off) {
  const segs = flat.segs;
  if (node.nodeType === 3) {
    for (let i = 0; i < segs.length; i++) if (segs[i].node === node) return segs[i].start + off;
    return null;
  }
  const child = node.childNodes[off];
  for (let i = 0; i < segs.length; i++) {
    const n = segs[i].node;
    if (child ? (child === n || child.contains(n) || (child.compareDocumentPosition(n) & 4))
              : ((node.compareDocumentPosition(n) & 4) && !node.contains(n))) return segs[i].start;
  }
  return flat.s.length;
}
function flatToPoint(flat, idx, end) {
  const segs = flat.segs, i0 = end ? idx - 1 : idx;
  for (let i = 0; i < segs.length; i++) {
    if (i0 >= segs[i].start && i0 < segs[i].start + segs[i].len) return { node: segs[i].node, off: i0 - segs[i].start + (end ? 1 : 0) };
  }
  return null;
}
function docRanges() {
  const out = new Map();
  if (mode !== 'rendered') return out;
  const flat = flatDoc(), hay = fold(flat.s);
  comments.forEach(function (c) {
    if (c.status !== 'open' && c.status !== 'sent') return;
    const r = locate(hay, fold(c.quote).s, c.pre || '', c.suf || '');
    if (!r) return;
    const a = flatToPoint(flat, hay.map[r.a], false), b = flatToPoint(flat, hay.map[r.b - 1] + 1, true);
    if (!a || !b) return;
    const rg = document.createRange();
    try { rg.setStart(a.node, a.off); rg.setEnd(b.node, b.off); out.set(c.id, rg); } catch (e) { /* ignore */ }
  });
  return out;
}
function refreshHighlights() {
  ranges = docRanges();
  if (!HL) return;
  CSS.highlights.delete('ml-c'); CSS.highlights.delete('ml-ca');
  const all = [], act = [];
  ranges.forEach(function (r, id) { (id === activeId ? act : all).push(r); });
  if (all.length) CSS.highlights.set('ml-c', new Highlight(...all));
  if (act.length) CSS.highlights.set('ml-ca', new Highlight(...act));
}
function scheduleHl() { clearTimeout(hlTimer); hlTimer = setTimeout(refreshHighlights, 250); clearTimeout(listTimer); listTimer = setTimeout(function () { if (!panel.hidden) renderList(); }, 900); }
new MutationObserver(scheduleHl).observe(doc, { childList: true, characterData: true, subtree: true });
new MutationObserver(scheduleHl).observe(doc, { attributes: true, attributeFilter: ['hidden'] });

/* ---------- selection capture ---------- */
function capture() {
  if (mode === 'source') {
    const v = srcEl.value, a = srcEl.selectionStart, b = srcEl.selectionEnd;
    if (b <= a || !v.slice(a, b).trim()) return null;
    const c = ctx(v, a, b);
    return { quote: v.slice(a, b).trim().slice(0, 1000), pre: c.pre, suf: c.suf };
  }
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  const anc = r.commonAncestorContainer, el = anc.nodeType === 3 ? anc.parentElement : anc;
  if (!doc.contains(anc) || (el && el.closest && el.closest('figure.mm, figure.fm'))) return null;
  const flat = flatDoc();
  const a = pointToFlat(flat, r.startContainer, r.startOffset), b = pointToFlat(flat, r.endContainer, r.endOffset);
  if (a === null || b === null || b <= a) return null;
  const raw = flat.s.slice(a, b);
  if (!raw.trim()) return null;
  const c = ctx(flat.s, a, b);
  return { quote: raw.replace(/\s+/g, ' ').trim().slice(0, 1000), pre: c.pre, suf: c.suf };
}

/* ---------- compose ---------- */
function startCompose() {
  const cap = capture();
  if (!cap || !fold(cap.quote).s) { toast('Select some text first, then add a comment.'); return; }
  pending = cap;
  if (HL) CSS.highlights.set('ml-cp', new Highlight(window.getSelection().getRangeAt(0).cloneRange()));
  showPanel(true);
  $('#cqPrev').textContent = cap.quote;
  compose.hidden = false;
  cIn.value = '';
  fab.hidden = true;
  cIn.focus();
}
function endCompose() { pending = null; compose.hidden = true; if (HL) CSS.highlights.delete('ml-cp'); }
function addComment() {
  const text = cIn.value.trim();
  if (!pending) return;
  if (!text) { cIn.focus(); return; }
  const c = { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), status: 'open', quote: pending.quote, pre: pending.pre, suf: pending.suf, comment: text, created: new Date().toISOString() };
  comments.push(c);
  activeId = c.id;
  endCompose();
  changed();
}
$('#cOk').addEventListener('click', addComment);
$('#cNo').addEventListener('click', endCompose);
cIn.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addComment(); }
  else if (e.key === 'Escape') { e.preventDefault(); endCompose(); }
});

/* floating button next to a fresh selection, plus shortcut and panel buttons that keep the selection alive */
function keepSel(el) { el.addEventListener('mousedown', function (e) { e.preventDefault(); }); }
keepSel(fab); keepSel($('#cAdd'));
fab.addEventListener('click', startCompose);
$('#cAdd').addEventListener('click', startCompose);
function maybeFab(e) {
  setTimeout(function () {
    if (e.target && e.target.closest && e.target.closest('#cpanel, #cfab')) return;
    const ok = (mode === 'source' ? srcEl.selectionEnd > srcEl.selectionStart : (!window.getSelection().isCollapsed && !!capture()));
    if (!ok) { fab.hidden = true; return; }
    fab.hidden = false;
    fab.style.left = Math.min(e.clientX + 8, window.innerWidth - 110) + 'px';
    fab.style.top = Math.min(e.clientY + 14, window.innerHeight - 36) + 'px';
  }, 0);
}
doc.addEventListener('mouseup', maybeFab);
srcEl.addEventListener('mouseup', maybeFab);
document.addEventListener('mousedown', function (e) { if (e.target !== fab) fab.hidden = true; }, true);
document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'm') { e.preventDefault(); startCompose(); }
});

/* ---------- panel ---------- */
function showPanel(on) {
  panel.hidden = !on;
  $('#bCom').classList.toggle('on', on);
  $('#bCom').setAttribute('aria-pressed', String(on));
  if (on) renderList();
}
$('#bCom').addEventListener('click', function () { showPanel(panel.hidden); });
$('#cClose').addEventListener('click', function () { showPanel(false); });

function openCount() { return comments.filter(function (c) { return c.status === 'open'; }).length; }
function updateBadge() {
  const n = openCount();
  $('#bCom').textContent = n ? 'Comments (' + n + ')' : 'Comments';
  $('#cCount').textContent = comments.length ? '(' + n + ' open)' : '';
  $('#cbulk').hidden = !comments.length;
  $('#cResolveAll').disabled = !n;
}
$('#cResolveAll').addEventListener('click', function () {
  comments.forEach(function (c) { if (c.status === 'open') c.status = 'resolved'; });
  changed();
});
$('#cDeleteAll').addEventListener('click', function () {
  ask('Delete all ' + comments.length + ' comments of this file?', 'Delete all', function () { comments = []; activeId = null; editingId = null; changed(); });
});
function lineOf(c, idx) {
  const r = idx.find(c);
  return r ? r : null;
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function btn(label, fn) { const b = el('button', 'btn sm', label); b.type = 'button'; b.addEventListener('click', function (e) { e.stopPropagation(); fn(); }); return b; }

function renderList() {
  updateBadge();
  if (panel.hidden) return;
  if (editingId && panel.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
  const idx = mdIndex(currentMarkdown());
  listEl.textContent = '';
  if (!comments.length) {
    listEl.appendChild(el('div', 'cempty', 'No comments yet. Select text in the Rendered or Source view and press Ctrl+Alt+M (or click the Comment bubble), then describe the change you want. When you are done, use Copy prompt (paste it into Copilot Chat) or Save for Copilot (then run the apply-comments prompt file).'));
    return;
  }
  const rows = comments.map(function (c) { return { c: c, loc: idx.find(c) }; });
  rows.sort(function (x, y) { return (x.loc ? x.loc.s : 1e12) - (y.loc ? y.loc.s : 1e12); });
  [['open', null], ['sent', 'Waiting for the agent'], ['done', 'Applied / resolved']].forEach(function (g) {
    const part = rows.filter(function (r) { return (r.c.status === 'open' ? 'open' : r.c.status === 'sent' ? 'sent' : 'done') === g[0]; });
    if (!part.length) return;
    if (g[1]) listEl.appendChild(el('div', 'chead', g[1]));
    part.forEach(function (r) { listEl.appendChild(item(r.c, r.loc)); });
  });
}
function item(c, loc) {
  const it = el('div', 'citem' + (c.id === activeId ? ' active' : '') + (c.status === 'applied' || c.status === 'resolved' ? ' done' : ''));
  it.dataset.id = c.id;
  const meta = el('div', 'cmeta');
  if (loc) meta.appendChild(el('span', 'cline', loc.l1 === loc.l2 ? 'L' + loc.l1 : 'L' + loc.l1 + '-' + loc.l2));
  else if (c.status === 'open' || c.status === 'sent') meta.appendChild(el('span', 'cwarn', 'text not found any more'));
  if (c.status !== 'open') meta.appendChild(el('span', '', c.status));
  it.appendChild(meta);
  const q = el('div', 'cquote', c.quote);
  it.appendChild(q);
  if (editingId === c.id) {
    const ta = el('textarea'); ta.rows = 3; ta.value = c.comment;
    it.appendChild(ta);
    const row = el('div', 'crow');
    row.appendChild(btn('Save', function () { const v = ta.value.trim(); if (v) { c.comment = v; editingId = null; changed(); } }));
    row.appendChild(btn('Cancel', function () { editingId = null; renderList(); }));
    it.appendChild(row);
    setTimeout(function () { ta.focus(); }, 0);
  } else {
    it.appendChild(el('div', 'ctext', c.comment));
    if (c.reply) it.appendChild(el('div', 'creply', 'Agent: ' + c.reply));
    const row = el('div', 'crow');
    if (c.status === 'sent') row.appendChild(btn('Take back', function () { c.status = 'open'; delete c.batchId; changed(); }));
    else {
      row.appendChild(btn('Edit', function () { editingId = c.id; renderList(); }));
      row.appendChild(btn(c.status === 'open' ? 'Resolve' : 'Reopen', function () { c.status = c.status === 'open' ? 'resolved' : 'open'; delete c.batchId; changed(); }));
    }
    row.appendChild(btn('Delete', function () { comments = comments.filter(function (x) { return x !== c; }); if (activeId === c.id) activeId = null; changed(); }));
    it.appendChild(row);
  }
  it.addEventListener('click', function () { goto(c); });
  return it;
}
function setActive(id, scrollList) {
  activeId = id;
  refreshHighlights();
  listEl.querySelectorAll('.citem').forEach(function (n) {
    n.classList.toggle('active', n.dataset.id === id);
    if (scrollList && n.dataset.id === id) n.scrollIntoView({ block: 'nearest' });
  });
}
function goto(c) {
  setActive(c.id, false);
  if (mode === 'source') {
    const loc = mdIndex(srcEl.value).find(c);
    if (!loc) { toast('That text was not found in the source.'); return; }
    srcEl.blur(); srcEl.setSelectionRange(loc.s, loc.e); srcEl.focus();
    return;
  }
  const r = ranges.get(c.id);
  if (!r) { toast('That text was not found in the rendered view.'); return; }
  const n = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
  if (n && n.scrollIntoView) n.scrollIntoView({ block: 'center' });
  if (!HL) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
}
doc.addEventListener('click', function () {
  const s = window.getSelection();
  if (!s.isCollapsed || !s.anchorNode) return;
  let hit = null;
  ranges.forEach(function (r, id) { try { if (!hit && r.isPointInRange(s.anchorNode, s.anchorOffset)) hit = id; } catch (e) { /* ignore */ } });
  if (hit) { if (panel.hidden) showPanel(true); setActive(hit, true); }
});

/* ---------- persistence ---------- */
function sidecarPath() { const p = fileHandle && fileHandle.native; return p ? p + '.comments.json' : null; }
function lsKey() { return 'markline-comments-v1:' + (fileHandle && fileHandle.native || name); }
function payload() {
  const idx = mdIndex(currentMarkdown());
  return {
    version: 1,
    file: name,
    note: 'Review comments from Markline. Apply every comment with status "open" to the markdown file, then set its status to "applied". startLine/endLine are 1-based lines of the quoted text in the saved file.',
    comments: comments.map(function (c) {
      const loc = idx.find(c);
      return { id: c.id, status: c.status, startLine: loc ? loc.l1 : null, endLine: loc ? loc.l2 : null, quote: c.quote, comment: c.comment, pre: c.pre, suf: c.suf, created: c.created, batchId: c.batchId, reply: c.reply };
    })
  };
}
function parse(text) {
  if (!text) return [];
  const d = JSON.parse(text);
  return (d.comments || []).filter(function (c) { return c && c.quote; }).map(function (c, i) {
    return { id: String(c.id || 'c' + i + Date.now().toString(36)), status: ['open', 'sent', 'applied', 'resolved'].indexOf(c.status) >= 0 ? c.status : 'open', batchId: c.batchId, reply: c.reply ? String(c.reply) : '', quote: String(c.quote), pre: c.pre || '', suf: c.suf || '', comment: String(c.comment != null ? c.comment : c.text || ''), created: c.created || '' };
  });
}
async function readStore() {
  const p = sidecarPath();
  if (TAURI && p) return TAURI.invoke('read_optional', { path: p });
  try { return localStorage.getItem(lsKey()); } catch (e) { return null; }
}
function persist() {
  chain = chain.then(async function () {
    try {
      const p = sidecarPath();
      if (!comments.length && lastText === null) return;
      const text = JSON.stringify(payload(), null, 2) + '\n';
      if (TAURI && p) await TAURI.invoke('save_file', { path: p, suggested: '', text: text });
      else { try { localStorage.setItem(lsKey(), text); } catch (e) { /* storage unavailable */ } }
      lastText = text;
    } catch (e) { toast('Could not save comments: ' + e); }
  });
  return chain;
}
function changed() { refreshHighlights(); renderList(); persist(); }

async function load(quiet) {
  const tok = ++loadTok;
  let text = null;
  try { text = await readStore(); } catch (e) { text = null; }
  if (tok !== loadTok) return;
  if (quiet && text === lastText) return;
  lastText = text;
  try { comments = parse(text); } catch (e) { comments = []; toast('Could not read the comments file.'); }
  if (quiet && text) toast('Comments updated from disk.');
  if (!comments.some(function (c) { return c.id === activeId; })) activeId = null;
  refreshHighlights(); renderList();
}
window.onDocLoaded = function () { comments = []; activeId = null; lastText = null; endCompose(); editingId = null; refreshHighlights(); renderList(); load(false); rebase(); dismissChanges(); };
window.onDocSaved = function () { diskText = currentMarkdown(); if (comments.length) persist(); rebase(); };
window.addEventListener('focus', function () { if (TAURI && sidecarPath() && !pending && !editingId) load(true); });

/* ---------- export ---------- */
function buildPrompt() {
  const idx = mdIndex(currentMarkdown());
  const open = comments.filter(function (c) { return c.status === 'open'; });
  const lines = [
    'A reviewer left comments on passages of the Markdown document ' + name + '. Apply every comment.',
    '',
    'Rules:',
    '- Change only what each comment needs. Keep everything else in the passage exactly as it is.',
    '- If a comment is a question rather than a change request, do not edit; answer it.',
    '- For each comment, return the rewritten passage in a fenced markdown block, then one line saying what you changed.',
    '',
    'Comments:'
  ];
  open.forEach(function (c, i) {
    const loc = idx.find(c);
    lines.push('', (i + 1) + '. ' + (loc ? (loc.l1 === loc.l2 ? 'Line ' + loc.l1 : 'Lines ' + loc.l1 + '-' + loc.l2) : 'Location unknown') + ', passage:');
    lines.push('   > ' + c.quote.replace(/\n/g, '\n   > '));
    lines.push('   Comment: ' + c.comment.replace(/\n/g, '\n   '));
  });
  return lines.join('\n');
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}
$('#cCopy').addEventListener('click', async function () {
  if (!openCount()) { toast('No open comments to send.'); return; }
  const t = buildPrompt();
  $('#cCopyFallback').hidden = true;
  if (await copyText(t)) toast('Prompt copied. Paste it into Copilot Chat.');
  else { $('#cCopyText').value = t; $('#cCopyFallback').hidden = false; $('#cCopyText').select(); }
});
$('#cWrite').addEventListener('click', async function () {
  if (!openCount()) { toast('No open comments to send.'); return; }
  const r = await io.save();
  if (r !== 'file') { toast(r === 'cancel' ? 'Cancelled.' : 'Saving to a file needs the desktop app.'); return; }
  markClean();
  await persist();
  toast('Saved ' + mdName(name) + ' and ' + mdName(name) + '.comments.json. In Copilot, run the apply-comments prompt.');
  renderList();
});
document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r') { e.preventDefault(); $('#cReload').click(); }
});
let lastDiff = null, changesBase = null, hunks = [], cur = -1;
function lineDiff(a, b) { return seqDiff(a.split('\n'), b.split('\n')); }
function seqDiff(x, y) {
  let h = 0, t = 0;
  while (h < x.length && h < y.length && x[h] === y[h]) h++;
  while (t < x.length - h && t < y.length - h && x[x.length - 1 - t] === y[y.length - 1 - t]) t++;
  const xs = x.slice(h, x.length - t), ys = y.slice(h, y.length - t);
  const ops = x.slice(0, h).map(function (l) { return [' ', l]; });
  if (xs.length * ys.length > 4e6) {
    xs.forEach(function (l) { ops.push(['-', l]); }); ys.forEach(function (l) { ops.push(['+', l]); });
  } else {
    const w = ys.length + 1, L = new Uint32Array((xs.length + 1) * w);
    for (let i = xs.length - 1; i >= 0; i--) for (let j = ys.length - 1; j >= 0; j--)
      L[i * w + j] = xs[i] === ys[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < xs.length || j < ys.length) {
      if (i < xs.length && j < ys.length && xs[i] === ys[j]) { ops.push([' ', xs[i]]); i++; j++; }
      else if (j < ys.length && (i === xs.length || L[i * w + j + 1] >= L[(i + 1) * w + j])) ops.push(['+', ys[j++]]);
      else ops.push(['-', xs[i++]]);
    }
  }
  y.slice(y.length - t).forEach(function (l) { ops.push([' ', l]); });
  return ops.some(function (o) { return o[0] !== ' '; }) ? ops : null;
}
function showDiff() {
  const body = $('#diffBody'), CTX = 2;
  body.textContent = '';
  const keep = lastDiff.map(function (o, i) {
    for (let k = Math.max(0, i - CTX); k <= Math.min(lastDiff.length - 1, i + CTX); k++) if (lastDiff[k][0] !== ' ') return true;
    return false;
  });
  let skipped = 0;
  function gap() { if (skipped) { const g = document.createElement('div'); g.className = 'gap'; g.textContent = '… ' + skipped + ' unchanged line' + (skipped > 1 ? 's' : ''); body.appendChild(g); skipped = 0; } }
  lastDiff.forEach(function (o, i) {
    if (!keep[i]) { skipped++; return; }
    gap();
    const d = document.createElement('div');
    d.className = o[0] === '+' ? 'add' : o[0] === '-' ? 'del' : '';
    d.textContent = o[0] + ' ' + o[1];
    body.appendChild(d);
  });
  gap();
  $('#diffTitle').textContent = 'Changes on disk';
  $('#diffNav').hidden = true;
  $('#diffbox').hidden = false;
}

/* rendered view: mark changed blocks, then step through them one hunk at a time */
function clearMarks() {
  doc.querySelectorAll('.chg, .chg-gone, .chg-end, .chg-cur').forEach(function (el) { el.classList.remove('chg', 'chg-gone', 'chg-end', 'chg-cur'); });
  hunks = []; cur = -1;
}
function dismissChanges() {
  changesBase = null; lastDiff = null;
  clearMarks();
  $('#cDiff').hidden = true; $('#diffbox').hidden = true;
}
function markChanges() {
  clearMarks();
  if (changesBase === null || mode !== 'rendered') return;
  const els = lastBlocks.els, ops = seqDiff(renderBlocks(changesBase), lastBlocks.html);
  if (!ops || els.length !== lastBlocks.html.length) return;
  let j = 0, h = null;
  ops.forEach(function (o) {
    if (o[0] === ' ') { h = null; j++; return; }
    if (!h) { h = { olds: [], news: [], els: [], at: els[j] || els[els.length - 1], end: j >= els.length }; hunks.push(h); }
    if (o[0] === '-') h.olds.push(o[1]);
    else { h.els.push(els[j]); h.news.push(o[1]); j++; }
  });
  hunks.forEach(function (x) {
    if (x.els.length) x.els.forEach(function (el) { el.classList.add('chg'); });
    else if (x.at) x.at.classList.add(x.end ? 'chg-end' : 'chg-gone');
  });
}
window.reapplyChanges = markChanges;
function showHunk(i) {
  cur = (i + hunks.length) % hunks.length;
  const h = hunks[cur], body = $('#diffBody');
  doc.querySelectorAll('.chg-cur').forEach(function (el) { el.classList.remove('chg-cur'); });
  (h.els.length ? h.els : [h.at]).forEach(function (el) { el.classList.add('chg-cur'); });
  if (h.at) h.at.scrollIntoView({ block: 'center', behavior: 'smooth' });
  body.textContent = '';
  function lines(htmls, sign, cls) {
    htmls.forEach(function (x) {
      const d = document.createElement('div');
      d.className = cls;
      d.textContent = td.turndown(x).trim().split('\n').map(function (l) { return sign + ' ' + l; }).join('\n');
      body.appendChild(d);
    });
  }
  lines(h.olds, '-', 'del'); lines(h.news, '+', 'add');
  $('#diffTitle').textContent = 'Change ' + (cur + 1) + ' of ' + hunks.length;
  $('#diffNav').hidden = hunks.length < 2;
  $('#diffbox').hidden = false;
}
$('#cDiff').addEventListener('click', function () {
  if (mode === 'rendered' && hunks.length) showHunk($('#diffbox').hidden ? 0 : cur + 1); else showDiff();
});
$('#diffPrev').addEventListener('click', function () { showHunk(cur - 1); });
$('#diffNext').addEventListener('click', function () { showHunk(cur + 1); });
$('#diffClose').addEventListener('click', dismissChanges);
function onEdit() { if (changesBase !== null) dismissChanges(); }
doc.addEventListener('input', onEdit);
srcEl.addEventListener('input', onEdit);
async function reloadFile(quiet) {
  const p = fileHandle && fileHandle.native;
  try {
    const f = await TAURI.invoke('read_file', { path: p });
    const m = mode, sc = $('#scroll').scrollTop, base = changesBase === null ? diskText : changesBase;
    loadDoc(f.text, f.name, { native: f.path });
    lastDiff = lineDiff(base, f.text);
    changesBase = lastDiff ? base : null;
    $('#cDiff').hidden = !lastDiff;
    markChanges();
    if (m === 'source') setMode('source');
    $('#scroll').scrollTop = sc;
    toast((quiet ? 'File updated on disk.' : 'Reloaded ' + f.name) + (lastDiff ? ' Click Changes to see what changed.' : ''));
  } catch (e) { toast('Could not reload: ' + (e && e.message || e)); }
}
$('#cReload').addEventListener('click', function () {
  if (!TAURI || !(fileHandle && fileHandle.native)) { toast('Reload works for files opened from disk.'); return; }
  guard(function () { reloadFile(false); });
});

/* ---------- browser mode: send to a CLI agent, and follow changes on disk ---------- */
const WEB = !!window.__MARKLINE_WEB__;
let base = { file: 0, sidecar: 0 }, polling = false, warned = false;
async function statNow() {
  const p = fileHandle && fileHandle.native;
  if (!TAURI || !p) return null;
  try { return await TAURI.invoke('stat', { path: p }); } catch (e) { return null; }
}
async function rebase() { const s = await statNow(); if (s) base = s; warned = false; }
async function tick() {
  if (polling || !TAURI || document.hidden) return;
  polling = true;
  try {
    const s = await statNow();
    if (!s) return;
    if (s.sidecar !== base.sidecar) { base.sidecar = s.sidecar; await load(true); }
    if (s.file !== base.file) {
      if (dirty) { if (!warned) { warned = true; toast('The file changed on disk. Use the reload button (you have unsaved edits).'); } }
      else { base.file = s.file; await reloadFile(true); }
    }
  } finally { polling = false; }
}
window.addEventListener('focus', tick);
if (WEB) {
  setInterval(tick, 2000);
  $('#cSend').hidden = false;
  $('#cSend').addEventListener('click', async function () {
    if (!openCount()) { toast('No open comments to send.'); return; }
    const r = await io.save();
    if (r !== 'file') { toast(r === 'cancel' ? 'Cancelled.' : 'Could not save the file.'); return; }
    markClean();
    await persist();
    try {
      const res = await TAURI.invoke('send_batch', { path: fileHandle.native });
      toast(res.delivered ? 'Sent ' + res.count + ' comment(s) to the agent.' : 'Queued ' + res.count + ' comment(s). The agent receives them when it runs markline poll.');
    } catch (e) { toast('Could not send: ' + (e && e.message || e)); }
    await load(false); await rebase();
  });
}

/* touch screens have no hover or Ctrl+Alt+M: show the Comment bubble whenever text is selected */
if (window.matchMedia && matchMedia('(pointer: coarse)').matches) {
  let st;
  document.addEventListener('selectionchange', function () {
    clearTimeout(st);
    st = setTimeout(function () {
      if (pending || panel.contains(document.activeElement)) return;
      const sel = window.getSelection();
      const ok = mode === 'source' ? srcEl.selectionEnd > srcEl.selectionStart : (!sel.isCollapsed && !!capture());
      if (!ok) { fab.hidden = true; return; }
      let x = Math.max(8, window.innerWidth / 2 - 50), y = window.innerHeight - 70;
      if (mode !== 'source' && sel.rangeCount) {
        const r = sel.getRangeAt(0).getBoundingClientRect();
        x = Math.max(8, Math.min(r.left, window.innerWidth - 120));
        y = Math.max(8, Math.min(r.bottom + 48, window.innerHeight - 70));
      }
      fab.style.left = x + 'px'; fab.style.top = y + 'px'; fab.hidden = false;
    }, 300);
  });
  fab.addEventListener('touchend', function (e) { e.preventDefault(); startCompose(); });
}

updateBadge(); load(false);
window.__marklineComments = { get: function () { return comments; }, buildPrompt: buildPrompt, payload: payload };
})();
