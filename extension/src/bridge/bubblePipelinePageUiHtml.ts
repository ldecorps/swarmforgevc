// BL-831: Bubble Pipeline page shell - main view (grid + blurbs) plus a
// tap-through detail sheet, same remote-HTML-in-the-UI-bundle shape as
// bubbleHealthHtml.ts.

export function getBubblePipelinePageUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Pipeline</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root { color-scheme: dark; --pp-font-px: 16px; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    background: var(--tg-theme-bg-color, #0d1117);
    color: var(--tg-theme-text-color, #e6edf3);
    min-height: 100vh;
    font-size: var(--pp-font-px);
    line-height: 1.45;
  }
  header {
    position: sticky; top: 0; z-index: 2;
    padding: 10px 14px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 88%, #000);
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 35%, transparent);
  }
  h1 { font-size: calc(var(--pp-font-px) + 1px); margin: 0; font-weight: 600; }
  main { padding: 12px 14px 24px; display: grid; gap: 10px; }
  .grid-scroll { overflow-x: auto; max-width: 100%; }
  table { border-collapse: collapse; font-size: calc(var(--pp-font-px) - 2px); }
  td, th { padding: 4px 8px; border: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 30%, transparent); white-space: nowrap; }
  th { color: var(--tg-theme-hint-color, #8b949e); font-weight: 600; }
  td.mark { text-align: center; color: var(--tg-theme-link-color, #58a6ff); font-weight: 700; }
  td.rowid { cursor: pointer; color: var(--tg-theme-link-color, #58a6ff); }
  .row {
    border: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 30%, transparent);
    border-radius: 10px;
    padding: 10px 12px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 92%, #fff 4%);
    cursor: pointer;
  }
  .row .title { font-weight: 600; }
  .row .column { color: var(--tg-theme-hint-color, #8b949e); font-size: calc(var(--pp-font-px) - 2px); }
  .row .blurb { margin-top: 4px; }
  .empty { color: var(--tg-theme-hint-color, #8b949e); padding: 12px 14px; }
  #sheet {
    position: fixed; inset: 0; background: color-mix(in srgb, #000 70%, transparent);
    display: none; z-index: 5;
  }
  #sheet.open { display: block; }
  #sheet .panel {
    position: absolute; left: 0; right: 0; bottom: 0; max-height: 80vh; overflow-y: auto;
    background: var(--tg-theme-bg-color, #0d1117); border-radius: 14px 14px 0 0; padding: 14px;
  }
  #sheet h2 { margin: 0 0 8px; }
  #sheet section { margin-bottom: 10px; }
  #sheet h3 { font-size: calc(var(--pp-font-px) - 1px); margin: 0 0 4px; color: var(--tg-theme-hint-color, #8b949e); }
</style>
</head>
<body>
<header><h1>Pipeline</h1></header>
<main id="root"><p class="empty">Loading…</p></main>
<div id="sheet"><div class="panel" id="sheet-panel"></div></div>
<script>
(function () {
  var token = new URLSearchParams(location.search).get('token') || '';
  function authQuery() { return token ? '?token=' + encodeURIComponent(token) : ''; }
  function authHeaders() { return token ? { authorization: 'Bearer ' + token } : {}; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]; }); }

  function openDetail(id) {
    var q = (token ? '&' : '?') + 'id=' + encodeURIComponent(id);
    fetch('/pipeline-page-detail' + authQuery() + q, { cache: 'no-store', headers: authHeaders() })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var html = '<h2>' + esc(d.title) + '</h2>';
        if (d.description) html += '<section><h3>Description</h3><p>' + esc(d.description) + '</p></section>';
        if (d.invariants && d.invariants.length) {
          html += '<section><h3>Invariants</h3><ul>' + d.invariants.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul></section>';
        }
        if (d.outOfScope) html += '<section><h3>Out of scope</h3><p>' + esc(d.outOfScope) + '</p></section>';
        if (d.scenarios && d.scenarios.length) {
          html += '<section><h3>Scenarios</h3><ul>' + d.scenarios.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></section>';
        } else if (d.scenariosNote) {
          html += '<section><h3>Scenarios</h3><p>' + esc(d.scenariosNote) + '</p></section>';
        }
        document.getElementById('sheet-panel').innerHTML = html;
        document.getElementById('sheet').className = 'open';
      });
  }
  document.getElementById('sheet').addEventListener('click', function (e) {
    if (e.target.id === 'sheet') { document.getElementById('sheet').className = ''; }
  });

  fetch('/pipeline-page-state' + authQuery(), { cache: 'no-store', headers: authHeaders() })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var inFlight = data.inFlight || [];
      var columns = data.columns || [];
      var root = document.getElementById('root');
      if (inFlight.length === 0) {
        root.innerHTML = '<p class="empty">Nothing is in flight.</p>';
        return;
      }
      // Agent x ticket matrix - a mark at the cell where each ticket's own
      // column (the board read model's own placement, not derived here)
      // sits, same axes as the existing Pipeline board's own grid.
      var gridHtml = '<div class="grid-scroll"><table><thead><tr><th>Ticket</th>'
        + columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('')
        + '</tr></thead><tbody>'
        + inFlight.map(function (t) {
            return '<tr>'
              + '<td class="rowid" data-id="' + esc(t.id) + '">' + esc(t.id) + '</td>'
              + columns.map(function (c) { return '<td class="mark">' + (c === t.column ? '●' : '') + '</td>'; }).join('')
              + '</tr>';
          }).join('')
        + '</tbody></table></div>';
      var blurbsHtml = inFlight.map(function (t) {
        return '<article class="row" data-id="' + esc(t.id) + '">'
          + '<div class="title">' + esc(t.id) + ' — ' + esc(t.title) + '</div>'
          + '<div class="column">' + esc(t.column) + '</div>'
          + '<div class="blurb">' + esc(t.blurb) + '</div>'
          + '</article>';
      }).join('');
      root.innerHTML = gridHtml + blurbsHtml;
      root.querySelectorAll('[data-id]').forEach(function (el) {
        el.addEventListener('click', function () { openDetail(el.getAttribute('data-id')); });
      });
    })
    .catch(function () {
      document.getElementById('root').innerHTML = '<p class="empty">Could not load the pipeline.</p>';
    });
})();
</script>
</body>
</html>`;
}

export function isBubblePipelinePagePath(url: string): boolean {
  return url.split('?', 1)[0] === '/pipeline-page';
}

export function isBubblePipelinePageStatePath(url: string): boolean {
  return url.split('?', 1)[0] === '/pipeline-page-state';
}

export function isBubblePipelinePageDetailPath(url: string): boolean {
  return url.split('?', 1)[0] === '/pipeline-page-detail';
}
