const NONCE_LENGTH = 32;
const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function getNonce(): string {
  let text = '';
  for (let i = 0; i < NONCE_LENGTH; i++) {
    text += NONCE_CHARS.charAt(Math.floor(Math.random() * NONCE_CHARS.length));
  }
  return text;
}

export function getWorkTreeHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SwarmForge Work Tree</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 12px;
    }
    h1 { font-size: 14px; font-weight: 600; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th {
      text-align: left; padding: 4px 8px;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 11px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.04em;
    }
    td { padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border, #333); vertical-align: top; }
    tr.done td { opacity: 0.45; text-decoration: line-through; }
    tr.active { cursor: pointer; }
    tr.active:hover td { background: var(--vscode-list-hoverBackground); }
    .badge {
      display: inline-block; padding: 1px 6px; border-radius: 3px;
      font-size: 10px; text-align: center;
    }
    .badge-active { background: #2e7d32; color: #fff; }
    .badge-done { background: #333; color: #888; }
    .badge-todo { background: #555; color: #ccc; }
    .commit-hash { font-family: monospace; opacity: 0.7; font-size: 11px; }
    .empty { padding: 24px; opacity: 0.6; }
  </style>
</head>
<body>
  <h1>Work Tree</h1>
  <div id="content"><div class="empty">Loading…</div></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    function escapeHtml(text) {
      const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
      return text.replace(/[&<>"']/g, (c) => map[c]);
    }

    function badge(status) {
      return '<span class="badge badge-' + escapeHtml(status) + '">' + escapeHtml(status) + '</span>';
    }

    function renderItems(items) {
      if (!items || items.length === 0) {
        return '<div class="empty">No backlog items found.</div>';
      }
      const rows = items.map(item => {
        const cls = item.status === 'done' ? 'done' : (item.status === 'active' ? 'active' : '');
        const role = item.assignedTo || '';
        const commit = item.lastCommit
          ? '<span class="commit-hash" title="' + escapeHtml(item.lastCommit.message) + '">' + escapeHtml(item.lastCommit.hash) + '</span>'
          : '—';
        const clickAttr = item.status === 'active' && role
          ? ' onclick="highlight(\'' + escapeHtml(role) + '\')"'
          : '';
        return '<tr class="' + cls + '"' + clickAttr + '>' +
          '<td>' + badge(item.status) + '</td>' +
          '<td>' + escapeHtml(item.id) + '</td>' +
          '<td>' + escapeHtml(item.title) + '</td>' +
          '<td>' + (item.milestone ? escapeHtml(item.milestone) : '—') + '</td>' +
          '<td>' + (item.priority != null ? item.priority : '—') + '</td>' +
          '<td>' + (item.assignedTo ? escapeHtml(item.assignedTo) : '—') + '</td>' +
          '<td>' + commit + '</td>' +
          '</tr>';
      }).join('');
      return '<table>' +
        '<thead><tr><th>Status</th><th>ID</th><th>Title</th><th>Milestone</th><th>Priority</th><th>Assigned</th><th>Last commit</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '</table>';
    }

    function highlight(role) {
      vscode.postMessage({ type: 'highlightTile', role });
    }

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'update') {
        document.getElementById('content').innerHTML = renderItems(msg.items);
      }
    });
  </script>
</body>
</html>`;
}

export function getWebviewHtml(scriptUri: string, cspSource: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SwarmForge</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }
    header h1 {
      font-size: 14px;
      font-weight: 600;
    }
    header .status {
      font-size: 12px;
      opacity: 0.8;
    }
    header .stage {
      font-size: 12px;
      margin-left: auto;
      opacity: 0.7;
    }
    #grid {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 8px;
      padding: 8px;
      overflow: auto;
      align-content: start;
    }
    #grid.layout-2x2 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      grid-template-rows: repeat(2, minmax(0, 1fr));
      align-content: stretch;
      overflow: hidden;
    }
    #grid.layout-2x2 .tile {
      min-height: 0;
    }
    #grid.layout-first-row {
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 8px;
      align-content: start;
      overflow: hidden;
    }
    .tile {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      min-height: 240px;
      background: var(--vscode-terminal-background, #1e1e1e);
    }
    #grid.layout-first-row .tile {
      min-height: 0;
    }
    #grid.layout-first-row [data-role="coordinator"],
    #grid.layout-first-row [data-role="specifier"] {
      grid-column: span 2;
    }
    .tile.selected {
      grid-column: span 2;
      grid-row: span 2;
    }
    .tile-header {
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 600;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-titleBar-activeBackground);
      display: flex;
      justify-content: space-between;
    }
    .tile-agent {
      opacity: 0.7;
      font-weight: 400;
    }
    .tile-bl-badge {
      display: none;
      margin-left: 6px;
      padding: 1px 6px;
      font-size: 10px;
      border-radius: 3px;
      background: #1565c0;
      color: #fff;
      font-weight: 500;
    }
    .tile.bl-active .tile-bl-badge {
      display: inline-block;
    }
    .tile.bl-highlighted {
      border-color: var(--vscode-focusBorder, #007fd4);
      box-shadow: 0 0 0 2px var(--vscode-focusBorder, #007fd4);
    }
    .tile-output {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 6px 8px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      line-height: 1.35;
      white-space: pre-wrap;
      word-break: break-all;
      cursor: text;
      outline: none;
      user-select: text;
      -webkit-user-select: text;
    }
    .tile-output:focus {
      box-shadow: inset 0 0 0 1px var(--vscode-focusBorder);
    }
    .empty {
      padding: 24px;
      text-align: center;
      opacity: 0.7;
    }
    .tile.stalled {
      border-color: #d4a017;
    }
    .tile.dead {
      border-color: #e53935;
    }
    /* Border-only pulse (BL-054): animating opacity would fade the tile's
       text along with the border, so only border-color breathes. */
    @keyframes needs-human-blink {
      0%, 100% {
        border-color: #00a8e8;
      }
      50% {
        border-color: rgba(0, 168, 232, 0.35);
      }
    }
    .tile.needs-human:not(.dead) {
      animation: needs-human-blink 1.5s ease-in-out infinite;
    }
    .restart-btn {
      display: none;
      margin-left: 6px;
      padding: 1px 7px;
      font-size: 11px;
      cursor: pointer;
      background: #e53935;
      color: #fff;
      border: none;
      border-radius: 3px;
    }
    .tile.dead .restart-btn {
      display: inline-block;
    }
    .nudge-btn {
      display: none;
      margin-left: 6px;
      padding: 1px 7px;
      font-size: 11px;
      cursor: pointer;
      background: #d4a017;
      color: #000;
      border: none;
      border-radius: 3px;
    }
    .tile.stalled .nudge-btn {
      display: inline-block;
    }
    #open-pr-btn {
      display: none;
      padding: 4px 10px;
      font-size: 12px;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 3px;
    }
    #open-pr-btn.visible {
      display: inline-block;
    }
    #bottom-row {
      display: flex;
      flex-direction: row;
      border-top: 1px solid var(--vscode-panel-border);
      flex-shrink: 0;
      max-height: 220px;
    }
    #recent-runs {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--vscode-panel-border);
      overflow: hidden;
    }
    #recent-runs.collapsed {
      flex: 0 0 auto;
    }
    #backlog {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #backlog.collapsed {
      flex: 0 0 auto;
    }
    .section-header {
      display: flex;
      align-items: center;
      padding: 5px 12px;
      flex-shrink: 0;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .section-title {
      font-size: 11px;
      font-weight: 600;
      opacity: 0.6;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      flex: 1;
    }
    .collapse-btn {
      background: none;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      padding: 0 4px;
      font-size: 11px;
      opacity: 0.5;
      line-height: 1;
    }
    .collapse-btn:hover { opacity: 1; }
    #runs-list {
      overflow-y: auto;
      flex: 1;
      padding: 4px 12px 6px;
    }
    #recent-runs.collapsed #runs-list { display: none; }
    .run-row {
      display: flex;
      gap: 10px;
      font-size: 11px;
      padding: 3px 0;
      align-items: center;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }
    .run-row .run-name { font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .run-row .run-target { opacity: 0.55; font-size: 10px; }
    .run-row .run-date { opacity: 0.45; font-size: 10px; }
    .run-badge-running { color: #4caf50; font-size: 10px; white-space: nowrap; }
    .run-badge-stopped { color: #666; font-size: 10px; white-space: nowrap; }
    #backlog-list {
      overflow-y: auto;
      flex: 1;
      padding: 4px 12px 6px;
    }
    #backlog.collapsed #backlog-list { display: none; }
    .bl-group-header {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.45;
      padding: 8px 0 3px;
    }
    .bl-group-header:first-child { padding-top: 3px; }
    .backlog-row {
      display: flex;
      gap: 8px;
      font-size: 12px;
      padding: 4px 0;
      align-items: baseline;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .bl-id {
      font-weight: 600;
      min-width: 56px;
      color: var(--vscode-textLink-foreground, #4fc3f7);
      font-size: 11px;
      flex-shrink: 0;
    }
    .bl-title { flex: 1; }
    .bl-assigned {
      opacity: 0.5;
      font-size: 11px;
      font-style: italic;
      flex-shrink: 0;
    }
    .bl-badge-active { display: none; }
    .bl-badge-todo { display: none; }
    .bl-badge-done { display: none; }
    .backlog-done-summary {
      font-size: 11px;
      cursor: pointer;
      opacity: 0.6;
      padding: 4px 0 2px;
      display: block;
    }
  </style>
</head>
<body>
  <header>
    <h1>SwarmForge</h1>
    <span class="status" id="status">Waiting for swarm...</span>
    <span class="stage" id="stage"></span>
    <button id="open-pr-btn" title="Open pull request for this swarm run">Open PR</button>
  </header>
  <div id="grid">
    <div class="empty" id="placeholder">Launch a swarm to see agent tiles.</div>
  </div>
  <div id="bottom-row" style="display:none;">
    <div id="recent-runs" style="display:none;">
      <div class="section-header">
        <span class="section-title">Recent Runs</span>
        <button class="collapse-btn" id="runs-toggle" title="Toggle">▾</button>
      </div>
      <div id="runs-list"></div>
    </div>
    <div id="backlog" style="display:none;">
      <div class="section-header">
        <span class="section-title">Backlog</span>
        <button class="collapse-btn" id="backlog-toggle" title="Toggle">▾</button>
      </div>
      <div id="backlog-list"></div>
    </div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}
