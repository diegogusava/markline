/* Table rows and columns: add, remove, delete the table.
   A markdown table has exactly one header row, so the header can't be removed and nothing goes above it. */
function tableCanDo(cell, op) {
  if (op === 'rowAbove' || op === 'delRow') return cell.parentElement !== cell.closest('table').rows[0];
  return true;
}
// Runs op on the table that holds cell; returns the cell for the caret, or null when the table is gone.
function tableOp(cell, op) {
  if (!tableCanDo(cell, op)) return cell;
  const d = cell.ownerDocument, table = cell.closest('table'), tr = cell.parentElement;
  const col = Array.prototype.indexOf.call(tr.children, cell);
  const blank = function (tag) { const c = d.createElement(tag); c.appendChild(d.createElement('br')); return c; };
  const body = function () {
    let b = table.querySelector('tbody');
    if (!b) { b = d.createElement('tbody'); table.appendChild(b); }
    return b;
  };
  const newRow = function () {
    const r = d.createElement('tr');
    for (let i = 0; i < tr.children.length; i++) r.appendChild(blank('td'));
    return r;
  };
  const at = function (row, i) { return row.children[Math.min(i, row.children.length - 1)]; };
  switch (op) {
    case 'rowAbove': { const r = newRow(); tr.before(r); return at(r, col); }
    case 'rowBelow': {
      const r = newRow();
      if (tr.parentElement.nodeName === 'THEAD') body().insertBefore(r, body().firstChild); else tr.after(r);
      return at(r, col);
    }
    case 'delRow': {
      const rows = Array.from(table.rows), i = rows.indexOf(tr);
      const next = rows[i + 1] || rows[i - 1];
      tr.remove();
      return next ? at(next, col) : null;
    }
    case 'colLeft': case 'colRight': {
      const i = col + (op === 'colRight' ? 1 : 0);
      let mine = null;
      Array.from(table.rows).forEach(function (r) {
        const c = blank(r.parentElement.nodeName === 'THEAD' ? 'th' : r.children[0] ? r.children[0].nodeName.toLowerCase() : 'td');
        r.insertBefore(c, r.children[i] || null);
        if (r === tr) mine = c;
      });
      return mine;
    }
    case 'delCol': {
      if (tr.children.length < 2) { table.remove(); return null; }
      Array.from(table.rows).forEach(function (r) { if (r.children[col]) r.children[col].remove(); });
      return at(tr, col);
    }
    case 'delTable': table.remove(); return null;
  }
  return cell;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { tableOp: tableOp, tableCanDo: tableCanDo };
