// Assembles the single-file editor from editor/src and prepares dist/ with local (offline) vendor libs.
const fs = require('fs');
const here = __dirname + '/';
const src = here + 'editor/src/';
const rd = f => fs.readFileSync(src + f, 'utf8');
const js = ['common.js', 'flow.js', 'er.js', 'cls.js', 'blocks.js', 'markdown.js', 'table.js', 'indent.js', 'rest.js', 'anchor.js', 'comments.js', 'notes.js', 'readability.js', 'readpanel.js', 'share.js'].map(rd).join('\n');
let h = rd('head.html') + "<script>\n(function () {\n'use strict';\n" + js + "\n})();\n</script>\n</body>\n</html>\n";
const map = {
  'https://cdn.jsdelivr.net/npm/marked@4.3.0/marked.min.js': ['marked/marked.min.js', 'vendor/marked.min.js'],
  'https://cdn.jsdelivr.net/npm/turndown@7.1.2/dist/turndown.js': ['turndown/lib/turndown.browser.umd.js', 'vendor/turndown.js'],
  'https://cdn.jsdelivr.net/npm/turndown-plugin-gfm@1.0.2/dist/turndown-plugin-gfm.js': ['turndown-plugin-gfm/dist/turndown-plugin-gfm.js', 'vendor/turndown-plugin-gfm.js']
};
fs.mkdirSync(here + 'dist/vendor', { recursive: true });
for (const u in map) {
  if (!h.includes(u)) throw new Error('missing ' + u);
  fs.copyFileSync(here + 'node_modules/' + map[u][0], here + 'dist/' + map[u][1]);
  h = h.replace(u, map[u][1]);
}
h = h.replace(/<link[^>]*fonts\.(googleapis|gstatic)[^>]*>\s*/g, '');
fs.writeFileSync(here + 'dist/index.html', h);
console.log('dist ready', h.length);
