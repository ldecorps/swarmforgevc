const vscode = acquireVsCodeApi();
const grid = document.getElementById('grid');
const status = document.getElementById('status');
const stageEl = document.getElementById('stage');
const placeholder = document.getElementById('placeholder');
const transportHealthEl = document.getElementById('transport-health');
const tiles = new Map();
let activeRole = null;
let selectedRole = null;
const openPrBtn = document.getElementById('open-pr-btn');
const bounceDrainBanner = document.getElementById('bounce-drain-banner');
const bounceDrainText = document.getElementById('bounce-drain-text');
const drainCancelBtn = document.getElementById('drain-cancel-btn');
const drainForceBtn = document.getElementById('drain-force-btn');
const bottomRowEl = document.getElementById('bottom-row');
const recentRunsEl = document.getElementById('recent-runs');
const runsListEl = document.getElementById('runs-list');
const runsToggleBtn = document.getElementById('runs-toggle');
const backlogEl = document.getElementById('backlog');
const backlogListEl = document.getElementById('backlog-list');
const backlogToggleBtn = document.getElementById('backlog-toggle');
const SCROLL_THRESHOLD = 8;
const holderMap = {};
let lastBacklogItems = [];
let resizeDebounceTimers = new Map();
const RESIZE_DEBOUNCE_MS = 300;

function updateBottomRow() {
  const hasRuns = recentRunsEl.style.display !== 'none';
  const hasBacklog = backlogEl.style.display !== 'none';
  bottomRowEl.style.display = (hasRuns || hasBacklog) ? '' : 'none';
}

function measureTilePaneRows(tile, output) {
  if (!tile || !output) {
    return null;
  }

  const rect = output.getBoundingClientRect();
  const pixelHeight = rect.height;

  if (pixelHeight <= 0) {
    return null;
  }

  const style = window.getComputedStyle(output);
  const lineHeightStr = style.lineHeight;
  const fontSizeStr = style.fontSize;

  let lineHeight;
  if (lineHeightStr === 'normal') {
    const fontSize = parseFloat(fontSizeStr);
    lineHeight = fontSize * 1.35;
  } else if (lineHeightStr.endsWith('px')) {
    lineHeight = parseFloat(lineHeightStr);
  } else {
    const fontSize = parseFloat(fontSizeStr);
    const lineHeightMultiplier = parseFloat(lineHeightStr);
    lineHeight = fontSize * lineHeightMultiplier;
  }

  if (lineHeight <= 0) {
    return null;
  }

  const paneRows = Math.floor(pixelHeight / lineHeight);
  return Math.max(1, paneRows);
}

function debouncedSendTilePaneSize(role, tile, output) {
  if (resizeDebounceTimers.has(role)) {
    clearTimeout(resizeDebounceTimers.get(role));
  }

  const timer = setTimeout(() => {
    const paneRows = measureTilePaneRows(tile, output);
    if (paneRows !== null) {
      vscode.postMessage({ type: 'fitTilePaneToHeight', role, paneRows });
    }
    resizeDebounceTimers.delete(role);
  }, RESIZE_DEBOUNCE_MS);

  resizeDebounceTimers.set(role, timer);
}

runsToggleBtn.addEventListener('click', () => {
  recentRunsEl.classList.toggle('collapsed');
  runsToggleBtn.textContent = recentRunsEl.classList.contains('collapsed') ? '▸' : '▾';
});

backlogToggleBtn.addEventListener('click', () => {
  backlogEl.classList.toggle('collapsed');
  backlogToggleBtn.textContent = backlogEl.classList.contains('collapsed') ? '▸' : '▾';
});

function renderRecentRuns(runs) {
  if (!runs || runs.length === 0) {
    recentRunsEl.style.display = 'none';
    updateBottomRow();
    return;
  }
  recentRunsEl.style.display = '';
  runsListEl.innerHTML = runs.map(r => {
    const date = r.startedAt ? r.startedAt.slice(0, 10) : '';
    const target = (r.targetPath || '').split('/').pop() || r.targetPath || '';
    const badge = r.status === 'running'
      ? '<span class="run-badge-running">● running</span>'
      : '<span class="run-badge-stopped">● stopped</span>';
    return '<div class="run-row"><span class="run-name">' + r.name + '</span>' +
      '<span class="run-target">' + target + '</span>' +
      '<span class="run-date">' + date + '</span>' + badge + '</div>';
  }).join('');
  updateBottomRow();
}

