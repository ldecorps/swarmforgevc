import * as vscode from 'vscode';
import { SwarmRole } from '../swarm/tmuxClient';
import { PaneTailer } from './paneTailer';

export class SwarmPanel {
  public static currentPanel: SwarmPanel | undefined;
  private static readonly viewType = 'swarmforgePanel';

  private readonly panel: vscode.WebviewPanel;
  private tailer: PaneTailer | undefined;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private targetPath: string
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.setupTailer();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.type) {
          case 'input':
            this.tailer?.forwardInput(message.role, message.data);
            break;
          case 'specialKey':
            this.tailer?.forwardSpecialKey(message.role, message.key);
            break;
          case 'refresh':
            this.tailer?.refreshState();
            this.sendRoles(this.tailer?.getRoles() ?? []);
            break;
        }
      },
      null,
      this.disposables
    );
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    targetPath: string
  ): SwarmPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SwarmPanel.currentPanel) {
      SwarmPanel.currentPanel.targetPath = targetPath;
      SwarmPanel.currentPanel.panel.reveal(column);
      SwarmPanel.currentPanel.setupTailer();
      return SwarmPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      SwarmPanel.viewType,
      'SwarmForge',
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    SwarmPanel.currentPanel = new SwarmPanel(panel, extensionUri, targetPath);
    return SwarmPanel.currentPanel;
  }

  public updateTarget(targetPath: string): void {
    this.targetPath = targetPath;
    this.setupTailer();
  }

  private setupTailer(): void {
    this.tailer?.stop();
    this.tailer = new PaneTailer(this.targetPath, (updates) => {
      this.panel.webview.postMessage({ type: 'output', updates });
    });
    this.tailer.start();
    this.sendRoles(this.tailer.getRoles());
  }

  private sendRoles(roles: SwarmRole[]): void {
    this.panel.webview.postMessage({
      type: 'roles',
      roles: roles.map((r) => ({
        role: r.role,
        displayName: r.displayName,
        agent: r.agent,
      })),
    });
  }

  private getHtml(): string {
    const nonce = getNonce();

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
    #grid {
      flex: 1;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 8px;
      padding: 8px;
      overflow: auto;
      align-content: start;
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
  </style>
</head>
<body>
  <header>
    <h1>SwarmForge</h1>
    <span class="status" id="status">Waiting for swarm...</span>
  </header>
  <div id="grid">
    <div class="empty" id="placeholder">Launch a swarm to see agent tiles.</div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const grid = document.getElementById('grid');
    const status = document.getElementById('status');
    const placeholder = document.getElementById('placeholder');
    const tiles = new Map();
    let activeRole = null;

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

      const header = document.createElement('div');
      header.className = 'tile-header';
      header.innerHTML = '<span>' + displayName + '</span><span class="tile-agent">' + agent + '</span>';

      const output = document.createElement('div');
      output.className = 'tile-output';
      output.tabIndex = 0;
      output.dataset.role = role;

      output.addEventListener('focus', () => {
        activeRole = role;
      });

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

      const entry = { tile, output, text: '' };
      tiles.set(role, entry);
      return entry;
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.type) {
        case 'roles':
          status.textContent = message.roles.length + ' agent(s)';
          message.roles.forEach((r) => ensureTile(r.role, r.displayName, r.agent));
          break;
        case 'output':
          message.updates.forEach((u) => {
            const entry = ensureTile(u.role, u.displayName, u.role);
            if (u.full) {
              entry.text = u.text;
            } else {
              entry.text += u.text;
            }
            entry.output.textContent = entry.text;
            entry.output.scrollTop = entry.output.scrollHeight;
          });
          break;
      }
    });

    vscode.postMessage({ type: 'refresh' });
  </script>
</body>
</html>`;
  }

  public dispose(): void {
    SwarmPanel.currentPanel = undefined;
    this.tailer?.stop();
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
