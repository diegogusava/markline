
/* ---------- shared helpers for box diagrams (ER and class) ---------- */
/* edge from box a to box b along the route the layout gave it */
function boxEdge(a, b, route, dir) {
  if (a === b) {
    const x = a.x + a.w / 2, y = a.y;
    return { d: 'M' + f1(x) + ',' + f1(y - 12) + ' C' + f1(x + 46) + ',' + f1(y - 30) + ' ' + f1(x + 46) + ',' + f1(y + 30) + ' ' + f1(x) + ',' + f1(y + 12),
      p0: { x: x, y: y - 12 }, p1: { x: x, y: y + 12 }, u0: { x: 1, y: 0 }, u1: { x: 1, y: 0 }, mid: { x: x + 35, y: y } };
  }
  const A = facePt(a, dir, !route.rev, route.oa), B = facePt(b, dir, route.rev, route.ob);
  const pts = [A.p].concat(route.mid, [B.p]);
  return { d: curvePath(pts, isVert(dir)), p0: A.p, p1: B.p, u0: A.u, u1: B.u, mid: labelPt(pts) };
}
function lineSvg(p, q, cls) { return '<line class="' + cls + '" x1="' + f1(p.x) + '" y1="' + f1(p.y) + '" x2="' + f1(q.x) + '" y2="' + f1(q.y) + '"/>'; }
function atPt(P, u, d, w) { return { x: P.x + u.x * d + (-u.y) * w, y: P.y + u.y * d + u.x * w }; }

/* ---------- ER diagram ---------- */
const ER_LEFT = { '||': 'one', '|o': 'zeroone', '}o': 'zeromany', '}|': 'onemany' };
const ER_RIGHT = { '||': 'one', 'o|': 'zeroone', 'o{': 'zeromany', '|{': 'onemany' };
const ER_LTOK = { one: '||', zeroone: '|o', zeromany: '}o', onemany: '}|' };
const ER_RTOK = { one: '||', zeroone: 'o|', zeromany: 'o{', onemany: '|{' };
const ER_CARDS = [['one', 'Exactly one'], ['zeroone', 'Zero or one'], ['zeromany', 'Zero or many'], ['onemany', 'One or many']];
const ER_REL = /^([A-Za-z_][\w-]*)\s+(\|o|\|\||\}o|\}\|)(--|\.\.)(o\||\|\||o\{|\|\{)\s+([A-Za-z_][\w-]*)(?:\s*:\s*(.*))?$/;
const ER_ATTR = /^(\S+)\s+(\S+)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"([^"]*)")?\s*$/;
const ER_NAME = /^[A-Za-z_][\w-]*$/;

