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
const metricsEl = document.getElementById('metrics');
const metricsListEl = document.getElementById('metrics-list');
const metricsToggleBtn = document.getElementById('metrics-toggle');
const SCROLL_THRESHOLD = 8;
const holderMap = {};
let lastBacklogItems = [];
let resizeDebounceTimers = new Map();
const RESIZE_DEBOUNCE_MS = 300;

function updateBottomRow() {
  const hasRuns = recentRunsEl.style.display !== 'none';
  const hasBacklog = backlogEl.style.display !== 'none';
  const hasMetrics = metricsEl.style.display !== 'none';
  bottomRowEl.style.display = (hasRuns || hasBacklog || hasMetrics) ? '' : 'none';
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

metricsToggleBtn.addEventListener('click', () => {
  metricsEl.classList.toggle('collapsed');
  metricsToggleBtn.textContent = metricsEl.classList.contains('collapsed') ? '▸' : '▾';
});

// BL-034: delegated on the stable list container, not per-row, since
// renderBacklog replaces backlogListEl's innerHTML on every poll.
backlogListEl.addEventListener('click', (event) => {
  const button = event.target.closest('.bl-mark-done');
  if (button) {
    vscode.postMessage({ type: 'markBacklogDone', id: button.dataset.id });
  }
});

backlogListEl.addEventListener('change', (event) => {
  const select = event.target.closest('.bl-assignee-select');
  if (select) {
    vscode.postMessage({ type: 'setBacklogAssignee', id: select.dataset.id, assignedTo: select.value });
  }
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

// BL-071: mirrors metrics/swarmMetrics.ts's formatDurationMs. The webview
// cannot import the host's TS module (two-layer rule — host and webview
// communicate only by message passing), so the tiny formatting helper is
// duplicated here; the VALUES themselves always come from that one module.
function formatDurationMs(ms) {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? minutes + 'm' : hours + 'h ' + minutes + 'm';
}

// BL-078: mirrors metrics/swarmMetrics.ts's formatSuiteDurationMs, same
// reason formatDurationMs above is duplicated here (two-layer rule).
function formatSuiteDurationMs(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? seconds + 's' : minutes + 'm ' + seconds + 's';
}

function suiteDurationLineHtml(suite) {
  if (suite.latestMs === null) {
    return '<div class="metric-row"><span class="metric-label">Suite duration</span><span class="metric-value">—</span></div>';
  }
  const valueClass = suite.warn ? 'metric-value metric-value-warn' : 'metric-value';
  const label = suite.warn ? 'Suite duration (WARN)' : 'Suite duration';
  return '<div class="metric-row"><span class="metric-label">' + label + '</span><span class="' + valueClass + '">' +
    formatSuiteDurationMs(suite.latestMs) + ' / mean ' + formatSuiteDurationMs(suite.meanMs) +
    ' over ' + suite.sampleCount + ' run(s)</span></div>';
}

function renderMetrics(metrics, roles) {
  metricsEl.style.display = '';
  const meanLine = metrics.meanTicketTimeMs === null
    ? '<div class="metric-row"><span class="metric-label">Mean ticket time</span><span class="metric-value">—</span></div>'
    : '<div class="metric-row"><span class="metric-label">Mean ticket time</span><span class="metric-value">' +
      formatDurationMs(metrics.meanTicketTimeMs) + ' / ' + metrics.ticketSampleCount + ' tickets</span></div>';

  const busynessLines = (roles || []).map((role) => {
    const pct = Math.round((metrics.busyness[role] || 0) * 100);
    return '<div class="metric-row"><span class="metric-label">' + role + '</span><span class="metric-value">' + pct + '%</span></div>';
  }).join('');

  const retryLine = '<div class="metric-row"><span class="metric-label">Retries</span><span class="metric-value">' +
    metrics.retryTotal + '</span></div>';

  const suiteLine = suiteDurationLineHtml(metrics.suiteDuration);

  metricsListEl.innerHTML = meanLine + busynessLines + retryLine + suiteLine;
  updateBottomRow();
}

// BL-077: one stable color class per pipeline stage, plus neutral classes
// for "queued" (promoted, unrouted) and "done", so the tile-header badge and
// the BACKLOG row chip always agree on the color for a given holder. Keyed
// lowercase so 'QA' and 'qa' (and any other holder-string casing) resolve to
// the same class. The map is inlined (not a module-level const) so the
// function is self-contained for extractPanelFunction-based unit tests.
function stageColorClass(holder) {
  const STAGE_COLOR_CLASSES = {
    specifier: 'stage-color-specifier',
    coder: 'stage-color-coder',
    cleaner: 'stage-color-cleaner',
    architect: 'stage-color-architect',
    hardender: 'stage-color-hardender',
    documenter: 'stage-color-documenter',
    qa: 'stage-color-qa',
    coordinator: 'stage-color-coordinator',
    queued: 'stage-color-queued',
    done: 'stage-color-done',
  };
  const key = (holder || 'queued').toLowerCase();
  return STAGE_COLOR_CLASSES[key] || STAGE_COLOR_CLASSES.queued;
}

function backlogRowHtml(item) {
  let assignedDisplay = '';
  let controls = '';
  if (item.status === 'done') {
    // Done rows show their milestone, tinted "done"-neutral (BL-077).
    assignedDisplay = item.milestone
      ? '<span class="bl-milestone ' + stageColorClass('done') + '">' + item.milestone + '</span>'
      : '';
  } else if (item.status === 'active') {
    // Active rows show LIVE traceability only: the role actually holding the
    // parcel, or "queued" when it is promoted but not yet routed. Never fall
    // back to the static assignedTo YAML field here — that fallback was
    // exactly the misleading display reported (BL-072): a promoted-but-
    // unrouted ticket showed its intake-time assignee as if it were holding
    // the parcel.
    const holder = holderMap[item.id] || 'queued';
    // BL-077: tint the chip with the holder's stage color (or the neutral
    // "queued" color when unrouted) — the same resolver-driven holder value
    // the tile badge below uses, so the two surfaces never disagree.
    assignedDisplay = '<span class="bl-assigned ' + stageColorClass(holder) + '">' + holder + '</span>';
    // BL-034: field-level panel -> disk writes. assigned_to here is the
    // static YAML field (separate from the live holder above), and marking
    // done is a folder move the host performs; both go through the
    // extension host, never touching the filesystem from the webview.
    const assigneeOptions = [...tiles.keys()].map((role) =>
      '<option value="' + role + '"' + (role === item.assignedTo ? ' selected' : '') + '>' + role + '</option>'
    ).join('');
    controls = '<select class="bl-assignee-select" data-id="' + item.id + '">' + assigneeOptions + '</select>' +
      '<button class="bl-mark-done" data-id="' + item.id + '">Done</button>';
  } else if (item.assignedTo) {
    // For todo items, show the intended assignee
    assignedDisplay = '<span class="bl-assigned">' + item.assignedTo + '</span>';
  }
  return '<div class="backlog-row">' +
    '<span class="bl-id">' + item.id + '</span>' +
    '<span class="bl-title">' + item.title + '</span>' +
    assignedDisplay + controls + '</div>';
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

  // Clicking the output area is the operator's only way to target a tile
  // for keyboard input since BL-046 removed the per-tile input bar. Do not
  // rely solely on the browser's default click-to-focus behavior for a
  // tabIndex div (BL-085) - focus explicitly so a click always activates
  // the tile, which also fires the 'focus' listener above.
  output.addEventListener('click', () => {
    output.focus();
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
    case 'metricsUpdate':
      renderMetrics(message.metrics, message.roles);
      break;
    case 'holderUpdate':
      // Replace, not merge: the host recomputes the full live-holder set
      // every poll and only includes an id when a holder actually resolves,
      // so a ticket that becomes unrouted again must lose its stale entry
      // here too, not keep showing whoever held it last (BL-072).
      for (const key of Object.keys(holderMap)) {
        delete holderMap[key];
      }
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
        // BL-121: health.state now reflects DELIVERY, not just daemon
        // process liveness — 'broken'/'delivery-degraded' can fire even
        // while the daemon heartbeats healthy (a dead-lettered or stalled
        // parcel, or a missed canary).
        const health = message.health || {};
        const offending = health.offending || [];
        const detail = offending.length
          ? ' (' + offending.map((o) => o.route + ': ' + o.reason).join(', ') + ')'
          : '';
        transportHealthEl.classList.remove('warn', 'down');
        if (health.state === 'broken') {
          transportHealthEl.classList.add('down');
          transportHealthEl.textContent = '✖ handoff transport DOWN' + detail;
        } else if (health.state === 'delivery-degraded') {
          transportHealthEl.classList.add('warn');
          transportHealthEl.textContent = '⚠ handoff transport degraded' + detail;
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
          const idSummary = badge.summary ? `${badge.id} · ${badge.summary}` : badge.id || badge;
          // A role holding more than one active parcel (e.g. a hardender
          // batch) shows the lowest ticket ID plus a +N count for the rest
          // instead of silently dropping them (BL-068).
          entry.blBadge.textContent = badge.extraCount ? `${idSummary} +${badge.extraCount}` : idSummary;
          // BL-077: the badge is only ever shown on the tile whose role IS
          // the live holder, so that role is the stage color to apply.
          entry.blBadge.className = 'tile-bl-badge ' + stageColorClass(role);
        } else {
          entry.tile.classList.remove('bl-active');
          entry.blBadge.textContent = '';
          entry.blBadge.className = 'tile-bl-badge';
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
