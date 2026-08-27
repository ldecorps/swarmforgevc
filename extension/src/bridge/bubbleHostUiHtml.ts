// BL-834: Bubble Host thinking page — remote HTML over BL-833 activity feed.
export function getBubbleHostUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Host</title>
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
    max-width: 100vw;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
  }
  header {
    position: sticky; top: 0; z-index: 2;
    padding: 10px 14px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 88%, #000);
    border-bottom: 1px solid color-mix(in srgb, var(--tg-theme-hint-color, #8b949e) 35%, transparent);
  }
  h1 {
    font-size: 14px;
    margin: 0;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .host-status {
    font-size: 12px;
    color: var(--tg-theme-hint-color, #8b949e);
    margin-top: 6px;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  body[data-host-state="working"] .host-status { color: #3fb950; }
  body[data-host-state="quiet"] .host-status { color: var(--tg-theme-hint-color, #8b949e); }
  body[data-host-state="unreachable"] .host-status { color: #f85149; }
  main {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 0 0 calc(12px + env(safe-area-inset-bottom, 0px));
  }
  #host-feed {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 10px 14px;
  }
  .host-line {
    padding: 8px 10px;
    margin-bottom: 8px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--tg-theme-bg-color, #0d1117) 88%, #fff 4%);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    font-size: 13px;
    line-height: 1.45;
  }
  #jump-newest {
    flex: 0 0 auto;
    margin: 0 14px 8px;
    padding: 10px 12px;
    font-size: 13px;
    font-weight: 600;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--tg-theme-link-color, #58a6ff) 55%, transparent);
    background: color-mix(in srgb, var(--tg-theme-link-color, #58a6ff) 18%, #0d1117);
    color: var(--tg-theme-text-color, #e6edf3);
    cursor: pointer;
    display: none;
  }
  #jump-newest.visible { display: block; }
</style>
</head>
<body data-host-state="quiet" data-live-push="pending">
<header>
  <h1>Host agent</h1>
  <div id="host-status" class="host-status">Reading host activity feed…</div>
</header>
<main>
  <div id="host-feed" aria-live="polite"></div>
  <button type="button" id="jump-newest">Jump to newest</button>
</main>
<script>
(function () {
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { tg.ready(); tg.expand(); }

  var params = new URLSearchParams(location.search);
  var token = params.get('bearer') || params.get('token') || '';
  var statusEl = document.getElementById('host-status');
  var feedEl = document.getElementById('host-feed');
  var jumpBtn = document.getElementById('jump-newest');
  var lines = [];
  var pinnedToBottom = true;
  var streamAbort = null;

  function authHeaders() {
    return token ? { authorization: 'Bearer ' + token } : {};
  }

  function setViewState(state) {
    document.body.setAttribute('data-host-state', state);
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function humanUnreachableReason(err, status) {
    if (status === 401 || status === 403) {
      return 'bridge authentication failed — reopen from the paired Bubble pager';
    }
    if (status >= 500) {
      return 'the bridge feed is unavailable right now';
    }
    if (err && err.message) {
      return err.message;
    }
    return 'network error while reading the feed';
  }

  function formatUnreachable(reason) {
    var trimmed = String(reason || '').trim();
    if (/^HTTP\\s+\\d{3}$/i.test(trimmed) || /^\\d{3}$/.test(trimmed)) {
      return 'Could not read the host activity feed — bridge returned ' + trimmed + '. Check pairing and bridge reachability.';
    }
    if (/^could not read the host activity feed/i.test(trimmed)) {
      return trimmed;
    }
    return 'Could not read the host activity feed — ' + trimmed;
  }

  function renderLines() {
    feedEl.innerHTML = lines.map(function (line) {
      return '<div class="host-line" data-feed-line="1">' + escapeHtml(line) + '</div>';
    }).join('');
    if (pinnedToBottom) {
      feedEl.scrollTop = feedEl.scrollHeight;
      jumpBtn.classList.remove('visible');
    }
  }

  function appendLine(line) {
    if (typeof line !== 'string' || line.length === 0) {
      return;
    }
    lines.push(line);
    renderLines();
  }

  function applyFeedBody(body) {
    if (!body || body.status === 'quiet') {
      setViewState('quiet');
      statusEl.textContent = 'Host is quiet — no host agent session is running.';
      lines = [];
      renderLines();
      return;
    }
    setViewState('working');
    statusEl.textContent = 'Host agent is working.';
    lines = Array.isArray(body.lines) ? body.lines.slice() : [];
    renderLines();
  }

  function showUnreachable(reason) {
    setViewState('unreachable');
    statusEl.textContent = formatUnreachable(reason);
    lines = [];
    renderLines();
  }

  function nearBottom() {
    return feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 48;
  }

  feedEl.addEventListener('scroll', function () {
    pinnedToBottom = nearBottom();
    jumpBtn.classList.toggle('visible', !pinnedToBottom && lines.length > 0);
  });

  jumpBtn.onclick = function () {
    pinnedToBottom = true;
    feedEl.scrollTop = feedEl.scrollHeight;
    jumpBtn.classList.remove('visible');
  };

  function attachHostActivityStream() {
    if (streamAbort) {
      streamAbort.abort();
    }
    streamAbort = new AbortController();
    document.body.setAttribute('data-live-push', 'attached');
    fetch('/events', { headers: authHeaders(), signal: streamAbort.signal })
      .then(function (res) {
        if (!res.ok || !res.body) {
          throw new Error('live push channel unavailable');
        }
        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = '';
        function pump() {
          return reader.read().then(function (chunk) {
            if (chunk.done) {
              document.body.setAttribute('data-live-push', 'closed');
              return;
            }
            buf += dec.decode(chunk.value, { stream: true });
            var parts = buf.split('\\n\\n');
            buf = parts.pop() || '';
            parts.forEach(function (block) {
              if (block.indexOf('event: host-activity') === -1) {
                return;
              }
              var dataLine = block.split('\\n').find(function (line) {
                return line.indexOf('data: ') === 0;
              });
              if (!dataLine) {
                return;
              }
              try {
                var payload = JSON.parse(dataLine.slice(6));
                if (document.body.getAttribute('data-host-state') !== 'working') {
                  setViewState('working');
                  statusEl.textContent = 'Host agent is working.';
                }
                appendLine(payload.line);
              } catch (_) {
                /* ignore malformed push */
              }
            });
            return pump();
          });
        }
        return pump();
      })
      .catch(function () {
        document.body.setAttribute('data-live-push', 'failed');
      });
  }

  function seedFromFeed() {
    return fetch('/host-activity', { cache: 'no-store', headers: authHeaders() })
      .then(function (res) {
        if (!res.ok) {
          throw Object.assign(new Error(humanUnreachableReason(null, res.status)), { status: res.status });
        }
        return res.json();
      })
      .then(function (body) {
        applyFeedBody(body);
        attachHostActivityStream();
      })
      .catch(function (err) {
        showUnreachable(err && err.message ? err.message : 'could not reach the bridge feed');
      });
  }

  seedFromFeed();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      seedFromFeed();
    }
  });
})();
</script>
</body>
</html>`;
}

export function isBubbleHostPath(url: string): boolean {
  const pathOnly = url.split('?', 1)[0];
  return pathOnly === '/host';
}
