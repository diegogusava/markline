// Literal, case-insensitive search. Keep offsets in the original text, including Unicode.
function findMatches(text, query) {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const matches = [];
  let m;
  while ((m = pattern.exec(text))) matches.push({ start: m.index, end: m.index + m[0].length });
  return matches;
}
if (typeof module !== 'undefined') module.exports = { findMatches };

if (typeof document !== 'undefined') (function () {
  const bar = $('#findbar'), input = $('#findQuery'), status = $('#findStatus');
  const prev = $('#findPrev'), next = $('#findNext');
  let matches = [], ranges = [], active = -1, cache = '', timer = null;
  const sourceLayer = document.createElement('div'), sourceMirror = document.createElement('div');
  sourceLayer.id = 'findSource'; sourceLayer.hidden = true; sourceLayer.setAttribute('aria-hidden', 'true');
  sourceLayer.appendChild(sourceMirror); $('#srcwrap').insertBefore(sourceLayer, srcEl);
  let sourceKey = '', sourceMarks = [];
  function paintSource() {
    sourceLayer.hidden = bar.hidden || mode !== 'source' || !matches.length;
    if (sourceLayer.hidden) return;
    const cs = getComputedStyle(srcEl);
    ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'textAlign', 'textIndent'].forEach(function (k) { sourceMirror.style[k] = cs[k]; });
    sourceLayer.style.left = srcEl.offsetLeft + 'px'; sourceLayer.style.top = srcEl.offsetTop + 'px';
    sourceLayer.style.width = srcEl.clientWidth + 'px'; sourceLayer.style.height = srcEl.clientHeight + 'px';
    sourceMirror.style.transform = 'translate(' + -srcEl.scrollLeft + 'px,' + -srcEl.scrollTop + 'px)';
    if (sourceKey !== cache) {
      sourceKey = cache; sourceMirror.textContent = ''; sourceMarks = [];
      let end = 0;
      matches.forEach(function (m) {
        sourceMirror.appendChild(document.createTextNode(srcEl.value.slice(end, m.start)));
        const mark = document.createElement('mark'); mark.textContent = srcEl.value.slice(m.start, m.end);
        sourceMirror.appendChild(mark); sourceMarks.push(mark); end = m.end;
      });
      sourceMirror.appendChild(document.createTextNode(srcEl.value.slice(end) + '\u200b'));
    }
    sourceMarks.forEach(function (mark, i) { mark.classList.toggle('active', i === active); });
  }
  srcEl.addEventListener('scroll', paintSource);
  window.addEventListener('resize', paintSource);
  const highlights = window.CSS && CSS.highlights && typeof Highlight !== 'undefined';
  function clearHighlights() {
    if (highlights) { CSS.highlights.delete('find-match'); CSS.highlights.delete('find-active'); }
  }
  function renderedText() {
    let text = '';
    const nodes = [];
    function visit(node) {
      if (node.nodeType === 3) {
        nodes.push({ node: node, start: text.length, end: text.length + node.data.length });
        text += node.data;
      } else if (node.nodeType === 1) {
        if (node.hidden || node.matches('button, input, textarea, select, svg, script, style, .mm-insp, .mm-tools')) return;
        const block = /^(P|DIV|H[1-6]|LI|PRE|BLOCKQUOTE|TR|TD|TH|FIGURE|BR)$/.test(node.tagName);
        if (block && text && !text.endsWith('\n')) text += '\n';
        node.childNodes.forEach(visit);
        if (block && !text.endsWith('\n')) text += '\n';
      }
    }
    visit(doc);
    return { text: text, nodes: nodes };
  }
  function update(scroll, step, force) {
    if (bar.hidden) return;
    const rendered = mode === 'rendered' ? renderedText() : null;
    const text = rendered ? rendered.text : srcEl.value;
    const key = mode + '\0' + input.value + '\0' + text;
    if (force || key !== cache) {
      const old = matches[active];
      cache = key;
      matches = findMatches(text, input.value);
      active = matches.length ? Math.max(0, matches.findIndex(function (m) { return old && m.start >= old.start; })) : -1;
      ranges = rendered ? matches.map(function (m) {
        const a = rendered.nodes.find(function (n) { return n.end > m.start; });
        const b = rendered.nodes.find(function (n) { return n.end >= m.end; });
        const r = document.createRange();
        r.setStart(a.node, m.start - a.start); r.setEnd(b.node, m.end - b.start);
        return r;
      }) : [];
      clearHighlights();
      if (highlights && ranges.length) {
        const all = new Highlight(); ranges.forEach(function (r) { all.add(r); });
        CSS.highlights.set('find-match', all);
      }
    }
    if (step && matches.length) active = (active + step + matches.length) % matches.length;
    status.textContent = !input.value ? 'Type to search' : matches.length ? (active + 1) + ' of ' + matches.length : 'No matches';
    prev.disabled = next.disabled = !matches.length;
    input.setAttribute('aria-invalid', String(!!input.value && !matches.length));
    paintSource();
    if (active < 0) return;
    if (mode === 'source') {
      if (scroll) {
        srcEl.setSelectionRange(matches[active].start, matches[active].end);
        scrollSrcTo(matches[active].start, null);
      }
    } else {
      const range = ranges[active];
      if (highlights) CSS.highlights.set('find-active', new Highlight(range));
      else if (scroll) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
      if (scroll) {
        const rect = range.getBoundingClientRect(), sc = $('#scroll'), box = sc.getBoundingClientRect();
        sc.scrollTop += rect.top - box.top - box.height / 3;
      }
    }
  }
  function open() {
    let selected = '';
    if (mode === 'source' && document.activeElement === srcEl) selected = srcEl.value.slice(srcEl.selectionStart, srcEl.selectionEnd);
    else {
      const sel = window.getSelection();
      if (sel.rangeCount && doc.contains(sel.anchorNode) && doc.contains(sel.focusNode)) selected = sel.toString();
    }
    if (selected && !selected.includes('\n')) input.value = selected;
    bar.hidden = false; $('#bFind').setAttribute('aria-expanded', 'true');
    active = -1; cache = ''; update(true, 0, true);
    input.focus(); input.select();
    clearInterval(timer); timer = setInterval(function () { update(false); }, 300);
  }
  function close() {
    bar.hidden = true; $('#bFind').setAttribute('aria-expanded', 'false');
    clearInterval(timer); clearHighlights(); sourceLayer.hidden = true;
    if (mode === 'source') srcEl.focus({ preventScroll: true });
    else {
      doc.focus({ preventScroll: true });
      if (ranges[active]) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(ranges[active]); }
    }
  }
  $('#bFind').addEventListener('click', open);
  $('#findClose').addEventListener('click', close);
  input.addEventListener('input', function () { active = -1; cache = ''; update(true); });
  prev.addEventListener('click', function () { update(true, -1); });
  next.addEventListener('click', function () { update(true, 1); });
  new MutationObserver(function () { if (!bar.hidden) update(false, 0, true); }).observe(doc, { subtree: true, childList: true, characterData: true });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault(); open();
    } else if (!bar.hidden && e.key === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation(); close();
    } else if (!bar.hidden && (e.key === 'F3' || (bar.contains(e.target) && e.key === 'Enter'))) {
      e.preventDefault(); update(true, e.shiftKey ? -1 : 1);
    }
  }, true);
})();
