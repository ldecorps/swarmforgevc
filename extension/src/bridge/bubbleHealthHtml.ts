export function getBubbleHealthUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Health</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root { color-scheme: dark; --bh-font-px: 16px; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    background: var(--tg-theme-bg-color, #0d1117);
    color: var(--tg-theme-text-color, #e6edf3);
    min-height: 100vh;
    max-width: 100vw;
    overflow-x: hidden;
    font-size: var(--bh-font-px);
    line-height: 1.45;
  }
  header {
    position: sticky; top: 0; z-index: 2;
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 10px 14px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 88%, #000);
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 35%, transparent);
  }
  h1 { font-size: calc(var(--bh-font-px) + 1px); margin: 0; font-weight: 600; flex: 1 1 auto; }
  .subtitle { font-size: calc(var(--bh-font-px) - 2px); color: var(--tg-theme-hint-color, #8b949e); width: 100%; margin: 0; }
  main { padding: 12px 14px 24px; display: grid; gap: 12px; }
  .card {
    border: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 30%, transparent);
    border-radius: 10px;
    padding: 12px 14px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 92%, #fff 4%);
  }
  .card h2 { margin: 0 0 4px; font-size: calc(var(--bh-font-px) - 1px); font-weight: 600; }
  .value { font-size: calc(var(--bh-font-px) + 6px); font-weight: 700; margin: 4px 0; overflow-wrap: anywhere; }
  .window { font-size: calc(var(--bh-font-px) - 2px); color: var(--tg-theme-hint-color, #8b949e); }
  .direction { font-size: calc(var(--bh-font-px) - 1px); color: var(--tg-theme-link-color, #58a6ff); margin-top: 4px; overflow-wrap: anywhere; }
  .roles { margin: 8px 0 0; padding-left: 1.1rem; font-size: calc(var(--bh-font-px) - 1px); }
  .roles li { margin: 4px 0; }
  .err { color: #f85149; padding: 12px 14px; }
</style>
</head>
<body>
<header>
  <h1>Health</h1>
  <p class="subtitle">Recent swarm efficiency — each readout names its own window</p>
</header>
<main id="root"><p class="window">Loading…</p></main>
<script>
(function () {
  var token = new URLSearchParams(location.search).get('token') || '';
  function authQuery() { return token ? '?token=' + encodeURIComponent(token) : ''; }
  function pct(rate) { return rate === null ? '—' : Math.round(rate * 100) + '%'; }
  function renderCard(readout, extraHtml) {
    return '<article class="card"><h2>' + readout.label + '</h2>'
      + '<div class="value">' + readout.displayValue + '</div>'
      + '<div class="window">' + readout.windowLabel + '</div>'
      + (readout.directionLine ? '<div class="direction">' + readout.directionLine + '</div>' : '')
      + (extraHtml || '') + '</article>';
  }
  function renderRework(rework) {
    var roles = (rework.byRole || []).map(function (row) {
      return '<li>' + row.role + ': ' + row.bouncedCount + '/' + row.completedCount + ' (' + pct(row.rate) + ')</li>';
    }).join('');
    return renderCard(rework, roles ? '<ul class="roles">' + roles + '</ul>' : '');
  }
  fetch('/health-trends' + authQuery(), {
    cache: 'no-store',
    headers: token ? { authorization: 'Bearer ' + token } : {}
  }).then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }).then(function (data) {
    document.getElementById('root').innerHTML =
      renderCard(data.traverseTime)
      + renderRework(data.rework)
      + renderCard(data.bottleneck)
      + renderCard(data.velocity);
  }).catch(function (err) {
    document.getElementById('root').innerHTML = '<p class="err">Health unavailable: ' + err.message + '</p>';
  });
})();
</script>
</body>
</html>`;
}

export function isBubbleHealthPath(url: string): boolean {
  return url.split('?', 1)[0] === '/health';
}

export function isBubbleHealthTrendsPath(url: string): boolean {
  return url.split('?', 1)[0] === '/health-trends';
}
