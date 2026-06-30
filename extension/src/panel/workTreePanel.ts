import * as vscode from 'vscode';
import { readBacklog, BacklogItem } from './backlogReader';
import { lastCommitForItem } from './gitTracer';
import { getNonce, getWorkTreeHtml } from './webviewHtml';

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
    this.panel.webview.html = getWorkTreeHtml(getNonce());
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
