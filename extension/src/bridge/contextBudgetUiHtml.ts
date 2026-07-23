/// GH-23 (Slice 1): Telegram Mini App shell for the Context Budget
/// dashboard. Numeric/text display only - no charts/timelines (Slice 2,
/// parked in specs/features/GH-23-context-budget-slice-2-visualisation.feature.draft).
/// Polls GET /context-budget-state?token=...&agent=... - the aggregation
/// (compaction count, average utilisation, latest-event token/cost snapshot)
/// is computed entirely by GH-22's context_telemetry_cli.bb; this shell only
/// renders whatever that JSON already contains.

export function getContextBudgetUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Context Budget</title>
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
  header {
    position: sticky; top: 0; z-index: 2;
    display: flex; align-items: center; gap: 6px 8px; flex-wrap: wrap;
    padding: 8px 14px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 88%, #000);
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 35%, transparent);
  }
  h1 {
    font-size: 16px;
    margin: 0;
    font-weight: 600;
    letter-spacing: 0.02em;
    flex: 1 1 auto;
    min-width: 0;
  }
  a.back {
    font-size: 13px;
    color: var(--tg-theme-link-color, #58a6ff);
    text-decoration: none;
    flex: 0 0 auto;
  }
  select#agent-picker {
    flex: 0 0 auto;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 45%, transparent);
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 70%, #fff 8%);
    color: var(--tg-theme-text-color, #e6edf3);
  }
  main { padding: 12px 14px 16px; }
  .empty { font-size: 15px; color: var(--tg-theme-hint-color, #8b949e); }
  .field-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 20%, transparent);
    font-size: 14px;
  }
  .field-label { color: var(--tg-theme-hint-color, #8b949e); }
  .field-value { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
</style>
</head>
<body>
<header>
  <a class="back" id="menu" href="#">Menu</a>
  <h1>Context Budget</h1>
  <select id="agent-picker" aria-label="Agent"></select>
</header>
<main>
  <div id="content">Loading…</div>
</main>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }

  var params = new URLSearchParams(location.search);
  var token = params.get('token') || '';
  var initialAgent = params.get('agent') || '';
  var q = token ? ('?token=' + encodeURIComponent(token)) : '';
  document.getElementById('menu').href = '/console' + q;

  var contentEl = document.getElementById('content');
  var pickerEl = document.getElementById('agent-picker');

  function stateUrl(agent) {
    var qs = new URLSearchParams();
    if (token) qs.set('token', token);
    if (agent) qs.set('agent', agent);
    var s = qs.toString();
    return '/context-budget-state' + (s ? ('?' + s) : '');
  }

  function renderPicker(data) {
    pickerEl.innerHTML = '';
    (data.agents || []).forEach(function (a) {
      var opt = document.createElement('option');
      opt.value = a;
      opt.textContent = a;
      if (a === data.agent) opt.selected = true;
      pickerEl.appendChild(opt);
    });
  }

  function fieldRow(label, value) {
    return '<div class="field-row"><span class="field-label">' + label + '</span>'
      + '<span class="field-value">' + (value === null || value === undefined ? '—' : value) + '</span></div>';
  }

  function renderContent(data) {
    var summary = data.summary || {};
    if (!summary.event_count) {
      contentEl.innerHTML = '<p class="empty">No telemetry recorded yet for ' + (data.agent || '(no agent)') + '.</p>';
      return;
    }
    var html = '';
    html += fieldRow('Provider', summary.provider);
    html += fieldRow('Model', summary.model);
    html += fieldRow('Compactions', summary.compaction_count);
    html += fieldRow('Context utilisation %', summary.avg_context_utilization_pct);
    html += fieldRow('Input tokens', summary.latest_input_tokens);
    html += fieldRow('Output tokens', summary.latest_output_tokens);
    html += fieldRow('Tool output tokens', summary.latest_tool_output_tokens);
    html += fieldRow('Prompt engine tokens', summary.latest_prompt_engine_tokens);
    html += fieldRow('System prompt tokens', summary.latest_system_prompt_tokens);
    html += fieldRow('History tokens', summary.latest_history_tokens);
    html += fieldRow('Estimated cost (USD)', summary.latest_estimated_cost_usd);
    contentEl.innerHTML = html;
  }

  function load(agent) {
    fetch(stateUrl(agent), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        renderPicker(data);
        renderContent(data);
      })
      .catch(function (err) {
        contentEl.innerHTML = '<p class="empty">Failed to load context budget: ' + String(err && err.message || err) + '</p>';
      });
  }

  pickerEl.onchange = function () {
    load(pickerEl.value);
  };

  load(initialAgent);
})();
</script>
</body>
</html>`;
}
