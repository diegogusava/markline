/* Comment anchoring: find a comment's quoted text in a document, ignoring markdown marks and whitespace.
   Pure functions, shared by comments.js and the node tests. */
/* ---------- text folding: drops markdown marks, collapses whitespace, keeps a map to original indexes ---------- */
const DROP = /[*_`~|#>\\​]/;
function fold(str, keep) {
  let s = '', map = [], sp = true;
  for (let i = 0; i < str.length; i++) {
    if (keep && !keep[i]) continue;
    const ch = str[i];
    if (DROP.test(ch)) continue;
    if (/\s/.test(ch) || (keep && keep[i] === 2)) { if (!sp) { s += ' '; map.push(i); sp = true; } continue; }
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
  const br = /<br\s*\/?>/gi;
  while ((m = br.exec(md))) { k[m.index] = 2; zero(m.index + 1, m.index + m[0].length); }
  [/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, /^[ \t|:-]*-{3,}[ \t|:-]*$/gm, /^[ \t]*(?:```|~~~)[^\n]*$/gm].forEach(function (re) {
    let x;
    while ((x = re.exec(md))) { if (x[0].length) zero(x.index, x.index + x[0].length); else re.lastIndex++; }
  });
  return k;
}
/* a quote may come from markdown lines (source selection, agent reply), so drop the same marks as in the document */
function qfold(q) { return fold(q, mdKeep(q)).s; }
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
/* the quote is gone: guess its place from the context saved around it (the text between the old neighbours) */
function near(hay, len, pre, suf) {
  pre = qfold(pre).replace(/(?:^|\s)(?:[-+*]|\d+[.)])$/, ''); suf = qfold(suf);
  function at(t, end) { const out = []; if (t.length < 8) return out; for (let i = hay.s.indexOf(t); i !== -1; i = hay.s.indexOf(t, i + 1)) out.push(end ? i + t.length : i); return out; }
  const ps = at(pre, true), ss = at(suf, false), max = Math.max(400, len * 4);
  let r = null;
  ps.forEach(function (a) { ss.forEach(function (b) { if (b >= a && b - a <= max && (!r || b - a < r.b - r.a)) r = { a: a, b: b }; }); });
  if (!r && ps.length) r = { a: ps[0], b: Math.min(hay.s.length, ps[0] + len) };
  if (!r && ss.length) r = { a: Math.max(0, ss[0] - len), b: ss[0] };
  if (!r) return null;
  while (r.a < r.b && hay.s[r.a] === ' ') r.a++;
  while (r.b > r.a && hay.s[r.b - 1] === ' ') r.b--;
  r.approx = true;
  return r;
}
/* where comment c sits in folded text: exact quote, else its head and tail, else the closest match */
function place(hay, c) {
  const q = qfold(c.quote), pre = c.pre || '', suf = c.suf || '';
  let r = locate(hay, q, pre, suf);
  if (!r && q.length > 40) {
    const h = locate(hay, q.slice(0, 40), pre, ''), t = locate(hay, q.slice(-40), '', suf);
    if (h && t && t.b >= h.a) r = { a: h.a, b: t.b };
  }
  return r || near(hay, q.length, pre, suf);
}
function mdIndex(md) {
  const hay = fold(md, mdKeep(md));
  function line(i) { let n = 1; for (let p = md.indexOf('\n'); p !== -1 && p < i; p = md.indexOf('\n', p + 1)) n++; return n; }
  return {
    find: function (c) {
      const r = place(hay, c);
      if (!r || !hay.map.length) return null;
      const s = hay.map[Math.min(r.a, hay.map.length - 1)], e = r.b > r.a ? hay.map[r.b - 1] + 1 : s;
      return { s: s, e: e, l1: line(s), l2: line(Math.max(s, e - 1)), approx: !!r.approx };
    }
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { fold: fold, qfold: qfold, mdKeep: mdKeep, locate: locate, place: place, ctx: ctx, mdIndex: mdIndex };
