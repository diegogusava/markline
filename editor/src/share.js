/* ---------- share in a browser (desktop app only): runs the built-in web server ---------- */
(function () {
if (!(window.__TAURI__ && window.__TAURI__.core) || window.__MARKLINE_WEB__) return;
const T = window.__TAURI__.core;
const box = $('#sharebox'), btn = $('#bShare'), SK = 'markline-share-v1';
function load() { try { return JSON.parse(localStorage.getItem(SK) || '{}'); } catch (e) { return {}; } }
function save(o) { try { localStorage.setItem(SK, JSON.stringify(Object.assign(load(), o))); } catch (e) { /* ignore */ } }
const cfg = load();
let info = { running: false };
btn.hidden = false;
$('#shPort').value = cfg.port || 8080;
$('#shLan').checked = cfg.lan !== false;
$('#shAuto').checked = !!cfg.auto;
function rootDir() { return window.marklineRoot ? window.marklineRoot() : null; }
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function render() {
  const r = info.running ? info.root : rootDir();
  $('#shFolder').textContent = r ? 'Shared folder: ' + r : 'No folder yet: open one with Files > Open..., then start sharing.';
  $('#shGo').textContent = info.running ? 'Stop sharing' : 'Start sharing';
  $('#shGo').classList.toggle('primary', !info.running);
  btn.classList.toggle('on', !!info.running);
  btn.textContent = info.running ? 'Sharing' : 'Share';
  $('#shPort').disabled = $('#shLan').disabled = !!info.running;
  const u = $('#shUrls'); u.textContent = '';
  (info.running ? info.urls : []).forEach(function (url, i) {
    const row = mk('div', 'shurl');
    row.appendChild(mk('div', 'cnote', i === 0 ? 'On this computer' : 'On your phone / other devices'));
    row.appendChild(mk('code', '', url));
    const b = mk('button', 'btn sm', 'Copy'); b.type = 'button';
    b.addEventListener('click', function () { (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { toast('Link copied.'); }, function () { toast('Select the link and copy it.'); }); });
    row.appendChild(b);
    u.appendChild(row);
  });
  if (info.running && !info.lan) u.appendChild(mk('div', 'cnote', 'Only this computer can connect. Tick "Allow other devices" and restart sharing to use your phone.'));
}
async function start(silent) {
  const root = rootDir();
  $('#shErr').textContent = '';
  if (!root) { if (!silent) $('#shErr').textContent = 'Open a folder first (Files > Open...).'; return; }
  const port = parseInt($('#shPort').value, 10) || 8080, lan = $('#shLan').checked;
  try {
    info = await T.invoke('web_start', { root: root, port: port, lan: lan, token: cfg.token || null });
    cfg.token = info.token;
    save({ port: port, lan: lan, token: info.token });
  } catch (e) { info = { running: false }; if (!silent) $('#shErr').textContent = String(e); }
  render();
}
async function stop() { info = await T.invoke('web_stop'); render(); }
$('#shGo').addEventListener('click', function () { info.running ? stop() : start(false); });
$('#shAuto').addEventListener('change', function () { save({ auto: $('#shAuto').checked }); });
btn.addEventListener('click', function () { box.hidden = !box.hidden; if (!box.hidden) render(); });
$('#shClose').addEventListener('click', function () { box.hidden = true; });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !box.hidden) box.hidden = true; });

T.invoke('web_status').then(function (s) { info = s; render(); if (!s.running && cfg.auto) start(true); }).catch(function () { render(); });
})();
