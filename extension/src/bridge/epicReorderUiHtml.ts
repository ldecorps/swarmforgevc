/// BL-572: Telegram Mini App shell for the console EPIC PRIORITY REORDER
/// screen. Lists paused `type: epic` tickets (priority ascending) with
/// Move up / Move down per row - each tap POSTs /epic-reorder/move
/// {id, direction} and refreshes. A move is never silently refused: a
/// boundary no-op (already first/last) answers changed:false with a reason,
/// which this screen displays rather than a status line indistinguishable
/// from success (architect bounce #2). Empty state ("No epics to reorder")
/// when there are none. Polls GET /epic-reorder-state?token=... for the list.

export function getEpicReorderUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Reorder Epics</title>
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
  .status-line {
    font-size: 12px;
    color: var(--tg-theme-hint-color, #8b949e);
    margin-bottom: 8px;
  }
  .status-line.no-change { color: #d29922; }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    margin-bottom: 8px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 92%, #fff 4%);
    border: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 25%, transparent);
  }
  .row-text { flex: 1 1 auto; min-width: 0; }
  .row-id {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    color: var(--tg-theme-hint-color, #8b949e);
  }
  .row-title { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
  .row-priority { font-size: 11px; color: var(--tg-theme-hint-color, #8b949e); }
  .row-actions { display: flex; flex-direction: column; gap: 4px; flex: 0 0 auto; }
  button {
    padding: 6px 10px;
    font-size: 13px;
    font-weight: 600;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--tg-theme-button-color, #388bfd) 55%, #000);
    background: color-mix(in srgb, var(--tg-theme-button-color, #388bfd) 85%, #111);
    color: var(--tg-theme-button-text-color, #fff);
    cursor: pointer;
  }
  button[disabled] { opacity: 0.35; cursor: default; }
  .empty { font-size: 15px; color: var(--tg-theme-hint-color, #8b949e); }
  .dep-marker { font-size: 11px; }
  button.back-to-tiles { margin-bottom: 10px; }
</style>
</head>
<body>
<header>
  <a class="back" id="menu" href="#">Menu</a>
  <h1>Reorder epics</h1>
  <span class="meta" id="status">Loading…</span>
</header>
<main>
  <div class="status-line" id="move-status"></div>
  <div id="content"></div>
</main>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }

  var params = new URLSearchParams(location.search);
  var token = params.get('token') || '';
  var q = token ? ('?token=' + encodeURIComponent(token)) : '';
  document.getElementById('menu').href = '/console' + q;

  var statusEl = document.getElementById('status');
  var moveStatusEl = document.getElementById('move-status');
  var contentEl = document.getElementById('content');
  var loading = false;
  // BL-674: 'tiles' (the epic list) or 'drilldown' (one epic's live
  // topics). The pane header above is never touched by either render -
  // only #content swaps - so it stays present across both (standing
  // operator rule).
  var view = 'tiles';
  var drilldownEpicId = null;
  var lastData = null;

  function controlAuthHeaders() {
    if (!token) {
      return { 'content-type': 'application/json' };
    }
    return {
      'content-type': 'application/json',
      authorization: 'Bearer ' + token,
      'x-control-token': token,
    };
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  // Shows (or clears) the last move's outcome. A boundary no-op is never
  // indistinguishable from success: it gets its own visible reason instead
  // of silently refreshing an identical list (architect bounce #2).
  function setMoveStatus(text, noChange) {
    moveStatusEl.textContent = text || '';
    moveStatusEl.classList.toggle('no-change', !!noChange);
  }

  function reasonOrFallback(payload, fallback) {
    return (payload && payload.reason) ? String(payload.reason) : fallback;
  }

  function renderEmpty() {
    contentEl.innerHTML = '<p class="empty">No epics to reorder.</p>';
  }

  function renderTiles(data) {
    if (!data || !data.items || data.items.length === 0) {
      renderEmpty();
      setStatus('No epics');
      return;
    }
    var total = data.items.length;
    var html = '';
    data.items.forEach(function (item, index) {
      var disableUp = index === 0;
      var disableDown = index === total - 1;
      html += '<div class="row" data-id="' + item.id + '">';
      html += '<div class="row-text">';
      html += '<div class="row-id">' + item.id + '</div>';
      html += '<div class="row-title">' + (item.title || '(untitled)') + '</div>';
      html += '<div class="row-priority">priority ' + item.priority + '</div>';
      html += '</div>';
      html += '<div class="row-actions">';
      html += '<button class="move-up" data-id="' + item.id + '"' + (disableUp ? ' disabled' : '') + '>Move up</button>';
      html += '<button class="move-down" data-id="' + item.id + '"' + (disableDown ? ' disabled' : '') + '>Move down</button>';
      html += '<button class="make-top" data-id="' + item.id + '"' + (disableUp ? ' disabled' : '') + '>Make top</button>';
      html += '<button class="drill" data-id="' + item.id + '">Topics</button>';
      html += '</div>';
      html += '</div>';
    });
    contentEl.innerHTML = html;

    Array.prototype.forEach.call(contentEl.querySelectorAll('.move-up'), function (btn) {
      btn.onclick = function () { move(btn.getAttribute('data-id'), 'up'); };
    });
    Array.prototype.forEach.call(contentEl.querySelectorAll('.move-down'), function (btn) {
      btn.onclick = function () { move(btn.getAttribute('data-id'), 'down'); };
    });
    Array.prototype.forEach.call(contentEl.querySelectorAll('.make-top'), function (btn) {
      btn.onclick = function () { makeTop(btn.getAttribute('data-id')); };
    });
    Array.prototype.forEach.call(contentEl.querySelectorAll('.drill'), function (btn) {
      btn.onclick = function () { drillInto(btn.getAttribute('data-id')); };
    });

    setStatus(total + (total === 1 ? ' epic' : ' epics'));
  }

  // BL-674: the drill-down list for one epic's live topics - already
  // ordered by the server (priority asc, id asc), same source of truth as
  // the tiles above. A topic carrying at least one live depends_on gets a
  // marker so a bound/refusal is never a surprise (approval_context).
  function renderDrilldown(epicId) {
    var topics = ((lastData && lastData.topics) || []).filter(function (t) { return t.epic === epicId; });
    var html = '<button class="back-to-tiles" id="back-to-tiles">&larr; Back</button>';
    if (topics.length === 0) {
      html += '<p class="empty">No live topics in this epic.</p>';
    } else {
      topics.forEach(function (t) {
        var marker = t.hasLiveDependency ? ' <span class="dep-marker" title="Has a live dependency">&#9939;</span>' : '';
        html += '<div class="row" data-id="' + t.id + '">';
        html += '<div class="row-text">';
        html += '<div class="row-id">' + t.id + marker + '</div>';
        html += '<div class="row-title">' + (t.title || '(untitled)') + '</div>';
        html += '<div class="row-priority">priority ' + t.priority + '</div>';
        html += '</div>';
        html += '<div class="row-actions">';
        html += '<button class="topic-make-top" data-epic="' + epicId + '" data-id="' + t.id + '">Make top</button>';
        html += '</div>';
        html += '</div>';
      });
    }
    contentEl.innerHTML = html;

    document.getElementById('back-to-tiles').onclick = function () {
      view = 'tiles';
      drilldownEpicId = null;
      setMoveStatus('');
      render();
    };
    Array.prototype.forEach.call(contentEl.querySelectorAll('.topic-make-top'), function (btn) {
      btn.onclick = function () { makeTopicTop(btn.getAttribute('data-epic'), btn.getAttribute('data-id')); };
    });

    setStatus('Epic ' + epicId + ': ' + topics.length + (topics.length === 1 ? ' topic' : ' topics'));
  }

  function drillInto(epicId) {
    view = 'drilldown';
    drilldownEpicId = epicId;
    setMoveStatus('');
    refresh(); // fresh at render, not the tile-load-time snapshot (approval_context)
  }

  // Renders whichever view is current against the LAST fetched state -
  // called both after the initial load and after every refresh(), so a
  // successful topic make-top re-renders the drill-down (not the tiles)
  // when that is where the human is.
  function render() {
    if (view === 'drilldown' && drilldownEpicId) {
      renderDrilldown(drilldownEpicId);
    } else {
      renderTiles(lastData);
    }
  }

  // Shared by move() and makeTop(): the server's reason is written
  // specifically to be shown - a raw HTTP status is not a reason (architect
  // bounce #3). When the write itself already landed on disk (commit-failed
  // path) the list must stop showing the stale pre-action order. A legal
  // no-op (list boundary, already-best-position, or a refused dependency
  // bound) gets its own stated reason, never a refresh indistinguishable
  // from success.
  function handleActionResponse(fetchPromise, failedLabel) {
    return fetchPromise.then(function (r) {
      loading = false;
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (payload) {
          setMoveStatus(reasonOrFallback(payload, failedLabel + ' (HTTP ' + r.status + ')'), true);
          setStatus(failedLabel);
          if (payload && payload.changed) { refresh(); }
        });
      }
      return r.json().then(function (payload) {
        if (!payload || !payload.success) {
          setMoveStatus(reasonOrFallback(payload, failedLabel), true);
          setStatus(failedLabel);
          return;
        }
        if (payload.changed === false) {
          setMoveStatus(reasonOrFallback(payload, 'No change.'), true);
          return;
        }
        setMoveStatus('');
        refresh();
      });
    }).catch(function (err) {
      loading = false;
      setStatus(failedLabel + ': ' + String(err && err.message || err));
    });
  }

  function move(id, direction) {
    if (loading) return;
    loading = true;
    setMoveStatus('');
    setStatus('Moving ' + id + '…');
    handleActionResponse(fetch('/epic-reorder/move' + q, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ id: id, direction: direction }),
    }), 'Move failed');
  }

  function makeTop(id) {
    if (loading) return;
    loading = true;
    setMoveStatus('');
    setStatus('Making ' + id + ' top…');
    handleActionResponse(fetch('/epic-reorder/make-top' + q, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ id: id }),
    }), 'Make top failed');
  }

  function makeTopicTop(epicId, topicId) {
    if (loading) return;
    loading = true;
    setMoveStatus('');
    setStatus('Making ' + topicId + ' top…');
    handleActionResponse(fetch('/epic-reorder/topic-make-top' + q, {
      method: 'POST',
      headers: controlAuthHeaders(),
      body: JSON.stringify({ epicId: epicId, topicId: topicId }),
    }), 'Make top failed');
  }

  function refresh() {
    fetch('/epic-reorder-state' + q, { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        lastData = data;
        render();
      })
      .catch(function (err) {
        setStatus('Load error: ' + String(err && err.message || err));
        contentEl.innerHTML = '<p class="empty">Failed to load epics.</p>';
      });
  }

  refresh();
})();
</script>
</body>
</html>`;
}
