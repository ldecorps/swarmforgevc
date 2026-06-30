import * as vscode from 'vscode';
import { readBacklog, BacklogItem } from './backlogReader';
import { lastCommitForItem } from './gitTracer';
import { getNonce } from './webviewHtml';

const POLL_INTERVAL_MS = 2000;

export class WorkTreePanel {
  public static currentPanel: WorkTreePanel | undefined;
  private static readonly viewType = 'swarmforgeWorkTree';

  private readonly panel: vscode.WebviewPanel;
  private poller: ReturnType<typeof setInterval> | undefined;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private targetPath: string
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml(getNonce());
    this.startPoller();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message) => {
        if (message.type === 'highlightTile') {
          vscode.commands.executeCommand('swarmforge.highlightTile', message.role);
        }
      },
      null,
      this.disposables
    );
  }

  public static createOrShow(targetPath: string): WorkTreePanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (WorkTreePanel.currentPanel) {
      WorkTreePanel.currentPanel.targetPath = targetPath;
      WorkTreePanel.currentPanel.panel.reveal(column);
      WorkTreePanel.currentPanel.sendUpdate();
      return WorkTreePanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      WorkTreePanel.viewType,
      'SwarmForge: Work Tree',
      column ?? vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    WorkTreePanel.currentPanel = new WorkTreePanel(panel, targetPath);
    return WorkTreePanel.currentPanel;
  }

  private startPoller(): void {
    this.sendUpdate();
    this.poller = setInterval(() => this.sendUpdate(), POLL_INTERVAL_MS);
  }

  private sendUpdate(): void {
    const items = readBacklog(this.targetPath);
    const enriched = items.map((item) => {
      const commit = lastCommitForItem(this.targetPath, item.id);
      return { ...item, lastCommit: commit ?? null };
    });
    this.panel.webview.postMessage({ type: 'update', items: enriched });
  }

  private getHtml(nonce: string): string {
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

    function badge(status) {
      return '<span class="badge badge-' + status + '">' + status + '</span>';
    }

    function renderItems(items) {
      if (!items || items.length === 0) {
        return '<div class="empty">No backlog items found.</div>';
      }
      const rows = items.map(item => {
        const cls = item.status === 'done' ? 'done' : (item.status === 'active' ? 'active' : '');
        const role = item.assignedTo || '';
        const commit = item.lastCommit
          ? '<span class="commit-hash" title="' + item.lastCommit.message + '">' + item.lastCommit.hash + '</span>'
          : '—';
        const clickAttr = item.status === 'active' && role
          ? ' onclick="highlight(\'' + role + '\')"'
          : '';
        return '<tr class="' + cls + '"' + clickAttr + '>' +
          '<td>' + badge(item.status) + '</td>' +
          '<td>' + item.id + '</td>' +
          '<td>' + item.title + '</td>' +
          '<td>' + (item.milestone || '—') + '</td>' +
          '<td>' + (item.priority != null ? item.priority : '—') + '</td>' +
          '<td>' + (item.assignedTo || '—') + '</td>' +
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

  public dispose(): void {
    WorkTreePanel.currentPanel = undefined;
    if (this.poller) {
      clearInterval(this.poller);
      this.poller = undefined;
    }
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
