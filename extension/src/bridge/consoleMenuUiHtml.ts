// BL-526: Telegram Mini App console landing — two portrait-stacked buttons
// (pipeline STATUS GRID + mono-router resident live feed). Self-contained
// except telegram-web-app.js (same posture as residentSpyUiHtml.ts).

export function getConsoleMenuUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>SwarmForge Console</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    background: var(--tg-theme-bg-color, #0d1117);
    color: var(--tg-theme-text-color, #e6edf3);
    min-height: 100vh;
    max-width: 100vw;
    overflow-x: hidden;
  }
  main {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 20px 16px calc(20px + env(safe-area-inset-bottom, 0px));
    width: 100%;
    max-width: 100%;
  }
  h1 {
    font-size: 18px;
    font-weight: 600;
    margin: 0 0 4px;
    letter-spacing: 0.02em;
  }
  p.sub {
    margin: 0 0 8px;
    font-size: 13px;
    color: var(--tg-theme-hint-color, #8b949e);
  }
  a.btn {
    display: block;
    width: 100%;
    max-width: 100%;
    min-height: 52px;
    padding: 16px 18px;
    border-radius: 12px;
    text-decoration: none;
    font-size: 16px;
    font-weight: 600;
    text-align: center;
    color: var(--tg-theme-button-text-color, #fff);
    background: var(--tg-theme-button-color, #238636);
    border: 1px solid color-mix(in srgb, var(--tg-theme-button-color, #238636) 70%, #000);
  }
  a.btn.secondary {
    background: color-mix(in srgb, var(--tg-theme-button-color, #388bfd) 85%, #111);
    border-color: color-mix(in srgb, var(--tg-theme-button-color, #388bfd) 55%, #000);
  }
</style>
</head>
<body>
<main>
  <h1>SwarmForge Console</h1>
  <p class="sub">Portrait menu — pick a view</p>
  <a class="btn" id="pipeline-grid" data-testid="pipeline-grid" href="#">Pipeline grid</a>
  <a class="btn secondary" id="mono-feed" data-testid="mono-router-feed" href="#">Swarm Live Screen</a>
  <a class="btn secondary" id="paused-pager" data-testid="paused-ticket-pager" href="#">Paused tickets</a>
</main>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }
  var token = new URLSearchParams(location.search).get('token') || '';
  var q = token ? ('?token=' + encodeURIComponent(token)) : '';
  document.getElementById('pipeline-grid').href = '/pipeline-grid' + q;
  document.getElementById('mono-feed').href = '/resident-spy' + q;
  document.getElementById('paused-pager').href = '/paused-pager' + q;
})();
</script>
</body>
</html>`;
}
