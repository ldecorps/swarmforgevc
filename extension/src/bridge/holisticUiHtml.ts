// BL-094: the holistic dev-state web UI, served as a single self-contained
// HTML document (inline CSS/JS, no external fetch, no CDN, no build step -
// matches the ticket's own "static asset bundle... self-contained" scope
// note). This is presentation code (the testability-unsuitable boundary the
// ticket itself calls out); every fact it renders comes from a bridge JSON
// endpoint via client-side fetch, nothing is computed or stored here beyond
// the page-lifetime bearer token the user supplies (no localStorage/
// sessionStorage, per the ticket's explicit constraint).
export function getHolisticUiHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SwarmForge — dev state</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 1.5rem; background: Canvas; color: CanvasText; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  h2 { font-size: 1rem; margin: 0 0 0.5rem; }
  section { border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); border-radius: 6px; padding: 1rem; margin-bottom: 1rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { text-align: left; padding: 0.25rem 0.5rem; border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent); }
  .badge { display: inline-block; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.75rem; background: color-mix(in srgb, CanvasText 12%, transparent); }
  .badge.remote { background: color-mix(in srgb, orange 30%, transparent); }
  .stale { opacity: 0.6; font-style: italic; }
  #tokenGate { max-width: 28rem; margin: 4rem auto; text-align: center; }
  #tokenGate input { width: 100%; padding: 0.5rem; font-size: 1rem; box-sizing: border-box; }
  #status { font-size: 0.8rem; opacity: 0.7; }
  #app { display: none; }
</style>
</head>
<body>
<div id="tokenGate">
  <h1>SwarmForge — dev state</h1>
  <p>Enter the bearer token shown when the bridge was started.</p>
  <input id="tokenInput" type="password" placeholder="bearer token" autocomplete="off">
  <p id="tokenError" style="color: crimson;"></p>
</div>

<div id="app">
  <h1>SwarmForge — holistic dev state <span id="status"></span></h1>
  <div class="grid">
    <section>
      <h2>Backlog board</h2>
      <div id="backlogBoard"></div>
    </section>
    <section>
      <h2>Per-swarm panel</h2>
      <div id="swarmPanel"></div>
    </section>
    <section>
      <h2>Pipeline flow</h2>
      <div id="pipelineFlow"></div>
    </section>
    <section>
      <h2>Recent activity</h2>
      <div id="recentActivity"></div>
    </section>
  </div>
</div>

