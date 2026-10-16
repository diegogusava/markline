
/* ---------- diagram blocks (one framework, three editors) ---------- */
const $ = function (s) { return document.querySelector(s); };
let uidCounter = 0;
let askFn = null;

const KINDS = {
  flow: { parse: parseFlow, serialize: serializeFlow, render: renderFlowSvg, ui: FLOW_UI },
  er: { parse: parseER, serialize: serializeER, render: renderEr, ui: ER_UI },
  cls: { parse: parseCls, serialize: serializeCls, render: renderCls, ui: CLS_UI }
};
const STARTERS = {
  flow: 'flowchart LR\n    A[Start] --> B[Next step]',
  cls: 'classDiagram\n    class Animal {\n        <<abstract>>\n        +String name\n        +eat() void\n    }\n    class Dog {\n        +bark() void\n    }\n    Animal <|-- Dog',
  er: 'erDiagram\n    CUSTOMER {\n        int id PK\n        string name\n    }\n    ORDERS {\n        int id PK\n        int customer_id FK\n    }\n    CUSTOMER ||--o{ ORDERS : places'
};
function firstLine(src) {
  return String(src).split('\n').map(function (l) { return l.replace(/%%.*$/, '').trim(); }).filter(Boolean)[0] || '';
}
function detectKind(src) {
  const f = firstLine(src);
  if (/^(flowchart|graph)\b/i.test(f)) return 'flow';
  if (/^erDiagram\b/i.test(f)) return 'er';
  if (/^classDiagram\b/i.test(f)) return 'cls';
  return null;
}

