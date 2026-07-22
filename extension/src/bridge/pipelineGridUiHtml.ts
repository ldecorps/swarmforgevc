// BL-526: Telegram Mini App shell for the pipeline STATUS GRID (no below-grid
// links). Polls GET /pipeline-board?token=... on the same origin.

export function getPipelineGridUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Pipeline Grid</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root {
    color-scheme: dark;
    --pg-font-px: 15px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: var(--tg-theme-bg-color, #0d1117);
    color: var(--tg-theme-text-color, #e6edf3);
    min-height: 100vh;
    max-width: 100vw;
    overflow-x: hidden;
  }
  header {
    position: sticky; top: 0; z-index: 2;
    display: flex; align-items: center; gap: 6px 8px; flex-wrap: wrap;
    padding: 8px 14px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 88%, #000);
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 35%, transparent);
  }
  h1 {
    font-size: calc(var(--pg-font-px) + 1px);
    margin: 0;
    font-weight: 600;
    letter-spacing: 0.02em;
    flex: 1 1 auto;
    min-width: 0;
  }
  .meta { font-size: calc(var(--pg-font-px) - 2px); color: var(--tg-theme-hint-color, #8b949e); width: 100%; }
  a.back {
    font-size: calc(var(--pg-font-px) - 2px);
    color: var(--tg-theme-link-color, #58a6ff);
    text-decoration: none;
    flex: 0 0 auto;
  }
  .font-controls {
    display: flex;
    gap: 4px;
    flex: 0 0 auto;
    margin-left: auto;
  }
  button.font-btn {
    padding: 2px 7px;
    font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 45%, transparent);
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 70%, #fff 8%);
    color: var(--tg-theme-text-color, #e6edf3);
    cursor: pointer;
  }
  button.font-btn[disabled] {
    opacity: 0.4;
    cursor: default;
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #3fb950; display: inline-block; flex: 0 0 auto; }
  .dot.stale { background: #d29922; }
  .dot.err { background: #f85149; }
  pre {
    margin: 0; padding: 12px 14px 24px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    font-size: var(--pg-font-px);
    line-height: 1.45;
    max-width: 100%;
  }
</style>
</head>
<body>
<header>
  <a class="back" id="menu" href="#">Menu</a>
  <span id="dot" class="dot"></span>
  <h1>Pipeline STATUS GRID</h1>
  <div class="font-controls">
    <button type="button" class="font-btn" id="font-dec" aria-label="Smaller text">A-</button>
    <button type="button" class="font-btn" id="font-inc" aria-label="Larger text">A+</button>
  </div>
  <span class="meta" id="age">connecting…</span>
</header>
<pre id="board">Loading grid…</pre>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }
  var params = new URLSearchParams(location.search);
  var token = params.get('token') || '';
  var q = token ? ('?token=' + encodeURIComponent(token)) : '';
  document.getElementById('menu').href = '/console' + q;
  var boardEl = document.getElementById('board');
  var ageEl = document.getElementById('age');
  var dotEl = document.getElementById('dot');
  var lastOk = 0;

  var FONT_KEY = 'swarmforge-pipeline-grid-font-px';
  var FONT_MIN = 12;
  var FONT_MAX = 26;
  var FONT_DEFAULT = 15;
  var FONT_STEP = 2;

  function currentFontPx() {
    var raw = document.documentElement.style.getPropertyValue('--pg-font-px');
    var parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : FONT_DEFAULT;
  }

  function applyFont(px) {
    var clamped = Math.min(FONT_MAX, Math.max(FONT_MIN, px));
    document.documentElement.style.setProperty('--pg-font-px', clamped + 'px');
    try { localStorage.setItem(FONT_KEY, String(clamped)); } catch (_) {}
    document.getElementById('font-dec').disabled = clamped <= FONT_MIN;
    document.getElementById('font-inc').disabled = clamped >= FONT_MAX;
  }

  function loadFont() {
    var stored = parseInt(localStorage.getItem(FONT_KEY), 10);
    applyFont(Number.isFinite(stored) ? stored : FONT_DEFAULT);
  }

  document.getElementById('font-dec').onclick = function () {
    applyFont(currentFontPx() - FONT_STEP);
  };
  document.getElementById('font-inc').onclick = function () {
    applyFont(currentFontPx() + FONT_STEP);
  };
  loadFont();

  function setStatus(kind, text) {
    dotEl.className = 'dot' + (kind === 'ok' ? '' : ' ' + kind);
    ageEl.textContent = text;
  }

  function tickAge() {
    if (!lastOk) return;
    var s = Math.round((Date.now() - lastOk) / 1000);
    setStatus(s > 5 ? 'stale' : 'ok', 'updated ' + s + 's ago');
  }

  function refresh() {
    fetch('/pipeline-board?token=' + encodeURIComponent(token), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        boardEl.textContent = (data && data.boardText) || '(empty grid)';
        lastOk = Date.now();
        setStatus('ok', 'updated 0s ago');
      })
      .catch(function (err) {
        setStatus('err', String(err && err.message || err));
      });
  }

  refresh();
  setInterval(refresh, 2000);
  setInterval(tickAge, 500);
})();
</script>
</body>
</html>`;
}
