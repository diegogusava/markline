// Literal, case-insensitive search. Keep offsets in the original text, including Unicode.
function findMatches(text, query) {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const matches = [];
  let m;
  while ((m = pattern.exec(text))) matches.push({ start: m.index, end: m.index + m[0].length });
  return matches;
}
function replaceMatches(text, matches, replacement) {
  let end = 0, result = '';
  matches.forEach(function (m) {
    result += text.slice(end, m.start) + replacement;
    end = m.end;
  });
  return result + text.slice(end);
}
if (typeof module !== 'undefined') module.exports = { findMatches, replaceMatches };

if (typeof document !== 'undefined') (function () {
  const bar = $('#findbar'), input = $('#findQuery'), status = $('#findStatus');
  const prev = $('#findPrev'), next = $('#findNext');
  const replaceRow = $('#replaceRow'), replacement = $('#replaceText');
  const replaceOne = $('#replaceOne'), replaceAll = $('#replaceAll');
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
    replaceOne.disabled = replaceAll.disabled = mode !== 'source' || !matches.length;
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
  function open(replacing) {
    let selected = '';
    if (mode === 'source' && document.activeElement === srcEl) selected = srcEl.value.slice(srcEl.selectionStart, srcEl.selectionEnd);
    else {
      const sel = window.getSelection();
      if (sel.rangeCount && doc.contains(sel.anchorNode) && doc.contains(sel.focusNode)) selected = sel.toString();
    }
    if (selected && !selected.includes('\n')) input.value = selected;
    const showReplace = replacing === true;
    if (showReplace && mode !== 'source') {
      // Keep the original source on an untouched rendered page, including its spacing.
      const md = gutterMarkdown(), wasClean = !dirty;
      setMode('source'); srcEl.value = md; numbers(); histPush();
      if (wasClean) cleanMd = md;
    }
    replaceRow.hidden = !showReplace;
    $('#findReplace').setAttribute('aria-expanded', String(showReplace));
    $('#findReplace').classList.toggle('on', showReplace);
    bar.hidden = false; $('#bFind').setAttribute('aria-expanded', 'true');
    active = -1; cache = ''; update(true, 0, true);
    input.focus(); input.select();
    clearInterval(timer); timer = setInterval(function () { update(false); }, 300);
  }
  function replace(all) {
    if (mode !== 'source') return;
    update(false);
    if (active < 0) return;
    const chosen = all ? matches.slice() : [matches[active]];
    const value = srcEl.value, pos = chosen[0].start + replacement.value.length;
    const result = replaceMatches(value, chosen, replacement.value);
    if (result === value) { update(true, 1); return; }
    histPush();
    pendingBeforeCaret = { srcStart: chosen[0].start, srcEnd: chosen[0].end };
    srcEl.value = result;
    srcEl.setSelectionRange(pos, pos);
    srcEl.dispatchEvent(new Event('input', { bubbles: true }));
    histPush();
    // Skip the newly inserted text, even when it contains the search query.
    cache = ''; active = -1; update(false, 0, true);
    if (matches.length) {
      const i = matches.findIndex(function (m) { return m.start >= pos; });
      active = i < 0 ? 0 : i;
    }
    update(true);
    toast('Replaced ' + chosen.length + (chosen.length === 1 ? ' match.' : ' matches.'));
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
  $('#findReplace').addEventListener('click', function () {
    if (replaceRow.hidden) open(true);
    else { replaceRow.hidden = true; $('#findReplace').setAttribute('aria-expanded', 'false'); $('#findReplace').classList.remove('on'); input.focus(); }
  });
  replaceOne.addEventListener('click', function () { replace(false); });
  replaceAll.addEventListener('click', function () { replace(true); });
  $('#findClose').addEventListener('click', close);
  input.addEventListener('input', function () { active = -1; cache = ''; update(true); });
  prev.addEventListener('click', function () { update(true, -1); });
  next.addEventListener('click', function () { update(true, 1); });
  new MutationObserver(function () { if (!bar.hidden) update(false, 0, true); }).observe(doc, { subtree: true, childList: true, characterData: true });
  const previousLoaded = window.onDocLoaded;
  window.onDocLoaded = function () {
    if (previousLoaded) previousLoaded();
    if (!bar.hidden) open(!replaceRow.hidden);
  };
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'h') {
      e.preventDefault(); open(true);
    } else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault(); open();
    } else if (!bar.hidden && e.key === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation(); close();
    } else if (!bar.hidden && e.target === replacement && e.key === 'Enter') {
      e.preventDefault(); replace(e.ctrlKey || e.metaKey);
    } else if (!bar.hidden && (e.key === 'F3' || (e.target === input && e.key === 'Enter'))) {
      e.preventDefault(); update(true, e.shiftKey ? -1 : 1);
    }
  }, true);
})();
