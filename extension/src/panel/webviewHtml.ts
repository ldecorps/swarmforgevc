const NONCE_LENGTH = 32;
const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function getNonce(): string {
  let text = '';
  for (let i = 0; i < NONCE_LENGTH; i++) {
    text += NONCE_CHARS.charAt(Math.floor(Math.random() * NONCE_CHARS.length));
  }
  return text;
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
    .tile {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      min-height: 240px;
      background: var(--vscode-terminal-background, #1e1e1e);
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
    .tile-output {
      flex: 1;
      overflow: auto;
      padding: 6px 8px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      line-height: 1.35;
      white-space: pre-wrap;
      word-break: break-all;
      cursor: text;
      outline: none;
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
    #recent-runs {
      border-top: 1px solid var(--vscode-panel-border);
      padding: 6px 12px;
      flex-shrink: 0;
      max-height: 160px;
      overflow: auto;
    }
    .runs-header {
      font-size: 11px;
      font-weight: 600;
      opacity: 0.7;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .run-row {
      display: flex;
      gap: 10px;
      font-size: 11px;
      padding: 2px 0;
      align-items: center;
    }
    .run-row .run-name { font-weight: 500; }
    .run-row .run-target { opacity: 0.6; }
    .run-row .run-date { opacity: 0.5; }
    .run-badge-running { color: #4caf50; }
    .run-badge-stopped { color: #888; }
    #backlog {
      border-top: 1px solid var(--vscode-panel-border);
      padding: 6px 12px;
      flex-shrink: 0;
      max-height: 200px;
      overflow: auto;
    }
    .backlog-header {
      font-size: 11px;
      font-weight: 600;
      opacity: 0.7;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .backlog-row {
      display: flex;
      gap: 8px;
      font-size: 11px;
      padding: 2px 0;
      align-items: center;
    }
    .backlog-row .bl-id { font-weight: 500; min-width: 52px; }
    .backlog-row .bl-title { flex: 1; }
    .backlog-row .bl-assigned { opacity: 0.6; }
    .bl-badge {
      display: inline-block;
      padding: 0 5px;
      border-radius: 3px;
      font-size: 10px;
      min-width: 42px;
      text-align: center;
    }
    .bl-badge-active { background: #2e7d32; color: #fff; }
    .bl-badge-todo { background: #555; color: #ccc; }
    .bl-badge-done { background: #333; color: #888; }
    .backlog-done-summary {
      font-size: 11px;
      cursor: pointer;
      opacity: 0.7;
      padding: 2px 0;
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
  <div id="recent-runs" style="display:none;">
    <div class="runs-header">Recent Runs</div>
    <div id="runs-list"></div>
  </div>
  <div id="backlog" style="display:none;">
    <div class="backlog-header">Backlog</div>
    <div id="backlog-list"></div>
  </div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}
