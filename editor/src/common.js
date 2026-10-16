/* ==PURE-START== */
const NS = 'http://www.w3.org/2000/svg';
function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function f1(n) { return Math.round(n * 10) / 10; }

function isVert(dir) { return dir === 'TD' || dir === 'TB' || dir === 'BT'; }

/* Point on the face of box n that looks along the layout direction (fwd) or against it, moved by off along that face.
   Returns the point p and the unit vector u that leaves the box there. */
function facePt(n, dir, fwd, off) {
  const vert = isVert(dir), s = ((dir === 'RL' || dir === 'BT') ? -1 : 1) * (fwd ? 1 : -1);
  const hc = (vert ? n.w : n.h) / 2, hm = (vert ? n.h : n.w) / 2;
  const o = Math.max(-hc, Math.min(hc, off || 0));
  let d = hm;
  if (n.shape === 'diamond') d = hm * (1 - Math.abs(o) / hc);
  else if (n.shape === 'circle') d = hm * Math.sqrt(1 - (o * o) / (hc * hc));
  return vert ? { p: { x: n.x + o, y: n.y + s * d }, u: { x: 0, y: s } } : { p: { x: n.x + s * d, y: n.y + o }, u: { x: s, y: 0 } };
}
/* Smooth path through pts. Every point is entered and left along the layout axis, so edges meet the boxes at a right angle. */
function curvePath(pts, vert) {
  let d = 'M' + f1(pts[0].x) + ',' + f1(pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i];
    const c1 = vert ? { x: p.x, y: (p.y + q.y) / 2 } : { x: (p.x + q.x) / 2, y: p.y };
    const c2 = vert ? { x: q.x, y: c1.y } : { x: c1.x, y: q.y };
    d += ' C' + f1(c1.x) + ',' + f1(c1.y) + ' ' + f1(c2.x) + ',' + f1(c2.y) + ' ' + f1(q.x) + ',' + f1(q.y);
  }
  return d;
}
/* where the label of an edge goes: the middle of its first stretch, which lies in the gap that was sized for it */
function labelPt(pts) { return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }; }

/* Layered layout. items: [{w,h,v}] (v marks a zero-size port), links: [{a,b,lw}] by index.
   Returns centers relative to the top-left corner, and a route per link:
   { rev, mid, oa, ob }. rev: the link runs against the layout direction. mid: the points between its two ends, in order
   from a to b; they lead a long link around the boxes of the layers it passes. oa, ob: where it meets the faces of a and b. */