function backlogRowHtml(item) {
  let assignedDisplay = '';
  if (item.status === 'done') {
    // Done rows show their milestone (the done/ subfolder they live in).
    assignedDisplay = item.milestone ? '<span class="bl-milestone">' + item.milestone + '</span>' : '';
  } else if (item.status === 'active' && holderMap[item.id]) {
    // For active items, show the live holder (current role holding the parcel)
    assignedDisplay = '<span class="bl-assigned">' + holderMap[item.id] + '</span>';
  } else if (item.assignedTo) {
    // For todo items, show the intended assignee
    assignedDisplay = '<span class="bl-assigned">' + item.assignedTo + '</span>';
  }
  return '<div class="backlog-row">' +
    '<span class="bl-id">' + item.id + '</span>' +
    '<span class="bl-title">' + item.title + '</span>' +
    assignedDisplay + '</div>';
}

function filterByStatus(items, status) {
  return items.filter(i => i.status === status);
}

function renderBacklog(items) {
  if (!items || items.length === 0) {
    backlogEl.style.display = 'none';
    updateBottomRow();
    return;
  }
  backlogEl.style.display = '';
  const active = filterByStatus(items, 'active');
  const todo = filterByStatus(items, 'todo');
  const done = filterByStatus(items, 'done');
  let html = '';
  if (active.length > 0) {
    html += '<div class="bl-group-header">Active</div>' + active.map(backlogRowHtml).join('');
  }
  if (todo.length > 0) {
    html += '<div class="bl-group-header">Todo</div>' + todo.map(backlogRowHtml).join('');
  }
  if (done.length > 0) {
    html += '<details><summary class="backlog-done-summary">Done (' + done.length + ')</summary>' +
      done.map(backlogRowHtml).join('') + '</details>';
  }
  backlogListEl.innerHTML = html;
  updateBottomRow();
}

