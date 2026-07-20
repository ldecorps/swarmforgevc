// BL-522: Telegram Mini App shell for the live resident pane feed.
// Self-contained except for the official telegram-web-app.js (required by
// Telegram). Polls GET /resident-pane?token=... on the same origin.

export function getResidentSpyUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Resident Spy</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: var(--tg-theme-bg-color, #0d1117);
    color: var(--tg-theme-text-color, #e6edf3);
    min-height: 100vh;
  }
  header {
    position: sticky; top: 0; z-index: 1;
    display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
    padding: 10px 14px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 88%, #000);
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 35%, transparent);
  }
  h1 { font-size: 14px; margin: 0; font-weight: 600; letter-spacing: 0.02em; }
  .meta { font-size: 12px; color: var(--tg-theme-hint-color, #8b949e); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #3fb950; display: inline-block; }
  .dot.stale { background: #d29922; }
  .dot.err { background: #f85149; }
  pre {
    margin: 0; padding: 12px 14px 24px;
    white-space: pre-wrap; word-break: break-word;
    font-size: 12px; line-height: 1.45;
  }
</style>
</head>
<body>
<header>
  <span id="dot" class="dot"></span>
  <h1 id="role">Resident Spy</h1>
  <span class="meta" id="session"></span>
  <span class="meta" id="age">connecting…</span>
</header>
<pre id="pane">Loading pane…</pre>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }
  var params = new URLSearchParams(location.search);
  var token = params.get('token') || '';
  var paneEl = document.getElementById('pane');
  var roleEl = document.getElementById('role');
  var sessionEl = document.getElementById('session');
  var ageEl = document.getElementById('age');
  var dotEl = document.getElementById('dot');
  var lastOk = 0;

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
    fetch('/resident-pane?token=' + encodeURIComponent(token), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || data.available === false) {
          roleEl.textContent = 'Resident (unavailable)';
          sessionEl.textContent = '';
          paneEl.textContent = '(pane not reachable)';
          setStatus('err', 'no pane');
          return;
        }
        var header = 'Resident: ' + (data.roleLabel || 'unknown');
        if (data.modelLabel) header += ' on ' + data.modelLabel;
        roleEl.textContent = header;
        sessionEl.textContent = data.sessionTarget || '';
        paneEl.textContent = data.paneText || '(empty)';
        lastOk = Date.now();
        setStatus('ok', 'updated 0s ago');
      })
      .catch(function (err) {
        setStatus('err', String(err && err.message || err));
      });
  }

  refresh();
  setInterval(refresh, 1500);
  setInterval(tickAge, 500);
})();
</script>
</body>
</html>`;
}
