/* ---------- notes ----------
   Free-form notes for the open file, shown in a side panel on the right.
   They live in a sidecar file NAME.md.notes.md (localStorage when there is no file path) and save as you type. */
(function () {
const panel = $('#npanel'), ta = $('#nText'), state = $('#nState'), OPEN_KEY = 'markline-notes-open-v1';
let target = null, lastText = null, timer = null, unsaved = false, chain = Promise.resolve(), loadTok = 0;

function targetNow() {
  const p = fileHandle && fileHandle.native;
  return p ? { path: p + '.notes.md', ls: null } : { path: null, ls: 'markline-notes-v1:' + name };
}
function sameTarget(a, b) { return !!a && !!b && a.path === b.path && a.ls === b.ls; }
function useFile(t) { return !!(TAURI && t && t.path); }

async function readFrom(t) {
  if (useFile(t)) return TAURI.invoke('read_optional', { path: t.path });
  try { return localStorage.getItem(t.ls); } catch (e) { return null; }
}
function writeTo(t, text) {
  chain = chain.then(async function () {
    try {
      if (useFile(t)) {
        if (text) await TAURI.invoke('save_file', { path: t.path, suggested: '', text: text });
        else await TAURI.invoke('delete_notes', { path: t.path });
      } else {
        try { if (text) localStorage.setItem(t.ls, text); else localStorage.removeItem(t.ls); } catch (e) { /* storage unavailable */ }
      }
      if (sameTarget(t, target)) { lastText = text; setState('Saved'); }
    } catch (e) { setState('Not saved'); toast('Could not save notes: ' + (e && e.message || e)); }
  });
  return chain;
}

function setState(s) { state.textContent = s; }
function updateDot() {
  const has = !!ta.value.trim();
  $('#bNotesDot').hidden = !has;
  $('#bNotes').title = has ? 'Notes for this file (Ctrl+Alt+N)' : 'Add notes for this file (Ctrl+Alt+N)';
}
function updateWhere() {
  const t = target;
  $('#nWhere').textContent = useFile(t)
    ? 'Saved as ' + t.path.split(/[\\/]/).pop() + ' next to the file.'
    : 'Kept in this browser until the file is saved to disk.';
}

/* write now whatever is still waiting for the debounce */
function flush() {
  clearTimeout(timer); timer = null;
  if (!unsaved) return chain;
  unsaved = false;
  const text = ta.value.trim() ? ta.value : '';
  if (text === (lastText || '')) { setState('Saved'); return chain; }
  return writeTo(target, text);
}
ta.addEventListener('input', function () {
  setState('Editing…');
  updateDot();
  unsaved = true;
  clearTimeout(timer);
  timer = setTimeout(flush, 700);
});
ta.addEventListener('blur', flush);
window.addEventListener('beforeunload', flush);

async function load(quiet) {
  const tok = ++loadTok, t = target;
  let text = null;
  await chain;
  try { text = await readFrom(t); } catch (e) { text = null; }
  if (tok !== loadTok || !sameTarget(t, target)) return;
  if (quiet && (text === lastText || unsaved || document.activeElement === ta)) return;
  lastText = text;
  ta.value = text || '';
  setState(text ? 'Saved' : '');
  updateDot();
  if (quiet) toast('Notes updated from disk.');
}

/* the open file changed: finish writing the old notes, then show the new ones */
const prevLoaded = window.onDocLoaded;
window.onDocLoaded = function () {
  if (prevLoaded) prevLoaded();
  const old = target, pending = unsaved ? (ta.value.trim() ? ta.value : '') : null;
  clearTimeout(timer); timer = null; unsaved = false;
  if (old && pending !== null && pending !== (lastText || '')) writeTo(old, pending);
  target = targetNow(); lastText = null;
  ta.value = ''; setState(''); updateDot(); updateWhere();
  load(false);
};
/* save-as gives an untitled file a path: move its notes along */
const prevSaved = window.onDocSaved;
window.onDocSaved = function () {
  if (prevSaved) prevSaved();
  const t = targetNow();
  if (sameTarget(t, target)) return;
  const old = target, text = ta.value.trim() ? ta.value : '';
  clearTimeout(timer); timer = null; unsaved = false;
  target = t; lastText = null; updateWhere();
  if (text) { writeTo(t, text); if (old && !useFile(old)) writeTo(old, ''); }
  else load(false);
};
window.addEventListener('focus', function () { if (useFile(target)) load(true); });

/* ---------- panel ---------- */
function narrow() { return window.matchMedia && matchMedia('(max-width: 700px)').matches; }
function showPanel(on, focus) {
  panel.hidden = !on;
  $('#bNotes').classList.toggle('on', on);
  $('#bNotes').setAttribute('aria-pressed', String(on));
  try { localStorage.setItem(OPEN_KEY, on ? '1' : ''); } catch (e) { /* ignore */ }
  if (on) {
    if (narrow() && !$('#cpanel').hidden) $('#cClose').click();
    if (focus) ta.focus();
  } else flush();
}
$('#bNotes').addEventListener('click', function () { showPanel(panel.hidden, true); });
$('#nClose').addEventListener('click', function () { showPanel(false); });
/* on a phone the two right-hand panels overlap: opening Comments hides Notes */
$('#bCom').addEventListener('click', function () { if (narrow() && !panel.hidden) showPanel(false); });
document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); showPanel(panel.hidden, true); }
  else if (e.key === 'Escape' && document.activeElement === ta) { e.preventDefault(); flush(); ta.blur(); }
});

