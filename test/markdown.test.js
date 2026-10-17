const { test } = require('node:test');
const assert = require('node:assert/strict');
const domino = require('domino');
const marked = require('marked');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');
const createMarkdownConverter = require('../editor/src/markdown');

const convert = html => createMarkdownConverter(TurndownService, gfm).turndown(html);
const render = md => marked.parse(md, { mangle: false, headerIds: false });
const document = html => domino.createWindow(html).document;
const cells = html => Array.from(document(html).querySelectorAll('tr'), row =>
  Array.from(row.querySelectorAll('th,td'), cell => cell.innerHTML));
const curriculum = '| # | Verb | Status | Prompt | Dutch | English |\n' +
  '| --- | --- | --- | --- | --- | --- |\n' +
  '| 1 | **zijn** | Rewritten | **Hoe gaat het?**<br>*How are you?* | Goed. | Fine. |\n' +
  '| 2 | **wonen** | Kept | **Waar woon je?**<br>*Where do you live?* | In [Utrecht]. | In [Utrecht]. |\n';

test('keeps NL and EN prompts in the same cell when saving', () => {
  const html = render(curriculum);
  assert.deepEqual(cells(render(convert(html))), cells(html));
});

test('repeated undo snapshots retain the table structure and text', () => {
  let md = curriculum;
  const expected = cells(render(md));
  for (let step = 0; step < 10; step++) {
    md = convert(render(md));
    assert.deepEqual(cells(render(md)), expected, `snapshot ${step + 1}`);
  }
});

test('cell paragraphs stay inside the cell', () => {
  const html = '<table><thead><tr><th>Prompt</th><th>Answer</th></tr></thead>' +
    '<tbody><tr><td><p>Dutch</p><p>English</p></td><td>Answer</td></tr></tbody></table>';
  const out = document(render(convert(html)));
  assert.equal(out.querySelectorAll('tbody tr').length, 1);
  const row = out.querySelector('tbody tr');
  assert.equal(row.children.length, 2);
  assert.equal(row.children[0].textContent, 'DutchEnglish');
  assert.ok(row.children[0].querySelector('br'));
  assert.equal(row.children[1].textContent, 'Answer');
});

test('literal pipes and inline code do not create extra columns', () => {
  const html = '<table><thead><tr><th>Text</th><th>Code</th></tr></thead>' +
    '<tbody><tr><td>left | right</td><td><code>a|b</code></td></tr></tbody></table>';
  assert.deepEqual(cells(render(convert(html))), cells(html));
});

test('preserves consecutive breaks and empty cells', () => {
  const html = '<table><thead><tr><th>Prompt</th><th>Answer</th></tr></thead>' +
    '<tbody><tr><td>Dutch<br><br>English</td><td></td></tr></tbody></table>';
  assert.deepEqual(cells(render(convert(html))), cells(html));
});

test('normal paragraph hard breaks keep their Markdown representation', () => {
  const md = convert('<p>Before<br>After</p>');
  assert.match(md, /Before {2}\nAfter/);
  assert.equal(document(render(md)).querySelectorAll('p br').length, 1);
});

test('keeps existing list and Mermaid conversion', () => {
  const html = '<ol start="3"><li>Three</li><li>Four</li></ol>' +
    '<figure class="mm" data-src="flowchart LR\nA--&gt;B"><span>Diagram</span></figure>';
  const md = convert(html);
  assert.match(md, /3\. Three\n4\. Four/);
  assert.ok(md.includes('```mermaid\nflowchart LR\nA-->B\n```'));
});