function layerLayout(items, links, dir) {
  const vert = isVert(dir);
  const N = items.length;
  if (!N) return { W: 0, H: 0, pos: [], layer: [], routes: [] };
  const ok = function (e) { return e.a != null && e.b != null && e.a !== e.b; };
  const out = items.map(function () { return []; });
  const hasIn = new Array(N).fill(0);
  links.forEach(function (e, k) {
    if (!ok(e)) return;
    out[e.a].push({ to: e.b, k: k });
    hasIn[e.b] = 1;
  });
  const st = new Array(N).fill(0);
  const back = new Set();
  const order = Array.from(items.keys()).sort(function (a, b) { return (hasIn[a] - hasIn[b]) || (a - b); });
  function dfs(u) {
    st[u] = 1;
    for (const o of out[u]) {
      if (st[o.to] === 1) back.add(o.k);
      else if (st[o.to] === 0) dfs(o.to);
    }
    st[u] = 2;
  }
  order.forEach(function (u) { if (st[u] === 0) dfs(u); });
  /* a link that closes a cycle is laid out reversed, so every link goes from a lower layer to a higher one */
  const pred = items.map(function () { return []; });
  links.forEach(function (e, k) { if (ok(e)) { if (back.has(k)) pred[e.a].push(e.b); else pred[e.b].push(e.a); } });
  const layer = new Array(N).fill(null);
  function calc(u) {
    if (layer[u] !== null) return layer[u];
    layer[u] = 0;
    let l = 0;
    for (const p of pred[u]) l = Math.max(l, calc(p) + 1);
    layer[u] = l;
    return l;
  }
  items.forEach(function (_, i) { calc(i); });
  /* ports sit on the border: the ones links come in through before every box, the ones links leave through after */
  const inPort = function (u) { return items[u].v && !pred[u].length; }, outPort = function (u) { return items[u].v && pred[u].length; };
  if (items.some(function (_, u) { return inPort(u); })) items.forEach(function (_, u) { if (!inPort(u)) layer[u]++; });
  const deep = Math.max.apply(null, layer.map(function (l, u) { return outPort(u) ? 0 : l; }));
  items.forEach(function (_, u) { if (outPort(u)) layer[u] = deep + 1; });
  /* a link that spans several layers gets one dummy per layer in between; ids from N up are dummies */
  const lyr = layer.slice(), wide = layer.map(function () { return 0; });   /* wide: room a dummy takes, more when its link has a label */
  const above = items.map(function () { return []; }), below = items.map(function () { return []; });
  const chains = links.map(function (e, k) {
    if (!ok(e)) return null;
    const rev = back.has(k), top = rev ? e.b : e.a, bot = rev ? e.a : e.b;
    const ch = [top];
    for (let l = lyr[top] + 1; l < lyr[bot]; l++) { lyr.push(l); wide.push(e.lw ? (vert ? e.lw : 26) : 10); above.push([]); below.push([]); ch.push(lyr.length - 1); }
    ch.push(bot);
    for (let i = 1; i < ch.length; i++) { below[ch[i - 1]].push(ch[i]); above[ch[i]].push(ch[i - 1]); }
    return { rev: rev, ch: ch };
  });
  const L = Math.max.apply(null, lyr) + 1;
  const layers = Array.from({ length: L }, function () { return []; });
  lyr.forEach(function (l, u) { layers[l].push(u); });
  const thin = function (u) { return u >= N || !!items[u].v; };
  const main = function (u) { return u >= N ? 0 : (vert ? items[u].h : items[u].w); };
  const cross = function (u) { return u >= N ? wide[u] : (vert ? items[u].w : items[u].h); };
  const mean = function (list, of) { return list.reduce(function (s, v) { return s + of[v]; }, 0) / list.length; };
  /* order inside the layers: fewer crossings */
  const pos0 = new Array(lyr.length).fill(0);
  function setPos() { layers.forEach(function (ly) { ly.forEach(function (u, i) { pos0[u] = i; }); }); }
  setPos();
  const bary = function (u, list) { return list.length ? mean(list, pos0) : pos0[u]; };
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < L; i++) { layers[i].sort(function (a, b) { return bary(a, above[a]) - bary(b, above[b]); }); setPos(); }
    for (let i = L - 2; i >= 0; i--) { layers[i].sort(function (a, b) { return bary(a, below[a]) - bary(b, below[b]); }); setPos(); }
  }
  /* place along the layers: start packed, then pull every item toward its neighbours while keeping order and distance */
  const CG = 26;
  const sep = function (u, v) { return (cross(u) + cross(v)) / 2 + (thin(u) && thin(v) ? 8 : (thin(u) || thin(v) ? 16 : CG)); };
  const cx = new Array(lyr.length).fill(0);
  layers.forEach(function (ly) {
    for (let j = 1; j < ly.length; j++) cx[ly[j]] = cx[ly[j - 1]] + sep(ly[j - 1], ly[j]);
    const half = cx[ly[ly.length - 1]] / 2;
    ly.forEach(function (u) { cx[u] -= half; });
  });
  for (let pass = 0; pass < 12; pass++) {
    (pass % 2 ? layers.slice().reverse() : layers).forEach(function (ly) {
      const want = ly.map(function (u) { const nb = above[u].concat(below[u]); return nb.length ? mean(nb, cx) : cx[u]; });
      const lo = want.slice(), hi = want.slice();
      for (let j = 1; j < ly.length; j++) lo[j] = Math.max(want[j], lo[j - 1] + sep(ly[j - 1], ly[j]));
      for (let j = ly.length - 2; j >= 0; j--) hi[j] = Math.min(want[j], hi[j + 1] - sep(ly[j], ly[j + 1]));
      ly.forEach(function (u, j) { cx[u] = (lo[j] + hi[j]) / 2; });
    });
  }
  const minC = Math.min.apply(null, cx.map(function (c, u) { return c - cross(u) / 2; }));
  cx.forEach(function (c, u) { cx[u] = c - minC; });
  const maxCross = Math.max.apply(null, cx.map(function (c, u) { return c + cross(u) / 2; }));
  /* place the layers; a gap grows to fit the labels of the links that start in it */
  const solid = layers.map(function (ly) { return ly.some(function (u) { return !thin(u); }); });
  const gaps = layers.slice(1).map(function (_, i) { return solid[i] && solid[i + 1] ? (vert ? 46 : 42) : 22; });
  links.forEach(function (e, k) {
    if (!chains[k] || !e.lw) return;
    const g = chains[k].rev ? layer[e.a] - 1 : layer[e.a];
    gaps[g] = Math.max(gaps[g], vert ? 64 : e.lw);
  });
  const layerMain = layers.map(function (ly) { return Math.max.apply(null, ly.map(main)); });
  const start = [];
  let mainPos = 0;
  layers.forEach(function (_, i) { start[i] = mainPos; mainPos += layerMain[i] + (gaps[i] || 0); });
  const W = vert ? maxCross : mainPos, H = vert ? mainPos : maxCross;
  const xy = function (c, mn) {
    const p = vert ? { x: c, y: mn } : { x: mn, y: c };
    if (dir === 'RL') p.x = W - p.x;
    if (dir === 'BT') p.y = H - p.y;
    return p;
  };
  /* links that share a face of a box are spread along it, in the order of where they come from */
  const off = function (list, u) {
    list.sort(function (p, q) { return (cx[p.other] - cx[q.other]) || (p.k - q.k); });
    const step = Math.min(18, cross(u) * 0.7 / list.length);
    list.forEach(function (p, j) { p.set((j - (list.length - 1) / 2) * step); });
  };
  const outF = items.map(function () { return []; }), inF = items.map(function () { return []; });
  const oTop = [], oBot = [];
  chains.forEach(function (c, k) {
    if (!c) return;
    outF[c.ch[0]].push({ k: k, other: c.ch[1], set: function (v) { oTop[k] = v; } });
    inF[c.ch[c.ch.length - 1]].push({ k: k, other: c.ch[c.ch.length - 2], set: function (v) { oBot[k] = v; } });
  });
  items.forEach(function (_, u) { off(outF[u], u); off(inF[u], u); });
  const routes = chains.map(function (c, k) {
    if (!c) return null;
    const mid = [];
    c.ch.slice(1, -1).forEach(function (d) {
      const l = lyr[d];
      mid.push(xy(cx[d], start[l]));
      if (layerMain[l]) mid.push(xy(cx[d], start[l] + layerMain[l]));
    });
    if (c.rev) mid.reverse();
    return { rev: c.rev, mid: mid, oa: c.rev ? oBot[k] : oTop[k], ob: c.rev ? oTop[k] : oBot[k] };
  });
  const pos = items.map(function (_, u) { return xy(cx[u], start[layer[u]] + layerMain[layer[u]] / 2); });
  return { W: W, H: H, pos: pos, layer: layer, routes: routes };
}

