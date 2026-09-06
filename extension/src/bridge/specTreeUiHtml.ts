/// BL-592: Telegram Mini App shell for the live read-only spec navigation
/// tree — Milestone → Epic → BL item → Gherkin. Polls GET
/// /spec-tree-state?token=... (computeDocsTree over the live checkout).

export function getSpecTreeUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Spec tree</title>
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
    display: flex; align-items: center; gap: 8px;
    padding: 8px 14px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 88%, #000);
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 35%, transparent);
  }
  h1 { font-size: 16px; margin: 0; font-weight: 600; letter-spacing: 0.02em; flex: 1 1 auto; min-width: 0; }
  a.back { font-size: 13px; color: var(--tg-theme-link-color, #58a6ff); text-decoration: none; flex: 0 0 auto; }
  .meta { font-size: 12px; color: var(--tg-theme-hint-color, #8b949e); flex: 0 0 auto; }
  main { padding: 10px 14px 16px; }
  .crumbs { font-size: 12px; color: var(--tg-theme-hint-color, #8b949e); margin-bottom: 10px; }
  .crumbs button {
    background: none; border: none; color: var(--tg-theme-link-color, #58a6ff);
    cursor: pointer; font-size: 12px; padding: 0;
  }
  .nav-btn {
    display: block; width: 100%; text-align: left;
    padding: 10px 12px; margin-bottom: 8px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 92%, #fff 4%);
    border: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 25%, transparent);
    color: var(--tg-theme-text-color, #e6edf3);
    font-size: 14px; cursor: pointer;
  }
  .nav-btn.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
  .gherkin {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere;
    padding: 12px; border-radius: 8px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 85%, #fff 6%);
    border: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 30%, transparent);
  }
  .empty { font-size: 15px; color: var(--tg-theme-hint-color, #8b949e); }
  .filter-row { margin-bottom: 10px; }
  .filter-row input {
    width: 100%; box-sizing: border-box;
    padding: 8px 10px; border-radius: 8px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 92%, #fff 4%);
    border: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 30%, transparent);
    color: var(--tg-theme-text-color, #e6edf3);
    font-size: 14px;
  }
</style>
</head>
<body>
<header>
  <a class="back" id="menu" href="#">Menu</a>
  <h1>Spec tree</h1>
  <span class="meta" id="status">Loading…</span>
</header>
<main>
  <div class="filter-row">
    <input type="search" id="filter" data-testid="spec-tree-filter" placeholder="Filter…" autocomplete="off"/>
  </div>
  <div class="crumbs" id="crumbs"></div>
  <div id="content"></div>
</main>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }
  var token = new URLSearchParams(location.search).get('bearer') || new URLSearchParams(location.search).get('token') || '';
  var tokenParam = token ? ('token=' + encodeURIComponent(token)) : '';
  document.getElementById('menu').href = '/console' + (tokenParam ? '?' + tokenParam : '');

  var tree = null;
  var view = { level: 'milestones' };
  var filterTerm = '';
  var filterDebounce = null;

  function stateUrl() {
    var params = [];
    if (tokenParam) params.push(tokenParam);
    if (filterTerm) params.push('q=' + encodeURIComponent(filterTerm));
    return '/spec-tree-state' + (params.length ? '?' + params.join('&') : '');
  }

  function findMilestone(name) {
    return (tree.milestones || []).find(function (m) { return m.milestone === name; });
  }
  function findTicket(id) {
    return (tree.tickets || []).find(function (t) { return t.id === id; });
  }
  function findEpic(milestoneName, epicKey) {
    var m = findMilestone(milestoneName);
    if (!m) return null;
    return (m.epics || []).find(function (e) { return e.epicKey === epicKey; });
  }

  function epicLabel(epic) {
    if (epic.title) return epic.title;
    return epic.epicKey;
  }

  function renderCrumbs() {
    var el = document.getElementById('crumbs');
    el.innerHTML = '';
    var parts = [{ label: 'Milestones', view: { level: 'milestones' } }];
    if (view.level === 'epics' || view.level === 'tickets' || view.level === 'scenario') {
      parts.push({ label: view.milestone, view: { level: 'epics', milestone: view.milestone } });
    }
    if (view.level === 'tickets' || view.level === 'scenario') {
      parts.push({ label: view.epicKey, view: { level: 'tickets', milestone: view.milestone, epicKey: view.epicKey } });
    }
    if (view.level === 'tickets' || view.level === 'scenario') {
      parts.push({ label: view.ticketId, view: { level: 'tickets', milestone: view.milestone, epicKey: view.epicKey, ticketId: view.ticketId } });
    }
    if (view.level === 'scenario') {
      parts.push({ label: 'scenario', view: view });
    }
    parts.forEach(function (part, i) {
      if (i > 0) el.appendChild(document.createTextNode(' › '));
      if (i === parts.length - 1) {
        el.appendChild(document.createTextNode(part.label));
        return;
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = part.label;
      btn.addEventListener('click', function () {
        view = part.view;
        render();
      });
      el.appendChild(btn);
    });
  }

  function navButton(label, nextView, testId, extraClass) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = extraClass ? 'nav-btn ' + extraClass : 'nav-btn';
    btn.textContent = label;
    if (testId) btn.setAttribute('data-testid', testId);
    btn.addEventListener('click', function () {
      view = nextView;
      render();
    });
    return btn;
  }

  function render() {
    var content = document.getElementById('content');
    content.innerHTML = '';
    renderCrumbs();
    if (!tree) {
      content.appendChild(document.createTextNode('No tree loaded.'));
      return;
    }
    if (view.level === 'milestones') {
      if (filterTerm && (tree.milestones || []).length === 0) {
        var empty = document.createElement('div');
        empty.className = 'empty';
        empty.setAttribute('data-testid', 'no-results');
        empty.textContent = 'No matches for "' + filterTerm + '".';
        content.appendChild(empty);
        return;
      }
      (tree.milestones || []).forEach(function (m) {
        var count = (m.epics || []).reduce(function (n, e) { return n + (e.tickets || []).length; }, 0);
        content.appendChild(navButton(
          m.milestone + ' (' + count + ')',
          { level: 'epics', milestone: m.milestone },
          'milestone-' + m.milestone
        ));
      });
      return;
    }
    if (view.level === 'epics') {
      var milestone = findMilestone(view.milestone);
      if (!milestone) {
        content.appendChild(document.createTextNode('Milestone not found.'));
        return;
      }
      (milestone.epics || []).forEach(function (epic) {
        var label = epicLabel(epic) + ' (' + (epic.tickets || []).length + ')';
        content.appendChild(navButton(
          label,
          { level: 'tickets', milestone: view.milestone, epicKey: epic.epicKey },
          'epic-' + epic.epicKey
        ));
      });
      return;
    }
    if (view.level === 'tickets') {
      var epic = findEpic(view.milestone, view.epicKey);
      if (!epic) {
        content.appendChild(document.createTextNode('Epic not found.'));
        return;
      }
      (epic.tickets || []).forEach(function (t) {
        content.appendChild(navButton(
          t.id + ' — ' + t.title + ' [' + t.status + ']',
          { level: 'ticket', milestone: view.milestone, epicKey: view.epicKey, ticketId: t.id },
          'ticket-' + t.id,
          'mono'
        ));
      });
      if (view.ticketId) {
        var ticket = findTicket(view.ticketId);
        if (!ticket) {
          content.appendChild(document.createTextNode('Ticket not found.'));
          return;
        }
        if (ticket.description) {
          var desc = document.createElement('p');
          desc.textContent = ticket.description;
          content.appendChild(desc);
        }
        (ticket.scenarios || []).forEach(function (s, i) {
          content.appendChild(navButton(
            s.name,
            { level: 'scenario', milestone: view.milestone, epicKey: view.epicKey, ticketId: view.ticketId, scenarioIndex: i },
            'scenario-' + i
          ));
        });
      }
      return;
    }
    if (view.level === 'ticket') {
      view = { level: 'tickets', milestone: view.milestone, epicKey: view.epicKey, ticketId: view.ticketId };
      render();
      return;
    }
    if (view.level === 'scenario') {
      var scenTicket = findTicket(view.ticketId);
      var scenario = scenTicket && scenTicket.scenarios && scenTicket.scenarios[view.scenarioIndex];
      if (!scenario) {
        content.appendChild(document.createTextNode('Scenario not found.'));
        return;
      }
      var pre = document.createElement('pre');
      pre.className = 'gherkin';
      pre.setAttribute('data-testid', 'scenario-text');
      pre.textContent = scenario.text;
      content.appendChild(pre);
    }
  }

  function refresh() {
    document.getElementById('status').textContent = 'Loading…';
    fetch(stateUrl(), { cache: 'no-store' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        tree = data;
        document.getElementById('status').textContent = (data.sourceSha || 'live').slice(0, 8);
        render();
      })
      .catch(function () {
        document.getElementById('status').textContent = 'Error';
      });
  }

  document.getElementById('filter').addEventListener('input', function (e) {
    var term = e.target.value;
    if (filterDebounce) { clearTimeout(filterDebounce); }
    filterDebounce = setTimeout(function () {
      filterTerm = term;
      refresh();
    }, 250);
  });

  refresh();
})();
</script>
</body>
</html>`;
}
