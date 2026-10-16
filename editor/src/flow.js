
/* ---------- flowchart ---------- */
const SHAPES = { rect: ['[', ']'], round: ['(', ')'], stadium: ['([', '])'], circle: ['((', '))'], diamond: ['{', '}'], cyl: ['[(', ')]'] };
const SHAPE_NAMES = { rect: 'Rectangle', round: 'Rounded', stadium: 'Stadium', circle: 'Circle', diamond: 'Diamond', cyl: 'Database' };
const OPEN_TO_SHAPE = { '[': 'rect', '(': 'round', '([': 'stadium', '((': 'circle', '{': 'diamond', '[(': 'cyl' };
const CLOSE_FOR = { '[': ']', '(': ')', '([': '])', '((': '))', '{': '}', '[(': ')]' };
const NODE_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)(?:(\[\(|\(\[|\(\(|\[|\(|\{)\s*("[^"]*"|[^\]\)\}"]*?)\s*(\)\]|\]\)|\)\)|\]|\)|\}))?/;
const EDGE1 = /^\s*(-->|---|-\.->|-\.-|==>|===)(?:\|("[^"]*"|[^|]*)\|)?\s*/;
const EDGE2 = [/^\s*--\s+(.+?)\s+(-->|---)\s*/, /^\s*-\.\s+(.+?)\s+(\.->|\.-)\s*/, /^\s*==\s+(.+?)\s+(==>|===)\s*/];
const SUBGRAPH_RE = /^subgraph\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\[\s*("[^"]*"|[^\]]*?)\s*\])?\s*$/;

function takeNode(s, model, byId, gById, curGroup) {
  const m = NODE_RE.exec(s);
  if (!m) return null;
  const id = m[1];
  if (gById.has(id)) return null;
  let node = byId.get(id);
  if (!node) { node = { id: id, label: id, shape: 'rect', group: curGroup }; byId.set(id, node); model.nodes.push(node); }
  if (m[2]) {
    if (CLOSE_FOR[m[2]] !== m[4]) return null;
    node.label = unq(m[3]);
    node.shape = OPEN_TO_SHAPE[m[2]];
  }
  return { node: node, rest: s.slice(m[0].length) };
}
function edgeStyle(op) {
  return { style: op.indexOf('.') >= 0 ? 'dotted' : (op.indexOf('=') >= 0 ? 'thick' : 'solid'), arrow: op.charAt(op.length - 1) === '>' };
}
function takeEdge(s) {
  let m = EDGE1.exec(s);
  if (m) return Object.assign({ label: unq(m[2] || ''), rest: s.slice(m[0].length) }, edgeStyle(m[1]));
  for (const re of EDGE2) {
    m = re.exec(s);
    if (m) return Object.assign({ label: m[1].trim(), rest: s.slice(m[0].length) }, edgeStyle(m[2]));
  }
  return null;
}
function parseFlow(src) {
  const lines = String(src).replace(/\r/g, '').split('\n').map(function (l) { return l.replace(/%%.*$/, '').trim(); }).filter(Boolean);
  if (!lines.length) return null;
  const head = /^(?:flowchart|graph)(?:\s+(LR|RL|TB|TD|BT))?\s*;?$/i.exec(lines[0]);
  if (!head) return null;
  const model = { dir: (head[1] || 'TD').toUpperCase(), nodes: [], edges: [], groups: [] };
  if (model.dir === 'TB') model.dir = 'TD';
  const byId = new Map(), gById = new Map(), stack = [];
  const cur = function () { return stack.length ? stack[stack.length - 1] : null; };
  for (const raw of lines.slice(1)) {
    for (const stmt of raw.split(';')) {
      let s = stmt.trim();
      if (!s) continue;
      const sg = SUBGRAPH_RE.exec(s);
      if (sg) {
        if (byId.has(sg[1]) || gById.has(sg[1])) return null;
        const g = { id: sg[1], label: sg[2] ? unq(sg[2]) : sg[1], parent: cur() };
        model.groups.push(g); gById.set(g.id, g); stack.push(g.id);
        continue;
      }
      if (/^end$/i.test(s)) { if (!stack.length) return null; stack.pop(); continue; }
      if (/^(subgraph|style|classDef|class|click|linkStyle|direction)\b/.test(s)) return null;
      const first = takeNode(s, model, byId, gById, cur());
      if (!first) return null;
      let prev = first.node;
      s = first.rest;
      while (s.trim()) {
        const e = takeEdge(s);
        if (!e) return null;
        const n = takeNode(e.rest, model, byId, gById, cur());
        if (!n) return null;
        model.edges.push({ from: prev.id, to: n.node.id, label: e.label, style: e.style, arrow: e.arrow });
        prev = n.node;
        s = n.rest;
      }
    }
  }
  if (stack.length) return null;
  return model;
}
function lbl(s) {
  s = String(s == null ? '' : s);
  return (/["\[\]\(\)\{\}\|]/.test(s) || s.trim() !== s) ? '"' + s.replace(/"/g, '#quot;') + '"' : s;
}
function fmtNode(n) {
  const L = (n.label == null || n.label === '') ? n.id : n.label;
  if (n.shape === 'rect' && L === n.id) return n.id;
  const oc = SHAPES[n.shape] || SHAPES.rect;
  return n.id + oc[0] + lbl(L) + oc[1];
}
function fmtEdge(e) {
  const ops = { solid: ['-->', '---'], dotted: ['-.->', '-.-'], thick: ['==>', '==='] };
  const op = (ops[e.style] || ops.solid)[e.arrow === false ? 1 : 0];
  const l = e.label ? '|' + (/\|/.test(e.label) ? '"' + e.label.replace(/"/g, '#quot;') + '"' : e.label) + '|' : '';
  return e.from + ' ' + op + l + ' ' + e.to;
}
function serializeFlow(m) {
  const out = ['flowchart ' + m.dir];
  const groups = m.groups || [];
  function emit(gid, ind) {
    m.nodes.filter(function (n) { return (n.group || null) === gid; }).forEach(function (n) { out.push(ind + fmtNode(n)); });
    groups.filter(function (g) { return (g.parent || null) === gid; }).forEach(function (g) {
      out.push(ind + 'subgraph ' + g.id + (g.label && g.label !== g.id ? '[' + lbl(g.label) + ']' : ''));
      emit(g.id, ind + '    ');
      out.push(ind + 'end');
    });
  }
  emit(null, '    ');
  m.edges.forEach(function (e) { out.push('    ' + fmtEdge(e)); });
  return out.join('\n');
}
function measureNode(n) {
  const tw = Math.max(24, labelLen(n.label || n.id) * 7.2), more = (labelLines(n.label || n.id).length - 1) * 17;
  let w = tw + 30, h = 40 + more;
  if (n.shape === 'diamond') { w = tw * 1.3 + 36; h = 60 + more * 1.6; }
  else if (n.shape === 'circle') { const d = Math.max(50, tw + 24 + more); w = d; h = d; }
  else if (n.shape === 'cyl') { h = 52 + more; }
  n.w = Math.round(w);
  n.h = h;
}
/* Cluster-aware layout: every group is laid out on its own, then placed as one box in its parent.
   An edge that crosses a group border gets a port on that border, so inside the group it is routed around the other nodes. */
function layoutFlow(m) {
  const vert = isVert(m.dir);
  const PAD = 44, GP = 16, TITLE = 24;
  const groups = m.groups || [];
  if (!m.nodes.length && !groups.length) return { vert: vert, W: 240, H: 90, pad: PAD, pts: [] };
  m.nodes.forEach(measureNode);
  const gById = new Map(groups.map(function (g) { return [g.id, g]; }));
  const nById = new Map(m.nodes.map(function (n) { return [n.id, n]; }));
  function chain(nodeId) {
    const res = [];
    let g = nById.get(nodeId).group || null, guard = 0;
    while (g && guard++ < 60) { res.push(g); g = (gById.get(g) || {}).parent || null; }
    res.push(null);
    return res;
  }
  function kidsOf(gid) {
    const kids = [];
    m.nodes.forEach(function (n) { if ((n.group || null) === gid) kids.push({ key: 'n:' + n.id, ref: n, node: true }); });
    groups.forEach(function (g) { if ((g.parent || null) === gid) kids.push({ key: 'g:' + g.id, ref: g, node: false }); });
    return kids;
  }
  /* the links of every edge, by group: out and inn cross the borders of the groups around its ends (innermost first),
     lca joins the two sides in the group that holds both */
  const parts = m.edges.map(function () { return { out: [], inn: [], lca: null }; });
  const laid = new Map(), org = new Map();
  function place(gid) {
    const kids = kidsOf(gid);
    kids.forEach(function (k) {
      if (k.node) return;
      const inner = place(k.ref.id);
      k.ref._inner = inner;
      k.ref.w = Math.max(inner.W + 2 * GP, String(k.ref.label || k.ref.id).length * 7 + 32, 120);
      k.ref.h = Math.max(inner.H + 2 * GP + TITLE, 64);
    });
    const idx = new Map(kids.map(function (k, i) { return [k.key, i]; }));
    const items = kids.map(function (k) { return { w: k.ref.w, h: k.ref.h }; });
    const port = function (lw) { items.push({ w: vert ? lw : 0, h: !vert && lw ? 26 : 0, v: true }); return items.length - 1; };   /* a port leaves room for the label */
    const links = [];
    m.edges.forEach(function (e, ei) {
      const a = nById.get(e.from), b = nById.get(e.to);
      if (!a || !b || a === b) return;
      const ca = chain(a.id), cb = chain(b.id);
      const ia = ca.indexOf(gid), ib = cb.indexOf(gid);
      if (ia < 0 && ib < 0) return;
      const ka = ia < 0 ? null : idx.get(ia === 0 ? 'n:' + a.id : 'g:' + ca[ia - 1]);
      const kb = ib < 0 ? null : idx.get(ib === 0 ? 'n:' + b.id : 'g:' + cb[ib - 1]);
      const P = parts[ei], li = links.length;
      const lw = e.label && !P.out.length ? labelLen(e.label) * 6.4 + 28 : 0;
      if (ib < 0) { const at = port(lw); P.out.push({ gid: gid, li: li, at: at }); links.push({ a: ka, b: at, lw: lw }); }
      else if (ia < 0) { const at = port(0); P.inn.push({ gid: gid, li: li, at: at }); links.push({ a: at, b: kb, lw: 0 }); }
      else if (ka !== kb) { P.lca = { gid: gid, li: li }; links.push({ a: ka, b: kb, lw: lw }); }
    });
    const res = layerLayout(items, links, m.dir);
    laid.set(gid, res);
    kids.forEach(function (k, i) { k.ref._rx = res.pos[i].x; k.ref._ry = res.pos[i].y; });
    return { W: res.W, H: res.H, n: kids.length };
  }
  function absolute(gid, ox, oy) {
    org.set(gid, { x: ox, y: oy });
    kidsOf(gid).forEach(function (k) {
      k.ref.x = ox + k.ref._rx;
      k.ref.y = oy + k.ref._ry;
      if (!k.node) {
        const inner = k.ref._inner;
        absolute(k.ref.id,
          k.ref.x - k.ref.w / 2 + GP + (k.ref.w - 2 * GP - inner.W) / 2,
          k.ref.y - k.ref.h / 2 + GP + TITLE + (k.ref.h - 2 * GP - TITLE - inner.H) / 2);
      }
    });
  }
  const top = place(null);
  absolute(null, 0, 0);
  const route = function (l) { return laid.get(l.gid).routes[l.li]; };
  const abs = function (l, p) { const o = org.get(l.gid); return { x: o.x + p.x, y: o.y + p.y }; };
  const mids = function (l) { return route(l).mid.map(function (p) { return abs(l, p); }); };
  const portPt = function (l) { return abs(l, laid.get(l.gid).pos[l.at]); };
  const pts = m.edges.map(function (e, ei) {
    const P = parts[ei], a = nById.get(e.from), b = nById.get(e.to);
    if (!P.lca) return null;
    const R = route(P.lca);
    /* an edge that runs backward leaves from the back of its node, so it skips the ports */
    if (R.rev) return [facePt(a, m.dir, false, R.oa).p].concat(mids(P.lca), [facePt(b, m.dir, true, R.ob).p]);
    let res = [facePt(a, m.dir, true, (P.out.length ? route(P.out[0]) : R).oa).p];
    P.out.forEach(function (l) { res = res.concat(mids(l), [portPt(l)]); });
    res = res.concat(mids(P.lca));
    P.inn.slice().reverse().forEach(function (l) { res = res.concat([portPt(l)], mids(l)); });
    res.push(facePt(b, m.dir, false, (P.inn.length ? route(P.inn[0]) : R).ob).p);
    return res;
  });
  return { vert: vert, W: Math.round(top.W), H: Math.round(top.H), pad: PAD, pts: pts };
}
function edgeGeom(lay, e, k, byId) {
  const a = byId.get(e.from), b = byId.get(e.to);
  if (!a || !b) return null;
  if (a === b) {
    const x = a.x, y = a.y - a.h / 2;
    return { d: 'M' + f1(x - 12) + ',' + f1(y) + ' C' + f1(x - 12) + ',' + f1(y - 40) + ' ' + f1(x + 12) + ',' + f1(y - 40) + ' ' + f1(x + 12) + ',' + f1(y), lx: x, ly: y - 30 };
  }
  const pts = lay.pts[k];
  if (!pts) return null;
  const lp = labelPt(pts);
  return { d: curvePath(pts, lay.vert), lx: lp.x, ly: lp.y };
}
function shapeSvg(n) {
  const x = n.x - n.w / 2, y = n.y - n.h / 2, w = n.w, h = n.h;
  switch (n.shape) {
    case 'round': return '<rect class="nshape" x="' + f1(x) + '" y="' + f1(y) + '" width="' + w + '" height="' + h + '" rx="12"/>';
    case 'stadium': return '<rect class="nshape" x="' + f1(x) + '" y="' + f1(y) + '" width="' + w + '" height="' + h + '" rx="' + h / 2 + '"/>';
    case 'circle': return '<ellipse class="nshape" cx="' + f1(n.x) + '" cy="' + f1(n.y) + '" rx="' + w / 2 + '" ry="' + h / 2 + '"/>';
    case 'diamond': return '<polygon class="nshape" points="' + f1(n.x) + ',' + f1(y) + ' ' + f1(x + w) + ',' + f1(n.y) + ' ' + f1(n.x) + ',' + f1(y + h) + ' ' + f1(x) + ',' + f1(n.y) + '"/>';
    case 'cyl': {
      const ry = 8, rx = w / 2;
      return '<path class="nshape" d="M' + f1(x) + ',' + f1(y + ry) + ' A' + rx + ',' + ry + ' 0 0 1 ' + f1(x + w) + ',' + f1(y + ry) + ' V' + f1(y + h - ry) + ' A' + rx + ',' + ry + ' 0 0 1 ' + f1(x) + ',' + f1(y + h - ry) + ' Z M' + f1(x) + ',' + f1(y + ry) + ' A' + rx + ',' + ry + ' 0 0 0 ' + f1(x + w) + ',' + f1(y + ry) + '"/>';
    }
    default: return '<rect class="nshape" x="' + f1(x) + '" y="' + f1(y) + '" width="' + w + '" height="' + h + '" rx="5"/>';
  }
}
function flowHandle(m, n) { return facePt(n, m.dir, true, 0).p; }
function groupDepth(m, g) {
  let d = 0, p = g.parent, guard = 0;
  const by = new Map((m.groups || []).map(function (x) { return [x.id, x]; }));
  while (p && guard++ < 60) { d++; p = (by.get(p) || {}).parent; }
  return d;
}
function renderFlowSvg(m, S, uid) {
  if (!m.nodes.length) return '<div class="mm-empty">Empty diagram. Use Add node to start.</div>';
  const lay = layoutFlow(m);
  const byId = new Map(m.nodes.map(function (n) { return [n.id, n]; }));
  const defs = '<marker id="ah' + uid + '" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" orient="auto"><path class="mk" d="M1 1.5L9 5L1 8.5z"/></marker>' +
    '<marker id="ahs' + uid + '" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" orient="auto"><path class="mks" d="M1 1.5L9 5L1 8.5z"/></marker>';
  let s = '';
  (m.groups || []).slice().sort(function (a, b) { return groupDepth(m, a) - groupDepth(m, b); }).forEach(function (g) {
    const sel = S.sel && S.sel.t === 'g' && S.sel.id === g.id;
    s += '<g class="grp' + (sel ? ' sel' : '') + '" data-group="' + g.id + '"><rect class="gbox" x="' + f1(g.x - g.w / 2) + '" y="' + f1(g.y - g.h / 2) + '" width="' + f1(g.w) + '" height="' + f1(g.h) + '" rx="10"/><text class="gl" x="' + f1(g.x - g.w / 2 + 12) + '" y="' + f1(g.y - g.h / 2 + 16) + '">' + esc(labelLines(g.label || g.id).join(' ')) + '</text></g>';
  });
  m.edges.forEach(function (e, k) {
    const g = edgeGeom(lay, e, k, byId);
    if (!g) return;
    const sel = S.sel && S.sel.t === 'e' && S.sel.k === k;
    s += '<g class="edge' + (sel ? ' sel' : '') + '" data-edge="' + k + '"><path class="eh" d="' + g.d + '"/><path class="ep ' + e.style + '" d="' + g.d + '"' + (e.arrow !== false ? ' marker-end="url(#' + (sel ? 'ahs' : 'ah') + uid + ')"' : '') + '/>' + (e.label ? labelSvg(e.label, g.lx, g.ly) : '') + '</g>';
  });
  m.nodes.forEach(function (n) {
    const sel = S.sel && S.sel.t === 'n' && S.sel.id === n.id;
    const src = S.from === n.id;
    s += '<g class="node' + (sel ? ' sel' : '') + (src ? ' src' : '') + '" data-node="' + n.id + '">' + shapeSvg(n) + textSvg('nl', n.label || n.id, n.x, n.y, 17) + '</g>';
  });
  if (S.sel && S.sel.t === 'n' && byId.get(S.sel.id) && S.mode === 'select') {
    const hp = flowHandle(m, byId.get(S.sel.id));
    s += handleSvg(hp.x, hp.y);
  }
  return svgWrap(lay, defs, s, 'Flowchart with ' + m.nodes.length + ' nodes');
}

/* ---------- flowchart editing ---------- */
function descendantGroups(m, gid) {
  const out = new Set([gid]);
  let grew = true;
  while (grew) {
    grew = false;
    (m.groups || []).forEach(function (g) { if (g.parent && out.has(g.parent) && !out.has(g.id)) { out.add(g.id); grew = true; } });
  }
  return out;
}
function groupOptions(m, cur, exclude) {
  let o = opt('', 'None', cur || '');
  (m.groups || []).forEach(function (g) { if (!exclude || !exclude.has(g.id)) o += opt(g.id, g.label || g.id, cur || ''); });
  return o;
}
const FLOW_UI = {
  label: 'Flowchart',
  addLabel: 'Add node',
  dirs: [['LR', 'Left to right'], ['TD', 'Top to bottom'], ['RL', 'Right to left'], ['BT', 'Bottom to top']],
  extra: [{ act: 'group', label: 'Add group' }],
  add: function (m, S) {
    let id = null;
    for (let i = 0; i < 26; i++) { const c = String.fromCharCode(65 + i); if (!usedIds(m).has(c)) { id = c; break; } }
    if (!id) id = uniqueName(m, 'N');
    let group = null;
    if (S.sel && S.sel.t === 'g') group = S.sel.id;
    if (S.sel && S.sel.t === 'n') { const p = m.nodes.find(function (x) { return x.id === S.sel.id; }); group = p ? p.group || null : null; }
    m.nodes.push({ id: id, label: 'New node', shape: 'rect', group: group });
    if (S.sel && S.sel.t === 'n') m.edges.push({ from: S.sel.id, to: id, label: '', style: 'solid', arrow: true });
    S.sel = { t: 'n', id: id };
    return true;
  },
  extraAct: function (m, S, act) {
    if (act !== 'group') return false;
    if (!m.groups) m.groups = [];
    const id = uniqueName(m, 'grp');
    const g = { id: id, label: 'Group', parent: null };
    if (S.sel && S.sel.t === 'g') g.parent = S.sel.id;
    if (S.sel && S.sel.t === 'n') {
      const n = m.nodes.find(function (x) { return x.id === S.sel.id; });
      if (n) { g.parent = n.group || null; n.group = id; }
    }
    m.groups.push(g);
    S.sel = { t: 'g', id: id };
    return true;
  },
  connect: function (m, S, from, to) {
    if (m.edges.some(function (e) { return e.from === from && e.to === to; })) { S.note = 'Those nodes are already connected.'; return false; }
    m.edges.push({ from: from, to: to, label: '', style: 'solid', arrow: true });
    S.sel = { t: 'e', k: m.edges.length - 1 };
    return true;
  },
  remove: function (m, S) {
    if (!S.sel) return false;
    if (S.sel.t === 'n') {
      const id = S.sel.id;
      m.nodes = m.nodes.filter(function (n) { return n.id !== id; });
      m.edges = m.edges.filter(function (e) { return e.from !== id && e.to !== id; });
    } else if (S.sel.t === 'g') {
      const g = (m.groups || []).find(function (x) { return x.id === S.sel.id; });
      if (!g) return false;
      m.nodes.forEach(function (n) { if (n.group === g.id) n.group = g.parent || null; });
      m.groups.forEach(function (x) { if (x.parent === g.id) x.parent = g.parent || null; });
      m.groups = m.groups.filter(function (x) { return x.id !== g.id; });
    } else {
      m.edges.splice(S.sel.k, 1);
    }
    S.sel = null;
    return true;
  },
  inspector: function (m, S) {
    if (S.sel.t === 'n') {
      const n = m.nodes.find(function (x) { return x.id === S.sel.id; });
      if (!n) return '';
      let shapes = '';
      Object.keys(SHAPE_NAMES).forEach(function (k) { shapes += opt(k, SHAPE_NAMES[k], n.shape); });
      return '<div class="f row"><span>Node</span><code>' + esc(n.id) + '</code></div>' +
        '<label class="f">Label<input type="text" data-f="label" value="' + esc(n.label) + '"></label>' +
        '<label class="f">Shape<select data-f="shape">' + shapes + '</select></label>' +
        ((m.groups || []).length ? '<label class="f">Group<select data-f="ngroup">' + groupOptions(m, n.group) + '</select></label>' : '') +
        '<div class="f"><button type="button" class="btn sm danger" data-act="del">Delete node</button></div>';
    }
    if (S.sel.t === 'g') {
      const g = (m.groups || []).find(function (x) { return x.id === S.sel.id; });
      if (!g) return '';
      return '<div class="f row"><span>Group</span><code>' + esc(g.id) + '</code></div>' +
        '<label class="f">Label<input type="text" data-f="glabel" value="' + esc(g.label || '') + '"></label>' +
        '<label class="f">Inside<select data-f="gparent">' + groupOptions(m, g.parent, descendantGroups(m, g.id)) + '</select></label>' +
        '<div class="f"><button type="button" class="btn sm danger" data-act="del">Delete group</button></div>' +
        '<span>Deleting a group keeps the nodes inside it.</span>';
    }
    const e = m.edges[S.sel.k];
    if (!e) return '';
    return '<div class="f row"><span>Edge</span><code>' + esc(e.from) + ' to ' + esc(e.to) + '</code></div>' +
      '<label class="f">Label<input type="text" data-f="elabel" value="' + esc(e.label || '') + '"></label>' +
      '<label class="f">Line<select data-f="estyle">' + opt('solid', 'Solid', e.style) + opt('dotted', 'Dotted', e.style) + opt('thick', 'Thick', e.style) + '</select></label>' +
      '<label class="f row"><input type="checkbox" data-f="earrow"' + (e.arrow !== false ? ' checked' : '') + '> Arrowhead</label>' +
      '<div class="f row"><button type="button" class="btn sm" data-act="rev">Reverse</button><button type="button" class="btn sm danger" data-act="del">Delete edge</button></div>';
  },
  input: function (m, S, t) {
    const k = t.getAttribute('data-f');
    if (S.sel.t === 'n') {
      const n = m.nodes.find(function (x) { return x.id === S.sel.id; });
      if (!n) return false;
      if (k === 'label') n.label = t.value; else if (k === 'shape') n.shape = t.value; else if (k === 'ngroup') n.group = t.value || null; else return false;
      return true;
    }
    if (S.sel.t === 'g') {
      const g = (m.groups || []).find(function (x) { return x.id === S.sel.id; });
      if (!g) return false;
      if (k === 'glabel') g.label = t.value; else if (k === 'gparent') g.parent = t.value || null; else return false;
      return true;
    }
    const e = m.edges[S.sel.k];
    if (!e) return false;
    if (k === 'elabel') e.label = t.value; else if (k === 'estyle') e.style = t.value; else if (k === 'earrow') e.arrow = t.checked; else return false;
    return true;
  },
  click: function (m, S, act) {
    if (act === 'del') return FLOW_UI.remove(m, S);
    if (act === 'rev' && S.sel && S.sel.t === 'e') {
      const e = m.edges[S.sel.k];
      const t = e.from; e.from = e.to; e.to = t;
      return true;
    }
    return false;
  }
};