function svgWrap(lay, defs, inner, label) {
  const VW = Math.round(lay.W + lay.pad * 2), VH = Math.round(lay.H + lay.pad * 2);
  return '<svg xmlns="' + NS + '" viewBox="0 0 ' + VW + ' ' + VH + '" role="img" aria-label="' + esc(label) + '" style="max-width:' + VW + 'px;min-width:' + Math.min(VW, 520) + 'px">' +
    (defs ? '<defs>' + defs + '</defs>' : '') +
    '<g class="layer" transform="translate(' + lay.pad + ',' + lay.pad + ')">' + inner + '</g></svg>';
}
function handleSvg(x, y) {
  return '<circle class="handle" data-handle="1" cx="' + f1(x) + '" cy="' + f1(y) + '" r="7"><title>Drag to another item to connect it</title></circle>';
}
/* Mermaid breaks a label into lines with <br/> */
function labelLines(s) { return String(s).split(/<br\s*\/?>/i).map(function (l) { return l.trim(); }); }
function labelLen(s) { return Math.max.apply(null, labelLines(s).map(function (l) { return l.length; })); }
/* centered text, one tspan per line, lh apart */
function textSvg(cls, text, x, y, lh) {
  const lines = labelLines(text);
  return '<text class="' + cls + '" x="' + f1(x) + '" y="' + f1(y) + '" text-anchor="middle" dominant-baseline="central">' +
    (lines.length === 1 ? esc(lines[0]) : lines.map(function (l, i) { return '<tspan x="' + f1(x) + '" dy="' + (i ? lh : -(lines.length - 1) * lh / 2) + '">' + esc(l) + '</tspan>'; }).join('')) + '</text>';
}
function labelSvg(text, x, y) {
  const lw = labelLen(text) * 6.4 + 12, lh = 18 + (labelLines(text).length - 1) * 15;
  return '<rect class="elb" x="' + f1(x - lw / 2) + '" y="' + f1(y - lh / 2) + '" width="' + f1(lw) + '" height="' + lh + '" rx="3"/>' + textSvg('el', text, x, y, 15);
}
function usedIds(m) {
  const s = new Set();
  (m.nodes || []).forEach(function (n) { s.add(n.id); });
  (m.groups || []).forEach(function (g) { s.add(g.id); });
  (m.entities || []).forEach(function (e) { s.add(e.name); });
  (m.classes || []).forEach(function (c) { s.add(c.name); });
  return s;
}
function uniqueName(m, base) {
  const used = usedIds(m);
  if (!used.has(base)) return base;
  let k = 2;
  while (used.has(base + k)) k++;
  return base + k;
}
function opt(value, label, cur) { return '<option value="' + esc(value) + '"' + (value === cur ? ' selected' : '') + '>' + esc(label) + '</option>'; }
function unq(s) {
  s = String(s == null ? '' : s).trim();
  if (s.length > 1 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') s = s.slice(1, -1);
  return s.replace(/#quot;/g, '"');
}
