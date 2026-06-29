const NONCE_LENGTH = 32;
const NONCE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function getNonce(): string {
  let text = '';
  for (let i = 0; i < NONCE_LENGTH; i++) {
    text += NONCE_CHARS.charAt(Math.floor(Math.random() * NONCE_CHARS.length));
  }
  return text;
}

export function getWebviewHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
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
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const grid = document.getElementById('grid');
    const status = document.getElementById('status');
    const stageEl = document.getElementById('stage');
    const placeholder = document.getElementById('placeholder');
    const tiles = new Map();
    let activeRole = null;
    const openPrBtn = document.getElementById('open-pr-btn');
    const SCROLL_THRESHOLD = 8;

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

      const header = document.createElement('div');
      header.className = 'tile-header';
      header.innerHTML = '<span>' + displayName + '</span><span class="tile-agent">' + agent + '</span>';
      header.appendChild(nudgeBtn);

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

      output.addEventListener('keydown', (e) => {
        e.preventDefault();
        if (e.ctrlKey && e.key.length === 1) {
          const code = e.key.toLowerCase().charCodeAt(0) - 96;
          if (code >= 1 && code <= 26) {
            vscode.postMessage({ type: 'input', role, data: String.fromCharCode(code) });
          }
          return;
        }
        if (e.key.length === 1 && !e.metaKey && !e.altKey) {
          vscode.postMessage({ type: 'input', role, data: e.key });
        } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          vscode.postMessage({ type: 'specialKey', role, key: e.key });
        }
      });

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
      }
    });

    vscode.postMessage({ type: 'refresh' });
  </script>
</body>
</html>`;
}
