const { test } = require('node:test');
const assert = require('node:assert/strict');
const domino = require('domino');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');
const createMarkdownConverter = require('../editor/src/markdown');
const { tableOp, tableCanDo } = require('../editor/src/table');

const html = '<table><thead><tr><th>A</th><th>B</th></tr></thead>' +
  '<tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table>';
const setup = () => {
  const doc = domino.createWindow('<div id="d">' + html + '</div>').document;
  return { doc, cell: (r, c) => doc.querySelectorAll('tr')[r].querySelectorAll('th,td')[c] };
};
const md = doc => createMarkdownConverter(TurndownService, gfm).turndown(doc.getElementById('d').innerHTML);
const grid = doc => Array.from(doc.querySelectorAll('tr'), r => Array.from(r.querySelectorAll('th,td'), c => c.nodeName + ':' + c.textContent));

test('inserts a row above and below a body row', () => {
  const { doc, cell } = setup();
  const above = tableOp(cell(1, 1), 'rowAbove');
  assert.ok(above === cell(1, 1));
  tableOp(cell(2, 0), 'rowBelow');
  assert.deepEqual(grid(doc), [['TH:A', 'TH:B'], ['TD:', 'TD:'], ['TD:1', 'TD:2'], ['TD:', 'TD:'], ['TD:3', 'TD:4']]);
});

test('a row below the header goes to the top of the body', () => {
  const { doc, cell } = setup();
  const c = tableOp(cell(0, 1), 'rowBelow');
  assert.ok(c === cell(1, 1));
  assert.equal(c.nodeName, 'TD');
  assert.equal(c.parentElement.parentElement.nodeName, 'TBODY');
});

test('the header row cannot be removed or have rows above it', () => {
  const { doc, cell } = setup();
  assert.equal(tableCanDo(cell(0, 0), 'rowAbove'), false);
  assert.equal(tableCanDo(cell(0, 0), 'delRow'), false);
  tableOp(cell(0, 0), 'delRow');
  assert.equal(doc.querySelector('table').rows.length, 3);
});

test('deletes a row and moves to the next one', () => {
  const { doc, cell } = setup();
  const c = tableOp(cell(1, 1), 'delRow');
  assert.equal(c.textContent, '4');
  assert.equal(tableOp(c, 'delRow').textContent, 'B');
  assert.equal(md(doc), '| A | B |\n| --- | --- |');
});

test('inserts columns with a header cell in every row', () => {
  const { doc, cell } = setup();
  const c = tableOp(cell(1, 0), 'colRight');
  assert.ok(c === cell(1, 1));
  tableOp(cell(2, 0), 'colLeft');
  assert.deepEqual(grid(doc), [['TH:', 'TH:A', 'TH:', 'TH:B'], ['TD:', 'TD:1', 'TD:', 'TD:2'], ['TD:', 'TD:3', 'TD:', 'TD:4']]);
  assert.equal(md(doc), '|  | A |  | B |\n| --- | --- | --- | --- |\n|  | 1 |  | 2 |\n|  | 3 |  | 4 |');
});

test('deletes a column, and the table with its last column', () => {
  const { doc, cell } = setup();
  const c = tableOp(cell(2, 1), 'delCol');
  assert.equal(c.textContent, '3');
  assert.equal(md(doc), '| A |\n| --- |\n| 1 |\n| 3 |');
  assert.equal(tableOp(c, 'delCol'), null);
  assert.ok(!doc.querySelector('table'));
});

test('deletes the whole table', () => {
  const { doc, cell } = setup();
  assert.equal(tableOp(cell(1, 0), 'delTable'), null);
  assert.ok(!doc.querySelector('table'));
});
