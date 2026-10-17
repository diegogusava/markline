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
function mdIndex(md) {
  const hay = fold(md, mdKeep(md));
  function line(i) { let n = 1; for (let p = md.indexOf('\n'); p !== -1 && p < i; p = md.indexOf('\n', p + 1)) n++; return n; }
  return {
    find: function (c) {
      const q = qfold(c.quote);
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

if (typeof module !== 'undefined' && module.exports) module.exports = { fold: fold, qfold: qfold, mdKeep: mdKeep, locate: locate, ctx: ctx, mdIndex: mdIndex };
