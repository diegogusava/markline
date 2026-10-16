
/* ---------- class diagram ---------- */
const CLS_NAME = /^[A-Za-z_]\w*$/;
const CLS_REL = /^([A-Za-z_]\w*)\s*(?:"([^"]*)"\s*)?(<\|--|<\|\.\.|\*--|o--|-->|<--|--\*|--o|--\|>|\.\.\|>|\.\.>|<\.\.|--|\.\.)\s*(?:"([^"]*)"\s*)?([A-Za-z_]\w*)(?:\s*:\s*(.*))?$/;
/* token -> [kind, swapped]. from = subclass / whole / source, to = superclass / part / target */
const CLS_TOK = {
  '<|--': ['inherit', true], '--|>': ['inherit', false],
  '<|..': ['realize', true], '..|>': ['realize', false],
  '*--': ['compose', false], '--*': ['compose', true],
  'o--': ['aggregate', false], '--o': ['aggregate', true],
  '-->': ['assoc', false], '<--': ['assoc', true],
  '..>': ['depend', false], '<..': ['depend', true],
  '--': ['link', false], '..': ['dashlink', false]
};
const CLS_OUT = {
  inherit: function (f, t) { return [t, '<|--', f]; },
  realize: function (f, t) { return [t, '<|..', f]; },
  compose: function (f, t) { return [f, '*--', t]; },
  aggregate: function (f, t) { return [f, 'o--', t]; },
  assoc: function (f, t) { return [f, '-->', t]; },
  depend: function (f, t) { return [f, '..>', t]; },
  link: function (f, t) { return [f, '--', t]; },
  dashlink: function (f, t) { return [f, '..', t]; }
};
const CLS_KINDS = [['inherit', 'Inheritance (extends)'], ['realize', 'Realization (implements)'], ['compose', 'Composition'], ['aggregate', 'Aggregation'], ['assoc', 'Association'], ['depend', 'Dependency'], ['link', 'Link'], ['dashlink', 'Dashed link']];
const CLS_STEREOS = ['interface', 'abstract', 'enumeration', 'service', 'entity', 'record'];

function parseCls(src) {
  const lines = String(src).replace(/\r/g, '').split('\n').map(function (l) { return l.replace(/%%.*$/, '').trim(); }).filter(Boolean);
  if (!lines.length || !/^classDiagram$/i.test(lines[0])) return null;
  const m = { dir: 'TB', classes: [], rels: [] };
  const by = new Map();
  function cls(name) {
    let c = by.get(name);
    if (!c) { c = { name: name, stereo: '', members: [] }; by.set(name, c); m.classes.push(c); }
    return c;
  }
  for (let i = 1; i < lines.length; i++) {
    const s = lines[i];
    let r = /^direction\s+(TB|BT|LR|RL)$/i.exec(s);
    if (r) { m.dir = r[1].toUpperCase(); continue; }
    r = /^class\s+([A-Za-z_]\w*)\s*\{$/.exec(s);
    if (r) {
      const c = cls(r[1]);
      i++;
      while (i < lines.length && lines[i] !== '}') {
        const st = /^<<\s*([^>]+?)\s*>>$/.exec(lines[i]);
        if (st) c.stereo = st[1];
        else if (/[{}]/.test(lines[i])) return null;
        else c.members.push({ text: lines[i] });
        i++;
      }
      if (i >= lines.length) return null;
      continue;
    }
    r = /^class\s+([A-Za-z_]\w*)$/.exec(s);
    if (r) { cls(r[1]); continue; }
    r = /^<<\s*([^>]+?)\s*>>\s+([A-Za-z_]\w*)$/.exec(s);
    if (r) { cls(r[2]).stereo = r[1]; continue; }
    r = CLS_REL.exec(s);
    if (r) {
      cls(r[1]); cls(r[5]);
      const d = CLS_TOK[r[3]];
      const ma = r[2] || '', mb = r[4] || '';
      m.rels.push({ kind: d[0], from: d[1] ? r[5] : r[1], to: d[1] ? r[1] : r[5], mf: d[1] ? mb : ma, mt: d[1] ? ma : mb, label: unq(r[6] || '') });
      continue;
    }
    r = /^([A-Za-z_]\w*)\s*:\s*(.+)$/.exec(s);
    if (r) { cls(r[1]).members.push({ text: r[2].trim() }); continue; }
    return null;
  }
  return m;
}
function serializeCls(m) {
  const out = ['classDiagram'];
  if (m.dir && m.dir !== 'TB') out.push('    direction ' + m.dir);
  m.classes.forEach(function (c) {
    if (!c.stereo && !c.members.length) { out.push('    class ' + c.name); return; }
    out.push('    class ' + c.name + ' {');
    if (c.stereo) out.push('        <<' + c.stereo + '>>');
    c.members.forEach(function (x) { out.push('        ' + x.text); });
    out.push('    }');
  });
  m.rels.forEach(function (r) {
    const t = CLS_OUT[r.kind](r.from, r.to);
    const textualFirstIsFrom = t[0] === r.from && r.kind !== 'inherit' && r.kind !== 'realize';
    const ma = textualFirstIsFrom ? r.mf : r.mt, mb = textualFirstIsFrom ? r.mt : r.mf;
    out.push('    ' + t[0] + (ma ? ' "' + ma.replace(/"/g, "'") + '"' : '') + ' ' + t[1] + (mb ? ' "' + mb.replace(/"/g, "'") + '" ' : ' ') + t[2] + (r.label ? ' : ' + r.label : ''));
  });
  return out.join('\n');
}
function clsText(t) { return String(t).replace(/~([^~]*)~/g, '<$1>'); }
function measureCls(c) {
  c._fields = c.members.filter(function (x) { return x.text.indexOf('(') < 0; });
  c._methods = c.members.filter(function (x) { return x.text.indexOf('(') >= 0; });
  const longest = c.members.reduce(function (s, x) { return Math.max(s, clsText(x.text).length); }, 0);
  c._hh = c.stereo ? 46 : 30;
  c._fh = c._fields.length ? c._fields.length * 18 + 8 : 10;
  c._mh = c._methods.length ? c._methods.length * 18 + 8 : 10;
  c.w = Math.round(Math.max(130, c.name.length * 8.6 + 30, longest * 7.2 + 24, c.stereo ? c.stereo.length * 7 + 50 : 0));
  c.h = c._hh + c._fh + c._mh;
}
function layoutCls(m) {
  m.classes.forEach(measureCls);
  const idx = new Map(m.classes.map(function (c, i) { return [c.name, i]; }));
  const links = m.rels.map(function (r) {
    const top = (r.kind === 'inherit' || r.kind === 'realize') ? r.to : r.from;
    const bot = top === r.from ? r.to : r.from;
    return { a: idx.get(top), b: idx.get(bot), lw: r.label ? labelLen(r.label) * 6.4 + 30 : 0 };
  });
  const res = layerLayout(m.classes, links, m.dir || 'TB');
  m.classes.forEach(function (c, i) { c.x = res.pos[i].x; c.y = res.pos[i].y; });
  return { vert: isVert(m.dir || 'TB'), W: Math.round(res.W), H: Math.round(res.H), pad: 44, routes: res.routes };
}
function clsMarker(P, u, type) {
  const pts = function (a) { return a.map(function (p) { return f1(p.x) + ',' + f1(p.y); }).join(' '); };
  if (type === 'triangle') return '<polygon class="cm hollow" points="' + pts([atPt(P, u, 0, 0), atPt(P, u, 15, -7), atPt(P, u, 15, 7)]) + '"/>';
  if (type === 'diamond' || type === 'diamondHollow') return '<polygon class="cm ' + (type === 'diamond' ? 'filled' : 'hollow') + '" points="' + pts([atPt(P, u, 0, 0), atPt(P, u, 9, -6), atPt(P, u, 18, 0), atPt(P, u, 9, 6)]) + '"/>';
  if (type === 'arrow') return '<polyline class="cf" points="' + pts([atPt(P, u, 12, -6), atPt(P, u, 0, 0), atPt(P, u, 12, 6)]) + '"/>';
  return '';
}
const CLS_ENDS = {
  inherit: { to: 'triangle' }, realize: { to: 'triangle' }, compose: { from: 'diamond' }, aggregate: { from: 'diamondHollow' },
  assoc: { to: 'arrow' }, depend: { to: 'arrow' }, link: {}, dashlink: {}
};
function clsCard(c, sel, src) {
  const x = c.x - c.w / 2, y = c.y - c.h / 2, w = c.w, r = 6;
  let s = '<g class="node ecardg' + (sel ? ' sel' : '') + (src ? ' src' : '') + '" data-node="' + esc(c.name) + '">';
  s += '<rect class="nshape" x="' + f1(x) + '" y="' + f1(y) + '" width="' + w + '" height="' + f1(c.h) + '" rx="' + r + '"/>';
  s += '<path class="ehead" d="M' + f1(x) + ',' + f1(y + c._hh) + ' V' + f1(y + r) + ' Q' + f1(x) + ',' + f1(y) + ' ' + f1(x + r) + ',' + f1(y) + ' H' + f1(x + w - r) + ' Q' + f1(x + w) + ',' + f1(y) + ' ' + f1(x + w) + ',' + f1(y + r) + ' V' + f1(y + c._hh) + ' Z"/>';
  if (c.stereo) s += '<text class="es" x="' + f1(c.x) + '" y="' + f1(y + 13) + '" text-anchor="middle" dominant-baseline="central">' + esc('«' + c.stereo + '»') + '</text>';
  s += '<text class="nl eh1" x="' + f1(c.x) + '" y="' + f1(y + c._hh - 15) + '" text-anchor="middle" dominant-baseline="central">' + esc(c.name) + '</text>';
  s += '<line class="ediv" x1="' + f1(x) + '" y1="' + f1(y + c._hh) + '" x2="' + f1(x + w) + '" y2="' + f1(y + c._hh) + '"/>';
  c._fields.forEach(function (f, i) { s += '<text class="en" x="' + f1(x + 10) + '" y="' + f1(y + c._hh + 4 + i * 18 + 9) + '" dominant-baseline="central">' + esc(clsText(f.text)) + '</text>'; });
  s += '<line class="ediv" x1="' + f1(x) + '" y1="' + f1(y + c._hh + c._fh) + '" x2="' + f1(x + w) + '" y2="' + f1(y + c._hh + c._fh) + '"/>';
  c._methods.forEach(function (f, i) { s += '<text class="en" x="' + f1(x + 10) + '" y="' + f1(y + c._hh + c._fh + 4 + i * 18 + 9) + '" dominant-baseline="central">' + esc(clsText(f.text)) + '</text>'; });
  return s + '</g>';
}
function renderCls(m, S, uid) {
  if (!m.classes.length) return '<div class="mm-empty">Empty diagram. Use Add class to start.</div>';
  const lay = layoutCls(m);
  const byName = new Map(m.classes.map(function (c) { return [c.name, c]; }));
  let s = '';
  m.rels.forEach(function (r, k) {
    const a = byName.get(r.from), b = byName.get(r.to);
    if (!a || !b) return;
    /* the layout puts a parent above its children, so an inheritance edge is laid out from its target */
    const up = r.kind === 'inherit' || r.kind === 'realize';
    let g = boxEdge(up ? b : a, up ? a : b, lay.routes[k], m.dir || 'TB');
    if (up && a !== b) g = { d: g.d, p0: g.p1, p1: g.p0, u0: g.u1, u1: g.u0, mid: g.mid };
    const sel = S.sel && S.sel.t === 'e' && S.sel.k === k;
    const ends = CLS_ENDS[r.kind] || {};
    const dashed = r.kind === 'realize' || r.kind === 'depend' || r.kind === 'dashlink';
    let mult = '';
    if (r.mf) { const q = atPt(g.p0, g.u0, 16, 11); mult += '<text class="el" x="' + f1(q.x) + '" y="' + f1(q.y) + '" text-anchor="middle" dominant-baseline="central">' + esc(r.mf) + '</text>'; }
    if (r.mt) { const q = atPt(g.p1, g.u1, 16, 11); mult += '<text class="el" x="' + f1(q.x) + '" y="' + f1(q.y) + '" text-anchor="middle" dominant-baseline="central">' + esc(r.mt) + '</text>'; }
    s += '<g class="redge' + (sel ? ' sel' : '') + '" data-edge="' + k + '"><path class="eh" d="' + g.d + '"/><path class="ep' + (dashed ? ' dotted' : '') + '" d="' + g.d + '"/>' +
      (ends.from ? clsMarker(g.p0, g.u0, ends.from) : '') + (ends.to ? clsMarker(g.p1, g.u1, ends.to) : '') + mult +
      (r.label ? labelSvg(r.label, g.mid.x, g.mid.y) : '') + '</g>';
  });
  m.classes.forEach(function (c) { s += clsCard(c, S.sel && S.sel.t === 'n' && S.sel.id === c.name, S.from === c.name); });
  if (S.sel && S.sel.t === 'n' && byName.get(S.sel.id) && S.mode === 'select') {
    const c = byName.get(S.sel.id);
    s += handleSvg(c.x + c.w / 2, c.y);
  }
  return svgWrap(lay, '', s, 'Class diagram with ' + m.classes.length + ' classes');
}

/* ---------- class editing ---------- */
const CLS_UI = {
  label: 'Class diagram',
  addLabel: 'Add class',
  dirs: [['TB', 'Top to bottom'], ['LR', 'Left to right'], ['BT', 'Bottom to top'], ['RL', 'Right to left']],
  extra: [],
  add: function (m, S) {
    const name = uniqueName(m, 'Class');
    m.classes.push({ name: name, stereo: '', members: [{ text: '+int id' }] });
    S.sel = { t: 'n', id: name };
    return true;
  },
  extraAct: function () { return false; },
  connect: function (m, S, from, to) {
    m.rels.push({ kind: 'assoc', from: from, to: to, mf: '', mt: '', label: '' });
    S.sel = { t: 'e', k: m.rels.length - 1 };
    return true;
  },
  remove: function (m, S) {
    if (!S.sel) return false;
    if (S.sel.t === 'n') {
      const id = S.sel.id;
      m.classes = m.classes.filter(function (c) { return c.name !== id; });
      m.rels = m.rels.filter(function (r) { return r.from !== id && r.to !== id; });
    } else if (S.sel.t === 'e') {
      m.rels.splice(S.sel.k, 1);
    } else return false;
    S.sel = null;
    return true;
  },
  inspector: function (m, S) {
    if (S.sel.t === 'n') {
      const c = m.classes.find(function (x) { return x.name === S.sel.id; });
      if (!c) return '';
      let st = opt('', 'None', c.stereo || '');
      const list = CLS_STEREOS.slice();
      if (c.stereo && list.indexOf(c.stereo) < 0) list.push(c.stereo);
      list.forEach(function (x) { st += opt(x, x, c.stereo || ''); });
      let rows = '';
      c.members.forEach(function (x, i) {
        rows += '<div class="rowline"><input type="text" class="w-member" data-f="member" data-i="' + i + '" value="' + esc(x.text) + '" aria-label="Member">' +
          '<button type="button" class="btn sm danger" data-act="mdel" data-i="' + i + '">Remove</button></div>';
      });
      return '<div class="f row"><span>Class</span></div>' +
        '<label class="f">Name<input type="text" data-f="cname" value="' + esc(c.name) + '"></label>' +
        '<label class="f">Stereotype<select data-f="cstereo">' + st + '</select></label>' +
        '<div class="f row"><button type="button" class="btn sm" data-act="mfield">Add field</button><button type="button" class="btn sm" data-act="mmethod">Add method</button><button type="button" class="btn sm danger" data-act="del">Delete class</button></div>' +
        '<div class="list">' + rows + '</div>' +
        '<span>Members with parentheses are drawn as methods. Prefix + - # ~ sets visibility.</span>';
    }
    const r = m.rels[S.sel.k];
    if (!r) return '';
    return '<div class="f row"><span>Relationship</span><code>' + esc(r.from) + ' to ' + esc(r.to) + '</code></div>' +
      '<label class="f">Type<select data-f="rkind">' + CLS_KINDS.map(function (k) { return opt(k[0], k[1], r.kind); }).join('') + '</select></label>' +
      '<label class="f">Label<input type="text" data-f="rlabel" value="' + esc(r.label || '') + '"></label>' +
      '<label class="f">' + esc(r.from) + ' multiplicity<input type="text" class="w-mult" data-f="rmf" value="' + esc(r.mf || '') + '" placeholder="1"></label>' +
      '<label class="f">' + esc(r.to) + ' multiplicity<input type="text" class="w-mult" data-f="rmt" value="' + esc(r.mt || '') + '" placeholder="*"></label>' +
      '<div class="f row"><button type="button" class="btn sm" data-act="rev">Reverse</button><button type="button" class="btn sm danger" data-act="del">Delete</button></div>';
  },
  input: function (m, S, t) {
    const k = t.getAttribute('data-f');
    if (S.sel.t === 'n') {
      const c = m.classes.find(function (x) { return x.name === S.sel.id; });
      if (!c) return false;
      if (k === 'cname') {
        const nv = t.value.trim();
        if (!CLS_NAME.test(nv)) { S.note = 'Use letters, digits or _ and start with a letter.'; return false; }
        if (nv !== c.name && usedIds(m).has(nv)) { S.note = 'That name is already used.'; return false; }
        m.rels.forEach(function (r) { if (r.from === c.name) r.from = nv; if (r.to === c.name) r.to = nv; });
        c.name = nv; S.sel.id = nv;
        return true;
      }
      if (k === 'cstereo') { c.stereo = t.value; return true; }
      if (k === 'member') {
        const x = c.members[Number(t.getAttribute('data-i'))];
        if (!x) return false;
        x.text = t.value.replace(/[{}]/g, '');
        return true;
      }
      return false;
    }
    const r = m.rels[S.sel.k];
    if (!r) return false;
    if (k === 'rkind') r.kind = t.value; else if (k === 'rlabel') r.label = t.value; else if (k === 'rmf') r.mf = t.value; else if (k === 'rmt') r.mt = t.value; else return false;
    return true;
  },
  click: function (m, S, act, t) {
    if (act === 'del') return CLS_UI.remove(m, S);
    if (S.sel && S.sel.t === 'n') {
      const c = m.classes.find(function (x) { return x.name === S.sel.id; });
      if (!c) return false;
      if (act === 'mfield') { c.members.push({ text: '+String name' }); return true; }
      if (act === 'mmethod') { c.members.push({ text: '+run() void' }); return true; }
      if (act === 'mdel') { c.members.splice(Number(t.getAttribute('data-i')), 1); return true; }
    }
    if (act === 'rev' && S.sel && S.sel.t === 'e') {
      const r = m.rels[S.sel.k];
      const f = r.from; r.from = r.to; r.to = f;
      const x = r.mf; r.mf = r.mt; r.mt = x;
      return true;
    }
    return false;
  }
};
/* ==PURE-END== */
