function createMarkdownConverter(TurndownService, gfm) {
  const td = new TurndownService({ headingStyle: 'atx', hr: '---', bulletListMarker: '-', codeBlockStyle: 'fenced', fence: '```', emDelimiter: '*', strongDelimiter: '**', linkStyle: 'inlined' });
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

if (typeof module !== 'undefined' && module.exports) module.exports = createMarkdownConverter;