function detectFooterLineCount(text) {
  if (!text) return 0;

  const lines = text.split('\n');
  let footerStart = -1;

  // Scan from the bottom up to find the pinned footer
  // Strategy: locate the input prompt at the very end, then work up to find
  // status/permission lines that are part of the footer

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] || '';
    const trimmed = line.trim();

    // Empty lines at the very end don't count as part of the footer
    if (i === lines.length - 1 && trimmed === '') {
      continue;
    }

    // Input prompt line: starts with ❯ or >
    // "❯ type a message…", "> message", or a bare "❯ " when the input box is
    // empty — trim() strips the trailing space real captures leave on an
    // empty prompt, so the marker must also match at end-of-string.
    if (/^[❯>](\s|$)/.test(trimmed)) {
      footerStart = i;
      break;
    }
  }

  if (footerStart === -1) {
    return 0;
  }

  // Now scan up from the prompt to find other footer lines
  let footerEnd = footerStart;
  for (let i = footerStart - 1; i >= Math.max(0, footerStart - 5); i--) {
    const line = lines[i] || '';
    const trimmed = line.trim();

    // Skip empty lines
    if (trimmed === '') {
      continue;
    }

    // Permission/status line: contains [brackets] or single-word status
    if (/^\[.+\]|\[auto\]|\[.*permission/.test(trimmed)) {
      footerEnd = i;
      continue;
    }

    // Interrupt/help line: "esc to break" or similar
    if (/^esc\s+to|^.*interrupt|^.*break/i.test(trimmed)) {
      footerEnd = i;
      continue;
    }

    // If we hit a line that's clearly content (long, not status-like),
    // we've reached the end of the footer
    if (trimmed.length > 40 || !/^[[\-*@]/.test(trimmed)) {
      break;
    }
  }

  return lines.length - footerEnd;
}

function isAtBottom(el, contentText) {
  const footerLines = detectFooterLineCount(contentText || '');
  if (footerLines === 0) {
    // No footer detected, use original behavior
    return el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD;
  }

  // With footer: check if we're showing the live content just above the footer
  // The "bottom" is now the footer height away from the actual scroll bottom.
  // Line height comes from the rendered content (scrollHeight), not the
  // viewport (clientHeight), or the band is sized wrong (BL-055).
  const lineHeight = el.scrollHeight / (contentText ? contentText.split('\n').length : 1);
  const footerPixelHeight = footerLines * lineHeight;
  const liveContentBottom = el.scrollHeight - footerPixelHeight;
  const viewportBottom = el.scrollTop + el.clientHeight;

  return viewportBottom >= liveContentBottom - SCROLL_THRESHOLD;
}

function scrollToBottom(el, contentText) {
  const footerLines = detectFooterLineCount(contentText || '');
  if (footerLines === 0) {
    // No footer detected, use original behavior
    el.scrollTop = el.scrollHeight;
    return;
  }

  // With footer: scroll so the last live line is visible just above the footer
  const lines = (contentText || '').split('\n');
  const lineHeight = el.scrollHeight / (lines.length || 1);
  const footerPixelHeight = footerLines * lineHeight;
  const liveContentBottom = el.scrollHeight - footerPixelHeight;
  const targetScrollTop = Math.max(0, liveContentBottom - el.clientHeight + lineHeight);

  el.scrollTop = targetScrollTop;
}

function updateTileOutput(entry) {
  const el = entry.output;
  const priorScrollTop = el.scrollTop;
  el.textContent = entry.text;
  if (entry.tailLocked) {
    scrollToBottom(el, entry.text);
  } else {
    // The reader scrolled up: keep their place across the repaint (replacing
    // textContent can reset scrollTop; the browser clamps if content shrank).
    el.scrollTop = priorScrollTop;
  }
  // Remember where this update put the view, so the scroll event it fires is
  // not mistaken for the user scrolling (BL-055).
  entry.expectedScrollTop = el.scrollTop;
}

function handleTileScroll(entry, el) {
  if (entry.expectedScrollTop !== undefined && Math.abs(el.scrollTop - entry.expectedScrollTop) <= 1) {
    // A scroll event at the position the last output update produced is
    // content-driven, not the user; it must not toggle tail-lock.
    return;
  }
  entry.expectedScrollTop = undefined;
  entry.tailLocked = isAtBottom(el, entry.text);
}

function updateGridLayout(agentCount, roles) {
  grid.classList.remove('layout-2x2', 'layout-first-row');
  if (agentCount === 4) {
    grid.classList.add('layout-2x2');
  } else if (roles && roles.some(r => r.role === 'coordinator') && roles.some(r => r.role === 'specifier')) {
    grid.classList.add('layout-first-row');
  }
}

function isFirstRowRole(role) {
  return role === 'coordinator' || role === 'specifier';
}

function selectTile(role) {
  tiles.forEach((entry) => {
    entry.tile.classList.remove('selected');
  });
  if (selectedRole === role) {
    selectedRole = null;
    vscode.postMessage({ type: 'tileSelected', role: null });
  } else {
    selectedRole = role;
    const entry = tiles.get(role);
    if (entry) {
      entry.tile.classList.add('selected');
    }
    vscode.postMessage({ type: 'tileSelected', role });
  }
}

openPrBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'openPR' });
});

drainCancelBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'cancelBounceDrain' });
});

drainForceBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'forceBounceNow' });
});

