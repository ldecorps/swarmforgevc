const vscode = acquireVsCodeApi();
const grid = document.getElementById('grid');
const status = document.getElementById('status');
const stageEl = document.getElementById('stage');
const placeholder = document.getElementById('placeholder');
const tiles = new Map();
let activeRole = null;
const openPrBtn = document.getElementById('open-pr-btn');
const recentRunsEl = document.getElementById('recent-runs');
const runsListEl = document.getElementById('runs-list');
const backlogEl = document.getElementById('backlog');
const backlogListEl = document.getElementById('backlog-list');
const SCROLL_THRESHOLD = 8;

function renderRecentRuns(runs) {
  if (!runs || runs.length === 0) {
    recentRunsEl.style.display = 'none';
    return;
  }
  recentRunsEl.style.display = '';
  runsListEl.innerHTML = runs.map(r => {
    const date = r.startedAt ? r.startedAt.slice(0, 10) : '';
    const target = (r.targetPath || '').split('/').pop() || r.targetPath || '';
    const badge = r.status === 'running'
      ? '<span class="run-badge-running">● running</span>'
      : '<span class="run-badge-stopped">● stopped</span>';
    return '<div class="run-row"><span class="run-name">' + r.name + '</span><span class="run-target">' + target + '</span><span class="run-date">' + date + '</span>' + badge + '</div>';
  }).join('');
}

function badgeHtml(status) {
  return '<span class="bl-badge bl-badge-' + status + '">' + status + '</span>';
}

function backlogRowHtml(item) {
  const assigned = item.assignedTo ? '<span class="bl-assigned">' + item.assignedTo + '</span>' : '';
  return '<div class="backlog-row">' + badgeHtml(item.status) +
    '<span class="bl-id">' + item.id + '</span>' +
    '<span class="bl-title">' + item.title + '</span>' +
    assigned + '</div>';
}

function filterByStatus(items, status) {
  return items.filter(i => i.status === status);
}

function renderBacklog(items) {
  if (!items || items.length === 0) {
    backlogEl.style.display = 'none';
    return;
  }
  backlogEl.style.display = '';
  const active = filterByStatus(items, 'active');
  const todo = filterByStatus(items, 'todo');
  const done = filterByStatus(items, 'done');
  const topRows = [...active, ...todo].map(backlogRowHtml).join('');
  let doneSection = '';
  if (done.length > 0) {
    doneSection = '<details><summary class="backlog-done-summary">Done (' + done.length + ')</summary>' +
      done.map(backlogRowHtml).join('') + '</details>';
  }
  backlogListEl.innerHTML = topRows + doneSection;
}

function isAtBottom(el) {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD;
}

function scrollToBottom(el) {
  el.scrollTop = el.scrollHeight;
}

function updateTileOutput(entry) {
  entry.output.textContent = entry.text;
  if (entry.tailLocked) {
    scrollToBottom(entry.output);
  }
}

function updateGridLayout(agentCount) {
  grid.classList.remove('layout-2x2');
  if (agentCount === 4) {
    grid.classList.add('layout-2x2');
  }
}

openPrBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'openPR' });
});

document.addEventListener('keydown', (e) => {
  if (!activeRole) { return; }
  e.preventDefault();
  if (e.ctrlKey && e.key.length === 1) {
    const code = e.key.toLowerCase().charCodeAt(0) - 96;
    if (code >= 1 && code <= 26) {
      vscode.postMessage({ type: 'input', role: activeRole, data: String.fromCharCode(code) });
    }
    return;
  }
  if (e.key.length === 1 && !e.metaKey && !e.altKey) {
    vscode.postMessage({ type: 'input', role: activeRole, data: e.key });
  } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
    vscode.postMessage({ type: 'specialKey', role: activeRole, key: e.key });
  }
});

function ensureTile(role, displayName, agent) {
  if (tiles.has(role)) {
    return tiles.get(role);
  }

  if (placeholder) {
    placeholder.remove();
  }

  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.role = role;

  const nudgeBtn = document.createElement('button');
  nudgeBtn.className = 'nudge-btn';
  nudgeBtn.textContent = 'Nudge';
  nudgeBtn.addEventListener('click', () => {
    tile.classList.remove('stalled');
    vscode.postMessage({ type: 'input', role, data: '\n' });
  });

  const restartBtn = document.createElement('button');
  restartBtn.className = 'restart-btn';
  restartBtn.textContent = 'Restart';
  restartBtn.addEventListener('click', () => {
    tile.classList.remove('dead');
    vscode.postMessage({ type: 'restartAgent', role });
  });

  const header = document.createElement('div');
  header.className = 'tile-header';
  header.innerHTML = '<span>' + displayName + '</span><span class="tile-agent">' + agent + '</span>';
  header.appendChild(nudgeBtn);
  header.appendChild(restartBtn);

  const output = document.createElement('div');
  output.className = 'tile-output';
  output.tabIndex = 0;
  output.dataset.role = role;

  const entry = { tile, output, text: '', tailLocked: true };

  output.addEventListener('focus', () => {
    activeRole = role;
  });

  output.addEventListener('scroll', () => {
    entry.tailLocked = isAtBottom(output);
  }, { passive: true });

  tile.appendChild(header);
  tile.appendChild(output);
  grid.appendChild(tile);

  tiles.set(role, entry);
  return entry;
}

window.addEventListener('message', (event) => {
  const message = event.data;
  switch (message.type) {
    case 'roles':
      status.textContent = message.roles.length + ' agent(s)';
      message.roles.forEach((r) => ensureTile(r.role, r.displayName, r.agent));
      updateGridLayout(message.roles.length);
      break;
    case 'output':
      message.updates.forEach((u) => {
        const entry = ensureTile(u.role, u.displayName, u.role);
        if (u.full) {
          entry.text = u.text;
        } else {
          entry.text += u.text;
        }
        entry.tile.classList.remove('stalled');
        updateTileOutput(entry);
      });
      break;
    case 'stage':
      if (stageEl) {
        stageEl.textContent = message.label !== 'idle' ? 'Stage: ' + message.label : '';
      }
      if (message.recentRuns !== undefined) {
        renderRecentRuns(message.recentRuns);
      }
      break;
    case 'dead':
      message.events.forEach((e) => {
        const entry = tiles.get(e.role);
        if (entry) {
          if (e.dead) {
            entry.tile.classList.add('dead');
          } else {
            entry.tile.classList.remove('dead');
          }
        }
      });
      break;
    case 'stall':
      message.events.forEach((e) => {
        const entry = tiles.get(e.role);
        if (entry) {
          if (e.stalled) {
            entry.tile.classList.add('stalled');
          } else {
            entry.tile.classList.remove('stalled');
          }
        }
      });
      break;
    case 'swarmDone':
      openPrBtn.classList.add('visible');
      if (stageEl) {
        stageEl.textContent = 'Swarm finished';
      }
      break;
    case 'backlogUpdate':
      renderBacklog(message.items);
      break;
  }
});

vscode.postMessage({ type: 'refresh' });
