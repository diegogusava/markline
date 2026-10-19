/* Tab and Shift+Tab on plain text, as text editors do: a caret or a selection inside one line gets a tab;
   a selection over several lines indents each line; Shift+Tab takes one tab (or up to four spaces) off each line. */
function indentText(text, start, end, outdent) {
  if (!outdent && text.slice(start, end).indexOf('\n') < 0) {
    return { text: text.slice(0, start) + '\t' + text.slice(end), start: start + 1, end: start + 1 };
  }
  const from = text.lastIndexOf('\n', start - 1) + 1;
  // a selection that ends at the start of a line leaves that line alone
  let last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const nl = text.indexOf('\n', last);
  last = nl < 0 ? text.length : nl;
  const edits = [];
  let out = text.slice(0, from), pos = from;
  text.slice(from, last).split('\n').forEach(function (line, i) {
    if (i) { out += '\n'; pos++; }
    const cut = outdent ? (line[0] === '\t' ? 1 : /^ {0,4}/.exec(line)[0].length) : 0;
    edits.push({ at: pos, add: outdent ? 0 : 1, cut: cut });
    out += (outdent ? '' : '\t') + line.slice(cut);
    pos += line.length;
  });
  out += text.slice(last);
  // where an offset of the old text lands in the new one
  function map(x) {
    let d = 0;
    edits.forEach(function (ed) {
      if (ed.add && x > ed.at) d += ed.add;
      if (ed.cut && x > ed.at) d -= Math.min(ed.cut, x - ed.at);
    });
    return x + d;
  }
  const s = map(start);
  return { text: out, start: s, end: start === end ? s : map(end) };
}

if (typeof module !== 'undefined' && module.exports) module.exports = indentText;
