/* Raw HTML blocks (plus any markdown between an opening tag and its close tag) are kept verbatim:
   the editor shows them read-only and writes the original text back on save. */
const VOID_TAG = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
function tagDepth(html) {
  let d = 0, m;
  const re = /<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g;
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  while ((m = re.exec(html))) if (!m[3] && !VOID_TAG.test(m[2])) d += m[1] ? -1 : 1;
  return d;
}
function renderMarkdown(marked, md, opts) {
  opts = Object.assign({}, marked.defaults, opts);
  const tokens = marked.lexer(md, opts);
  let out = '', run = [], i = 0;
  function flush() { if (run.length) { run.links = tokens.links; out += marked.parser(run, opts); run = []; } }
  while (i < tokens.length) {
    if (tokens[i].type !== 'html') { run.push(tokens[i++]); continue; }
    flush();
    let raw = '', depth = 0;
    do { raw += tokens[i].raw; depth = Math.max(0, depth + tagDepth(tokens[i].raw)); i++; } while (depth > 0 && i < tokens.length);
    raw = raw.replace(/\s+$/, '');
    const attr = raw.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    out += '<div class="raw" contenteditable="false" data-src="' + attr + '">' + marked.parse(raw, opts) + '</div>\n';
  }
  flush();
  return out;
}

function createMarkdownConverter(TurndownService, gfm) {
  const isRaw = function (n) { return n.nodeName === 'DIV' && n.classList && n.classList.contains('raw'); };
  const rawOut = function (n) { return '\n\n' + n.getAttribute('data-src') + '\n\n'; };
  const td = new TurndownService({ headingStyle: 'atx', hr: '---', bulletListMarker: '-', codeBlockStyle: 'fenced', fence: '```', emDelimiter: '*', strongDelimiter: '**', linkStyle: 'inlined',
    blankReplacement: function (c, n) { return isRaw(n) ? rawOut(n) : n.isBlock ? '\n\n' : ''; } });
  td.addRule('rawHtml', { filter: isRaw, replacement: function (c, n) { return rawOut(n); } });
  td.addRule('tightListItem', {
    filter: 'li',
    replacement: function (content, node, options) {
      content = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n    ');
      let prefix = options.bulletListMarker + ' ';
      const parent = node.parentNode;
      if (parent.nodeName === 'OL') {
        const start = parent.getAttribute('start');
        const i = Array.prototype.indexOf.call(parent.children, node);
        prefix = (start ? Number(start) + i : i + 1) + '. ';
      }
      return prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '');
    }
  });
  if (gfm) td.use(gfm);
  td.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: function (content, node) {
      // GFM cells must stay on one source line, including undo snapshots.
      const text = content.trim().replace(/\|/g, '\\|').replace(/[ \t]*\r?\n[ \t]*/g, '<br>');
      return (node.previousElementSibling ? ' ' : '| ') + text + ' |';
    }
  });
  td.addRule('mermaidBlock', {
    filter: function (n) { return n.nodeName === 'FIGURE' && n.classList && n.classList.contains('mm'); },
    replacement: function (c, n) { return '\n\n```mermaid\n' + (n.getAttribute('data-src') || '').replace(/\n+$/, '') + '\n```\n\n'; }
  });
  return td;
}

if (typeof module !== 'undefined' && module.exports) { module.exports = createMarkdownConverter; module.exports.renderMarkdown = renderMarkdown; }