<script>
(function () {
  'use strict';
  // Read-only: no control endpoints are ever called from this page.
  var token = null;

  function authHeaders() {
    return { authorization: 'Bearer ' + token };
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) { node.setAttribute(k, attrs[k]); }
    }
    (children || []).forEach(function (c) {
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function renderBacklogBoard(backlog, assignments, doneByMilestone) {
    var container = document.getElementById('backlogBoard');
    container.innerHTML = '';
    var assignmentById = {};
    (assignments || []).forEach(function (a) { assignmentById[a.ticketId] = a; });

    var table = el('table', {}, [
      el('tr', {}, [el('th', {}, ['ticket']), el('th', {}, ['stage']), el('th', {}, ['swarm'])]),
    ]);
    (backlog.active || []).forEach(function (item) {
      var a = assignmentById[item.id];
      var swarmBadge = a && !a.isLocal ? el('span', { class: 'badge remote' }, [a.swarm + ' (remote)']) : el('span', { class: 'badge' }, [(a && a.swarm) || 'primary']);
      table.appendChild(el('tr', {}, [
        el('td', {}, [item.id + ' - ' + item.title]),
        el('td', {}, [(a && a.stageRole) || (a && a.isLocal === false ? 'unknown (remote)' : 'queued')]),
        el('td', {}, [swarmBadge]),
      ]));
    });
    container.appendChild(table);

    var milestones = Object.keys(doneByMilestone || {}).sort();
    var doneSummary = el('p', {}, ['Done: ' + milestones.map(function (m) { return m + ' (' + doneByMilestone[m].length + ')'; }).join(', ')]);
    container.appendChild(doneSummary);
  }

  function renderSwarmPanel(swarms) {
    var container = document.getElementById('swarmPanel');
    container.innerHTML = '';
    (swarms || []).forEach(function (swarm) {
      var heading = el('h3', {}, [swarm.name + (swarm.isLocal ? ' (local, live)' : ' (remote, git-derived)')]);
      container.appendChild(heading);
      var table = el('table', {}, [el('tr', {}, [el('th', {}, ['role']), el('th', {}, ['status'])])]);
      (swarm.agents || []).forEach(function (agent) {
        table.appendChild(el('tr', {}, [el('td', {}, [agent.displayName]), el('td', {}, [agent.status])]));
      });
      container.appendChild(table);
    });
  }

  function renderPipelineFlow(pipeline) {
    var container = document.getElementById('pipelineFlow');
    container.innerHTML = '';
    var table = el('table', {}, [el('tr', {}, [el('th', {}, ['role']), el('th', {}, ['status'])])]);
    (pipeline || []).forEach(function (stage) {
      table.appendChild(el('tr', {}, [el('td', {}, [stage.displayName]), el('td', {}, [stage.status])]));
    });
    container.appendChild(table);
  }

  function renderRecentActivity(activity, runLog) {
    var container = document.getElementById('recentActivity');
    container.innerHTML = '';
    var run = (activity && activity.currentRun) || (runLog && runLog[runLog.length - 1]);
    container.appendChild(el('p', {}, ['Current run: ' + (run ? run.name : 'none')]));

    var closesHeading = el('h3', {}, ['Recently closed']);
    container.appendChild(closesHeading);
    var closesList = el('ul', {});
    ((activity && activity.recentCloses) || []).forEach(function (c) {
      closesList.appendChild(el('li', {}, [c.ticketId + ' - ' + c.closeDateIso]));
    });
    container.appendChild(closesList);

    var mergesHeading = el('h3', {}, ['Recent merges']);
    container.appendChild(mergesHeading);
    var mergesList = el('ul', {});
    ((activity && activity.recentMerges) || []).forEach(function (m) {
      mergesList.appendChild(el('li', {}, [m.subject]));
    });
    container.appendChild(mergesList);
  }

  function fetchJson(path) {
    return fetch(path, { headers: authHeaders() }).then(function (res) {
      if (!res.ok) { throw new Error(path + ' -> ' + res.status); }
      return res.json();
    });
  }

  function renderAll(state, holistic) {
    renderBacklogBoard(state.backlog, holistic.assignments, holistic.doneByMilestone);
    renderSwarmPanel(holistic.swarms);
    renderPipelineFlow(state.pipeline);
    renderRecentActivity(holistic.recentActivity, state.runLog);
    document.getElementById('status').textContent = '(updated ' + new Date().toLocaleTimeString() + ')';
  }

  function loadOnce() {
    return Promise.all([
      fetchJson('/pipeline').then(function (pipeline) {
        return fetchJson('/agents').then(function (agents) {
          return fetchJson('/backlog').then(function (backlog) {
            return fetchJson('/runlog').then(function (runLog) {
              return { pipeline: pipeline, agents: agents, backlog: backlog, runLog: runLog };
            });
          });
        });
      }),
      fetchJson('/holistic'),
    ]).then(function (results) {
      renderAll(results[0], results[1]);
    });
  }

  // /events pushes BridgeState (pipeline/agents/backlog/runlog) on change -
  // re-render those sections live; /holistic (git/handoff-derived, expensive)
  // is refreshed on load only, matching the endpoint's own polling posture.
  function subscribeEvents(initialHolistic) {
    var holistic = initialHolistic;
    fetch('/events', { headers: authHeaders() }).then(function (res) {
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) { return; }
          buffer += decoder.decode(result.value, { stream: true });
          var chunks = buffer.split('\\n\\n');
          buffer = chunks.pop();
          chunks.forEach(function (chunk) {
            if (chunk.indexOf('data: ') !== 0) { return; }
            try {
              var state = JSON.parse(chunk.slice(6));
              renderAll(state, holistic);
            } catch (e) { /* ignore a malformed/partial chunk */ }
          });
          return pump();
        });
      }
      return pump();
    }).catch(function () {
      document.getElementById('status').textContent = '(live updates unavailable - refresh manually)';
    });
  }

  function unlock() {
    document.getElementById('tokenGate').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    loadOnce().then(function () {
      return fetchJson('/holistic');
    }).then(subscribeEvents).catch(function (err) {
      document.getElementById('status').textContent = '(failed to load: ' + err.message + ')';
    });
  }

  var params = new URLSearchParams(window.location.search);
  var urlToken = params.get('token');
  if (urlToken) {
    token = urlToken;
    // Never persist the token anywhere (no storage APIs) and strip it from
    // the visible URL/history once captured into the page-lifetime variable.
    window.history.replaceState({}, '', window.location.pathname);
    unlock();
  } else {
    document.getElementById('tokenInput').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') { return; }
      token = e.target.value;
      unlock();
    });
  }
})();
</script>
</body>
</html>
`;
}