function initBlock(fig) {
  if (fig._mm) return;
  const uid = ++uidCounter;
  const S = fig._mm = { kind: null, model: null, sel: null, mode: 'select', from: null, code: false, src: fig.getAttribute('data-src') || '', note: '' };
  fig.setAttribute('contenteditable', 'false');
  fig.tabIndex = -1;
  fig.innerHTML =
    '<div class="mm-bar"><span class="mm-kind">Diagram</span>' +
    '<label class="mm-f" data-role="dir">Direction <select data-k="dir"></select></label>' +
    '<button type="button" class="btn sm" data-act="add">Add</button>' +
    '<span data-role="extra"></span>' +
    '<button type="button" class="btn sm" data-act="connect">Connect</button>' +
    '<span class="mm-msg"></span><span class="grow"></span>' +
    '<button type="button" class="btn sm" data-act="code">Code</button>' +
    '<button type="button" class="btn sm danger" data-act="remove">Remove</button></div>' +
    '<div class="mm-canvas"></div><div class="mm-insp"></div>' +
    '<div class="mm-codewrap" hidden><textarea class="mm-code" spellcheck="false" aria-label="Mermaid source"></textarea>' +
    '<div class="mm-codebar"><button type="button" class="btn sm" data-act="apply">Apply code</button><span class="mm-note"></span></div></div>';
  const canvas = fig.querySelector('.mm-canvas');
  const insp = fig.querySelector('.mm-insp');
  const codeWrap = fig.querySelector('.mm-codewrap');
  const ta = fig.querySelector('.mm-code');
  const note = fig.querySelector('.mm-note');
  const msg = fig.querySelector('.mm-msg');
  const dirSel = fig.querySelector('[data-k="dir"]');
  const dirWrap = fig.querySelector('[data-role="dir"]');
  const extraWrap = fig.querySelector('[data-role="extra"]');
  const kindEl = fig.querySelector('.mm-kind');
  const addBtn = fig.querySelector('[data-act="add"]');
  const connectBtn = fig.querySelector('[data-act="connect"]');
  const codeBtn = fig.querySelector('[data-act="code"]');

  function K() { return S.kind ? KINDS[S.kind] : null; }
  function changed() { fig.dispatchEvent(new CustomEvent('mmchange', { bubbles: true })); }
  function commit() {
    S.src = K().serialize(S.model);
    fig.setAttribute('data-src', S.src);
    if (S.code) ta.value = S.src;
    changed();
  }
  function parseSrc() {
    const k = detectKind(S.src);
    const model = k ? KINDS[k].parse(S.src) : null;
    S.kind = model ? k : null;
    S.model = model;
    S.sel = null; S.from = null; S.mode = 'select'; S.note = '';
  }
  function renderBar() {
    const k = K();
    kindEl.textContent = k ? k.ui.label : (firstLine(S.src).split(/\s+/)[0] || 'Diagram');
    dirWrap.hidden = !(k && k.ui.dirs && k.ui.dirs.length);
    if (k && k.ui.dirs && k.ui.dirs.length) {
      dirSel.innerHTML = k.ui.dirs.map(function (d) { return opt(d[0], d[1], S.model.dir); }).join('');
    }
    addBtn.hidden = !k;
    connectBtn.hidden = !k;
    if (k) {
      addBtn.textContent = k.ui.addLabel;
      extraWrap.innerHTML = k.ui.extra.map(function (x) { return '<button type="button" class="btn sm" data-act="extra:' + x.act + '">' + esc(x.label) + '</button>'; }).join(' ');
    } else extraWrap.innerHTML = '';
  }
  function renderCanvas() {
    fig.classList.toggle('connecting', S.mode === 'connect');
    connectBtn.classList.toggle('on', S.mode === 'connect');
    msg.textContent = S.note || (S.mode === 'connect' ? (S.from ? 'Now click the target' : 'Click the source') : '');
    if (!S.model) {
      canvas.innerHTML = '<div class="mm-empty">This diagram type has no visual editor yet. Edit it as code below.</div>';
      return;
    }
    canvas.innerHTML = K().render(S.model, S, uid);
  }
  function renderInsp() {
    if (!S.model) { insp.innerHTML = ''; return; }
    if (!S.sel) { insp.innerHTML = '<span>Select an item to edit it. Drag from the dot on a selected item to connect it to another.</span>'; return; }
    insp.innerHTML = K().ui.inspector(S.model, S);
  }
  function renderCode() {
    const forced = !S.model;
    codeWrap.hidden = !(S.code || forced);
    codeBtn.classList.toggle('on', S.code);
    if (!codeWrap.hidden && document.activeElement !== ta) ta.value = S.src;
    note.textContent = forced ? 'Visual editing supports flowcharts, class diagrams and ER diagrams. This block stays as code.' : '';
  }
  function renderAll() { renderBar(); renderCanvas(); renderInsp(); renderCode(); }
  function after(didChange) {
    if (didChange) commit();
    renderAll();
  }

  function startDrag(ev) {
    ev.preventDefault(); ev.stopPropagation();
    const svg = canvas.querySelector('svg');
    const g = svg && svg.querySelector('g.layer');
    if (!g || !S.sel || S.sel.t !== 'n') return;
    const from = S.sel.id;
    const hp = ev.target;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('class', 'dragline');
    line.setAttribute('x1', hp.getAttribute('cx')); line.setAttribute('y1', hp.getAttribute('cy'));
    line.setAttribute('x2', hp.getAttribute('cx')); line.setAttribute('y2', hp.getAttribute('cy'));
    g.appendChild(line);
    function toLocal(e) {
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      return pt.matrixTransform(g.getScreenCTM().inverse());
    }
    function mv(e) { const p = toLocal(e); line.setAttribute('x2', p.x); line.setAttribute('y2', p.y); }
    function up(e) {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      line.remove();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const tn = el && el.closest ? el.closest('[data-node]') : null;
      if (tn && canvas.contains(tn)) {
        S.note = '';
        after(K().ui.connect(S.model, S, from, tn.getAttribute('data-node')));
      }
    }
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  }

  canvas.addEventListener('pointerdown', function (ev) {
    if (ev.target.closest && ev.target.closest('[data-handle]')) startDrag(ev);
  });
  canvas.addEventListener('click', function (ev) {
    if (!S.model) return;
    const nEl = ev.target.closest('[data-node]');
    const eEl = ev.target.closest('[data-edge]');
    const gEl = ev.target.closest('[data-group]');
    S.note = '';
    if (S.mode === 'connect') {
      if (!nEl) return;
      const id = nEl.getAttribute('data-node');
      if (!S.from) { S.from = id; renderCanvas(); return; }
      const from = S.from;
      S.from = null; S.mode = 'select';
      after(K().ui.connect(S.model, S, from, id));
      return;
    }
    if (nEl) S.sel = { t: 'n', id: nEl.getAttribute('data-node') };
    else if (eEl) S.sel = { t: 'e', k: Number(eEl.getAttribute('data-edge')) };
    else if (gEl) S.sel = { t: 'g', id: gEl.getAttribute('data-group') };
    else S.sel = null;
    renderCanvas(); renderInsp();
  });
  insp.addEventListener('input', function (ev) {
    if (!S.model || !S.sel || !ev.target.getAttribute('data-f')) return;
    S.note = '';
    const ok = K().ui.input(S.model, S, ev.target);
    if (ok) commit();
    renderCanvas();
  });
  insp.addEventListener('click', function (ev) {
    const b = ev.target.closest('[data-act]');
    if (!b || !S.model) return;
    S.note = '';
    after(K().ui.click(S.model, S, b.getAttribute('data-act'), b));
  });
  dirSel.addEventListener('change', function () {
    if (!S.model) return;
    S.model.dir = dirSel.value;
    commit(); renderCanvas();
  });
  fig.querySelector('.mm-bar').addEventListener('click', function (ev) {
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    const a = b.getAttribute('data-act');
    S.note = '';
    if (a === 'add' && S.model) {
      after(K().ui.add(S.model, S));
      const inp = insp.querySelector('input[type=text]');
      if (inp) { inp.focus(); inp.select(); }
    } else if (a === 'connect' && S.model) {
      S.mode = S.mode === 'connect' ? 'select' : 'connect'; S.from = null;
      renderCanvas();
    } else if (a.indexOf('extra:') === 0 && S.model) {
      after(K().ui.extraAct(S.model, S, a.slice(6)));
    } else if (a === 'code') {
      S.code = !S.code; renderCode();
      if (S.code) ta.value = S.src;
    } else if (a === 'remove') {
      ask('Remove this diagram from the document?', 'Remove', function () { fig.remove(); ensureParagraphs(); changed(); });
    }
  });
  codeWrap.addEventListener('click', function (ev) {
    if (!ev.target.closest('[data-act="apply"]')) return;
    S.src = ta.value;
    fig.setAttribute('data-src', S.src);
    parseSrc();
    renderAll(); changed();
  });
  ta.addEventListener('input', function () { S.src = ta.value; fig.setAttribute('data-src', S.src); changed(); });
  fig.addEventListener('keydown', function (ev) {
    if (ev.target.closest('input,select,textarea')) return;
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && S.sel && S.model) {
      ev.preventDefault();
      after(K().ui.remove(S.model, S));
    } else if (ev.key === 'Escape') {
      S.mode = 'select'; S.from = null; S.sel = null; S.note = '';
      renderAll();
    }
  });
  fig.addEventListener('click', function (ev) {
    if (!ev.target.closest('input,select,textarea,button')) fig.focus({ preventScroll: true });
  });

  parseSrc();
  renderAll();
}

function selectFig(fig) {
  document.querySelectorAll('figure.mm.sel').forEach(function (f) { if (f !== fig) f.classList.remove('sel'); });
  if (fig) fig.classList.add('sel');
}
document.addEventListener('mousedown', function (ev) {
  const fig = ev.target.closest ? ev.target.closest('figure.mm') : null;
  selectFig(fig);
});