/* ---------- width: drag the left edge, arrow keys on it, double-click to reset ---------- */
const grip = $('#nGrip'), WIDTH_KEY = 'markline-notes-width-v1', MIN_W = 240;
let cur = null;
function maxW() { return Math.max(MIN_W, Math.min(900, window.innerWidth * 0.7)); }
function setWidth(w, save) {
  cur = w == null ? null : Math.round(Math.min(maxW(), Math.max(MIN_W, w)));
  if (cur == null) panel.style.removeProperty('--nw'); else panel.style.setProperty('--nw', cur + 'px');
  if (save) saved = cur;
  if (save) try { if (cur == null) localStorage.removeItem(WIDTH_KEY); else localStorage.setItem(WIDTH_KEY, String(cur)); } catch (e) { /* ignore */ }
}
// the panel is zoomed with the UI, so screen pixels are divided by the zoom to get CSS pixels
function uiZoom() { return panel.getBoundingClientRect().width / (panel.offsetWidth || 1) || 1; }
grip.addEventListener('pointerdown', function (e) {
  if (e.button !== 0) return;
  e.preventDefault();
  grip.setPointerCapture(e.pointerId);
  grip.classList.add('drag'); document.body.classList.add('resizing');
  const right = panel.getBoundingClientRect().right, z = uiZoom();
  function move(ev) { setWidth((right - ev.clientX) / z, false); }
  function up() {
    grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
    grip.classList.remove('drag'); document.body.classList.remove('resizing');
    setWidth(panel.offsetWidth, true);
  }
  grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
});
grip.addEventListener('dblclick', function () { setWidth(null, true); });
grip.addEventListener('keydown', function (e) {
  const step = e.shiftKey ? 60 : 20;
  if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(panel.offsetWidth + step, true); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(panel.offsetWidth - step, true); }
});
// a smaller window narrows the panel to fit; the saved width comes back when there is room again
let saved = null;
window.addEventListener('resize', function () { if (saved != null) setWidth(saved, false); });
try { const w = parseInt(localStorage.getItem(WIDTH_KEY), 10); if (w) { saved = w; setWidth(w, false); } } catch (e) { /* ignore */ }

target = targetNow(); updateWhere(); load(false);
try { if (localStorage.getItem(OPEN_KEY) && !narrow()) showPanel(true, false); } catch (e) { /* ignore */ }
window.__marklineNotes = { get: function () { return ta.value; }, target: function () { return target; }, flush: flush };
})();