function parseER(src) {
  const lines = String(src).replace(/\r/g, '').split('\n').map(function (l) { return l.replace(/%%.*$/, '').trim(); }).filter(Boolean);
  if (!lines.length || !/^erDiagram$/i.test(lines[0])) return null;
  const m = { entities: [], rels: [] };
  const by = new Map();
  function ent(name) {
    let e = by.get(name);
    if (!e) { e = { name: name, attrs: [] }; by.set(name, e); m.entities.push(e); }
    return e;
  }
  for (let i = 1; i < lines.length; i++) {
    const s = lines[i];
    let r = /^([A-Za-z_][\w-]*)\s*\{$/.exec(s);
    if (r) {
      const e = ent(r[1]);
      i++;
      while (i < lines.length && lines[i] !== '}') {
        const a = ER_ATTR.exec(lines[i]);
        if (!a) return null;
        e.attrs.push({ type: a[1], name: a[2], keys: a[3] ? a[3].split(/\s*,\s*/) : [], comment: a[4] || '' });
        i++;
      }
      if (i >= lines.length) return null;
      continue;
    }
    r = ER_REL.exec(s);
    if (r) {
      ent(r[1]); ent(r[5]);
      m.rels.push({ a: r[1], b: r[5], ca: ER_LEFT[r[2]], cb: ER_RIGHT[r[4]], ident: r[3] === '--', label: unq(r[6] || '') });
      continue;
    }
    if (ER_NAME.test(s)) { ent(s); continue; }
    return null;
  }
  return m;
}
function serializeER(m) {
  const out = ['erDiagram'];
  const tok = function (s, d) { return String(s || d).replace(/\s+/g, '_'); };
  m.entities.forEach(function (e) {
    if (!e.attrs.length) { out.push('    ' + e.name); return; }
    out.push('    ' + e.name + ' {');
    e.attrs.forEach(function (a) {
      out.push('        ' + [tok(a.type, 'string'), tok(a.name, 'field'), (a.keys || []).join(', '), a.comment ? '"' + a.comment.replace(/"/g, "'") + '"' : ''].filter(Boolean).join(' '));
    });
    out.push('    }');
  });
  m.rels.forEach(function (r) {
    const l = r.label || '';
    out.push('    ' + r.a + ' ' + ER_LTOK[r.ca] + (r.ident ? '--' : '..') + ER_RTOK[r.cb] + ' ' + r.b + ' : ' + (/^[\w-]+$/.test(l) ? l : '"' + l.replace(/"/g, "'") + '"'));
  });
  return out.join('\n');
}
function measureEr(e) {
  const mx = function (f, k) { return e.attrs.reduce(function (s, a) { return Math.max(s, f(a)); }, 0) * k; };
  const tw = mx(function (a) { return (a.type || '').length; }, 6.8) + 14;
  const nw = mx(function (a) { return (a.name || '').length; }, 6.8) + 14;
  const kw = e.attrs.some(function (a) { return (a.keys || []).length; }) ? mx(function (a) { return (a.keys || []).join(',').length; }, 6.6) + 12 : 0;
  e._tw = tw; e._kw = kw;
  e.w = Math.round(Math.max(150, e.name.length * 8.6 + 30, tw + nw + kw + 20));
  e.h = e.attrs.length ? 30 + e.attrs.length * 20 + 6 : 46;
}
function layoutEr(m) {
  m.entities.forEach(measureEr);
  const idx = new Map(m.entities.map(function (e, i) { return [e.name, i]; }));
  const links = m.rels.map(function (r) { return { a: idx.get(r.a), b: idx.get(r.b), lw: r.label ? labelLen(r.label) * 6.4 + 30 : 0 }; });
  const res = layerLayout(m.entities, links, 'TD');
  m.entities.forEach(function (e, i) { e.x = res.pos[i].x; e.y = res.pos[i].y; });
  return { vert: true, W: Math.round(res.W), H: Math.round(res.H), pad: 44, routes: res.routes };
}
function erCards(P, u, card) {
  const tick = function (d) { return lineSvg(atPt(P, u, d, -6), atPt(P, u, d, 6), 'cf'); };
  const ring = function (d) { const c = atPt(P, u, d, 0); return '<circle class="cfr" cx="' + f1(c.x) + '" cy="' + f1(c.y) + '" r="4.5"/>'; };
  const fork = function (d) { const t = atPt(P, u, d, 0); return lineSvg(t, atPt(P, u, 0, -7), 'cf') + lineSvg(t, atPt(P, u, 0, 0), 'cf') + lineSvg(t, atPt(P, u, 0, 7), 'cf'); };
  if (card === 'one') return tick(8) + tick(13);
  if (card === 'zeroone') return tick(8) + ring(17);
  if (card === 'onemany') return fork(12) + tick(16);
  return fork(12) + ring(21);
}
function erCard(e, sel, src) {
  const x = e.x - e.w / 2, y = e.y - e.h / 2, w = e.w, r = 6;
  let s = '<g class="node ecardg' + (sel ? ' sel' : '') + (src ? ' src' : '') + '" data-node="' + esc(e.name) + '">';
  s += '<rect class="nshape" x="' + f1(x) + '" y="' + f1(y) + '" width="' + w + '" height="' + e.h + '" rx="' + r + '"/>';
  s += '<path class="ehead" d="M' + f1(x) + ',' + f1(y + 30) + ' V' + f1(y + r) + ' Q' + f1(x) + ',' + f1(y) + ' ' + f1(x + r) + ',' + f1(y) + ' H' + f1(x + w - r) + ' Q' + f1(x + w) + ',' + f1(y) + ' ' + f1(x + w) + ',' + f1(y + r) + ' V' + f1(y + 30) + ' Z"/>';
  s += '<line class="ediv" x1="' + f1(x) + '" y1="' + f1(y + 30) + '" x2="' + f1(x + w) + '" y2="' + f1(y + 30) + '"/>';
  s += '<text class="nl eh1" x="' + f1(e.x) + '" y="' + f1(y + 15) + '" text-anchor="middle" dominant-baseline="central">' + esc(e.name) + '</text>';
  e.attrs.forEach(function (a, i) {
    const ry = y + 30 + i * 20 + 13;
    s += '<text class="et" x="' + f1(x + 10) + '" y="' + f1(ry) + '" dominant-baseline="central">' + esc(a.type || '') + '</text>';
    s += '<text class="en" x="' + f1(x + 10 + e._tw) + '" y="' + f1(ry) + '" dominant-baseline="central">' + esc(a.name || '') + '</text>';
    if ((a.keys || []).length) s += '<text class="ek" x="' + f1(x + w - 10) + '" y="' + f1(ry) + '" text-anchor="end" dominant-baseline="central">' + esc(a.keys.join(', ')) + '</text>';
  });
  if (!e.attrs.length) s += '<text class="et" x="' + f1(e.x) + '" y="' + f1(y + 38) + '" text-anchor="middle" dominant-baseline="central">no attributes</text>';
  return s + '</g>';
}
function renderEr(m, S, uid) {
  if (!m.entities.length) return '<div class="mm-empty">Empty schema. Use Add entity to start.</div>';
  const lay = layoutEr(m);
  const byName = new Map(m.entities.map(function (e) { return [e.name, e]; }));
  let s = '';
  m.rels.forEach(function (r, k) {
    const a = byName.get(r.a), b = byName.get(r.b);
    if (!a || !b) return;
    const g = boxEdge(a, b, lay.routes[k], 'TD');
    const sel = S.sel && S.sel.t === 'e' && S.sel.k === k;
    s += '<g class="redge' + (sel ? ' sel' : '') + '" data-edge="' + k + '"><path class="eh" d="' + g.d + '"/><path class="ep' + (r.ident ? '' : ' dotted') + '" d="' + g.d + '"/>' +
      erCards(g.p0, g.u0, r.ca) + erCards(g.p1, g.u1, r.cb) + (r.label ? labelSvg(r.label, g.mid.x, g.mid.y) : '') + '</g>';
  });
  m.entities.forEach(function (e) { s += erCard(e, S.sel && S.sel.t === 'n' && S.sel.id === e.name, S.from === e.name); });
  if (S.sel && S.sel.t === 'n' && byName.get(S.sel.id) && S.mode === 'select') {
    const e = byName.get(S.sel.id);
    s += handleSvg(e.x + e.w / 2, e.y);
  }
  return svgWrap(lay, '', s, 'Entity relationship diagram with ' + m.entities.length + ' entities');
}

/* ---------- ER editing ---------- */
function erCardOpts(cur) { return ER_CARDS.map(function (c) { return opt(c[0], c[1], cur); }).join(''); }
const ER_UI = {
  label: 'ER diagram',
  addLabel: 'Add entity',
  dirs: null,
  extra: [],
  add: function (m, S) {
    const name = uniqueName(m, 'ENTITY');
    m.entities.push({ name: name, attrs: [{ type: 'int', name: 'id', keys: ['PK'], comment: '' }] });
    S.sel = { t: 'n', id: name };
    return true;
  },
  extraAct: function () { return false; },
  connect: function (m, S, from, to) {
    m.rels.push({ a: from, b: to, ca: 'one', cb: 'zeromany', ident: true, label: 'has' });
    S.sel = { t: 'e', k: m.rels.length - 1 };
    return true;
  },
  remove: function (m, S) {
    if (!S.sel) return false;
    if (S.sel.t === 'n') {
      const id = S.sel.id;
      m.entities = m.entities.filter(function (e) { return e.name !== id; });
      m.rels = m.rels.filter(function (r) { return r.a !== id && r.b !== id; });
    } else if (S.sel.t === 'e') {
      m.rels.splice(S.sel.k, 1);
    } else return false;
    S.sel = null;
    return true;
  },
  inspector: function (m, S) {
    if (S.sel.t === 'n') {
      const e = m.entities.find(function (x) { return x.name === S.sel.id; });
      if (!e) return '';
      let rows = '';
      e.attrs.forEach(function (a, i) {
        const has = function (k) { return (a.keys || []).indexOf(k) >= 0 ? ' checked' : ''; };
        rows += '<div class="rowline">' +
          '<input type="text" class="w-type" data-f="atype" data-i="' + i + '" value="' + esc(a.type || '') + '" aria-label="Type">' +
          '<input type="text" class="w-name" data-f="aname" data-i="' + i + '" value="' + esc(a.name || '') + '" aria-label="Column name">' +
          '<label class="chk"><input type="checkbox" data-f="akey" data-key="PK" data-i="' + i + '"' + has('PK') + '> PK</label>' +
          '<label class="chk"><input type="checkbox" data-f="akey" data-key="FK" data-i="' + i + '"' + has('FK') + '> FK</label>' +
          '<label class="chk"><input type="checkbox" data-f="akey" data-key="UK" data-i="' + i + '"' + has('UK') + '> UK</label>' +
          '<input type="text" class="w-note" data-f="acomment" data-i="' + i + '" value="' + esc(a.comment || '') + '" placeholder="Comment" aria-label="Comment">' +
          '<button type="button" class="btn sm danger" data-act="adel" data-i="' + i + '">Remove</button></div>';
      });
      return '<div class="f row"><span>Entity</span></div>' +
        '<label class="f">Name<input type="text" data-f="ename" value="' + esc(e.name) + '"></label>' +
        '<div class="f row"><button type="button" class="btn sm" data-act="aadd">Add attribute</button><button type="button" class="btn sm danger" data-act="del">Delete entity</button></div>' +
        '<div class="list">' + rows + '</div>';
    }
    const r = m.rels[S.sel.k];
    if (!r) return '';
    return '<div class="f row"><span>Relationship</span><code>' + esc(r.a) + ' to ' + esc(r.b) + '</code></div>' +
      '<label class="f">Label<input type="text" data-f="elabel" value="' + esc(r.label || '') + '"></label>' +
      '<label class="f">' + esc(r.a) + ' side<select data-f="eca">' + erCardOpts(r.ca) + '</select></label>' +
      '<label class="f">' + esc(r.b) + ' side<select data-f="ecb">' + erCardOpts(r.cb) + '</select></label>' +
      '<label class="f row"><input type="checkbox" data-f="eident"' + (r.ident ? ' checked' : '') + '> Identifying (solid line)</label>' +
      '<div class="f row"><button type="button" class="btn sm" data-act="rev">Reverse</button><button type="button" class="btn sm danger" data-act="del">Delete</button></div>';
  },
  input: function (m, S, t) {
    const k = t.getAttribute('data-f');
    if (S.sel.t === 'n') {
      const e = m.entities.find(function (x) { return x.name === S.sel.id; });
      if (!e) return false;
      if (k === 'ename') {
        const nv = t.value.trim().replace(/\s+/g, '_');
        if (!ER_NAME.test(nv)) { S.note = 'Start with a letter, then letters, digits, _ or -.'; return false; }
        if (nv !== e.name && usedIds(m).has(nv)) { S.note = 'That name is already used.'; return false; }
        m.rels.forEach(function (r) { if (r.a === e.name) r.a = nv; if (r.b === e.name) r.b = nv; });
        e.name = nv; S.sel.id = nv;
        return true;
      }
      const a = e.attrs[Number(t.getAttribute('data-i'))];
      if (!a) return false;
      if (k === 'atype') a.type = t.value.replace(/\s+/g, '_');
      else if (k === 'aname') a.name = t.value.replace(/\s+/g, '_');
      else if (k === 'acomment') a.comment = t.value;
      else if (k === 'akey') {
        const key = t.getAttribute('data-key');
        const ks = (a.keys || []).filter(function (x) { return x !== key; });
        if (t.checked) ks.push(key);
        a.keys = ['PK', 'FK', 'UK'].filter(function (x) { return ks.indexOf(x) >= 0; });
      } else return false;
      return true;
    }
    const r = m.rels[S.sel.k];
    if (!r) return false;
    if (k === 'elabel') r.label = t.value; else if (k === 'eca') r.ca = t.value; else if (k === 'ecb') r.cb = t.value; else if (k === 'eident') r.ident = t.checked; else return false;
    return true;
  },
  click: function (m, S, act, t) {
    if (act === 'del') return ER_UI.remove(m, S);
    if (S.sel && S.sel.t === 'n') {
      const e = m.entities.find(function (x) { return x.name === S.sel.id; });
      if (!e) return false;
      if (act === 'aadd') { e.attrs.push({ type: 'string', name: 'column' + (e.attrs.length + 1), keys: [], comment: '' }); return true; }
      if (act === 'adel') { e.attrs.splice(Number(t.getAttribute('data-i')), 1); return true; }
    }
    if (act === 'rev' && S.sel && S.sel.t === 'e') {
      const r = m.rels[S.sel.k];
      const a = r.a; r.a = r.b; r.b = a;
      const c = r.ca; r.ca = r.cb; r.cb = c;
      return true;
    }
    return false;
  }
};
