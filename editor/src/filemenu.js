// Menus share the toolbar actions, including history and the unsaved-change guard.
(function () {
  const menus = Array.from(document.querySelectorAll('.app-menu'));
  $('#menuOpenFolder').hidden = !TAURI;
  menus.forEach(function (menu) {
    const summary = menu.querySelector('summary'), buttons = Array.from(menu.querySelectorAll('button'));
    summary.addEventListener('click', function () {
      menus.forEach(function (other) { if (other !== menu) other.open = false; });
    });
    menu.addEventListener('click', function (e) {
      const button = e.target.closest('[data-file-action], [data-edit-action]');
      if (!button) return;
      menu.open = false;
      summary.focus();
      const action = button.dataset.fileAction;
      if (action === 'new') $('#bNew').click();
      else if (action === 'open') $('#bOpen').click();
      else if (action === 'folder' && window.openFolder) window.openFolder();
      else if (action === 'save') doSave();
      else if (action === 'saveAs') doSave(true);
      const edit = button.dataset.editAction;
      if (edit === 'undo') $('#bUndo').click();
      else if (edit === 'redo') $('#bRedo').click();
      else if (edit === 'history') $('#bHist').click();
      else if (edit === 'find' || edit === 'replace') {
        $('#bFind').click();
        if (edit === 'replace') $('#findReplace').click();
      }
    });
    menu.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); menu.open = false; summary.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault(); menu.open = true;
        const items = buttons.filter(function (button) { return !button.hidden && !button.disabled; });
        const i = items.indexOf(document.activeElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : i < 0 ? (e.key === 'ArrowUp' ? items.length - 1 : 0) : (i + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
        items[next].focus();
      }
    });
    document.addEventListener('click', function (e) { if (!menu.contains(e.target)) menu.open = false; });
    document.addEventListener('focusin', function (e) { if (!menu.contains(e.target)) menu.open = false; });
  });
})();