document.addEventListener('keydown', (e) => {
  if (!activeRole) { return; }
  // Let copy/paste/select shortcuts pass through so text can be selected and copied
  if (e.ctrlKey && (e.key === 'c' || e.key === 'v' || e.key === 'a' || e.key === 'x')) { return; }
  if (e.metaKey && (e.key === 'c' || e.key === 'v' || e.key === 'a' || e.key === 'x')) { return; }
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
  tile.className = 'tile' + (isFirstRowRole(role) ? ' first-row' : '');
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

  const blBadge = document.createElement('span');
  blBadge.className = 'tile-bl-badge';

  const header = document.createElement('div');
  header.className = 'tile-header';
  header.innerHTML = '<span>' + displayName + '</span><span class="tile-agent">' + agent + '</span>';
  header.appendChild(blBadge);
  header.appendChild(nudgeBtn);
  header.appendChild(restartBtn);
  header.addEventListener('click', (e) => {
    if (e.target !== nudgeBtn && e.target !== restartBtn && !nudgeBtn.contains(e.target) && !restartBtn.contains(e.target)) {
      selectTile(role);
    }
  });

  const output = document.createElement('div');
  output.className = 'tile-output';
  output.tabIndex = 0;
  output.dataset.role = role;

  const entry = { tile, output, blBadge, text: '', tailLocked: true };

  output.addEventListener('focus', () => {
    activeRole = role;
  });

  output.addEventListener('scroll', () => {
    handleTileScroll(entry, output);
  }, { passive: true });

  // Watch for tile resizes and send new pane size to host
  const resizeObserver = new ResizeObserver(() => {
    debouncedSendTilePaneSize(role, tile, output);
  });
  resizeObserver.observe(output);

  // Send initial tile size
  setTimeout(() => {
    debouncedSendTilePaneSize(role, tile, output);
  }, 100);

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
      updateGridLayout(message.roles.length, message.roles);
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
    case 'needsHuman':
      message.events.forEach((e) => {
        const entry = tiles.get(e.role);
        if (entry) {
          if (e.needsHuman) {
            entry.tile.classList.add('needs-human');
            entry.tile.classList.remove('stalled');
          } else {
            entry.tile.classList.remove('needs-human');
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
      lastBacklogItems = message.items;
      renderBacklog(message.items);
      break;
    case 'holderUpdate':
      Object.assign(holderMap, message.holders);
      // Re-render backlog to update "Assigned" labels with live holders
      if (backlogEl.style.display !== 'none') {
        renderBacklog(lastBacklogItems);
      }
      break;
    case 'highlightTile':
      tiles.forEach((entry, role) => {
        if (role === message.role) {
          entry.tile.classList.add('bl-highlighted');
          setTimeout(() => entry.tile.classList.remove('bl-highlighted'), 2000);
        }
      });
      break;
    case 'transportHealth':
      if (transportHealthEl) {
        const health = message.health || {};
        const detail = health.detail ? ' (' + health.detail + ')' : '';
        transportHealthEl.classList.remove('warn', 'down');
        if (health.state === 'persistent-failure') {
          transportHealthEl.classList.add('down');
          transportHealthEl.textContent = '✖ handoff transport DOWN' + detail;
        } else if (health.state === 'restarting') {
          transportHealthEl.classList.add('warn');
          transportHealthEl.textContent = '⚠ handoff transport restarting' + detail;
        } else {
          // healthy or unknown: no alarm
          transportHealthEl.textContent = '';
        }
      }
      break;
    case 'bounceDrain':
      if (message.draining) {
        const busy = message.busyRoles || [];
        bounceDrainBanner.classList.add('visible');
        bounceDrainText.textContent =
          'Draining: ' + busy.length + ' of ' + (message.totalRoles || 0) + ' agent(s) still busy';
        tiles.forEach((entry, role) => {
          entry.tile.classList.toggle('drain-idle', !busy.includes(role));
        });
      } else {
        bounceDrainBanner.classList.remove('visible');
        tiles.forEach((entry) => entry.tile.classList.remove('drain-idle'));
      }
      break;
    case 'badgeUpdate':
      tiles.forEach((entry, role) => {
        const badge = message.badges[role];
        if (badge) {
          entry.tile.classList.add('bl-active');
          const badgeText = badge.summary ? `${badge.id} · ${badge.summary}` : badge.id || badge;
          entry.blBadge.textContent = badgeText;
        } else {
          entry.tile.classList.remove('bl-active');
          entry.blBadge.textContent = '';
        }
      });
      break;
    case 'restoreSelection':
      if (message.role) {
        selectTile(message.role);
      }
      break;
  }
});

vscode.postMessage({ type: 'refresh' });
