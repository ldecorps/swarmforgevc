import * as vscode from 'vscode';
import { SwarmRole, respawnAgent } from '../swarm/tmuxClient';
import { PaneTailer } from './paneTailer';
import { currentStageLabel, readPipelineStages } from '../swarm/swarmState';
import { getNonce, getWebviewHtml } from './webviewHtml';

const STAGE_POLL_INTERVAL_MS = 2000;

export class SwarmPanel {
  public static currentPanel: SwarmPanel | undefined;
  private static readonly viewType = 'swarmforgePanel';

  private readonly panel: vscode.WebviewPanel;
  private tailer: PaneTailer | undefined;
  private stagePoller: ReturnType<typeof setInterval> | undefined;
  private disposables: vscode.Disposable[] = [];
  private wasActive = false;
  private dogfoodShown = false;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private targetPath: string
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.setupTailer();
    this.startStagePoller();

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
          case 'restartAgent': {
            const result = respawnAgent(this.targetPath, message.role);
            if (!result.success) {
              vscode.window.showErrorMessage(result.message);
            }
            break;
          }
          case 'openPR':
            vscode.commands.executeCommand('swarmforge.openPR');
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

  public notifyDogfoodCheckpoint(): void {
    if (this.dogfoodShown) {
      return;
    }
    this.dogfoodShown = true;
    vscode.window.showInformationMessage(
      'DOGFOOD CHECKPOINT REACHED — launch and live tiles are functional. ' +
        'Point this extension at its own repo to verify before continuing.'
    );
  }

  private setupTailer(): void {
    this.tailer?.stop();
    this.tailer = new PaneTailer(
      this.targetPath,
      (updates) => {
        this.panel.webview.postMessage({ type: 'output', updates });
      },
      (events) => {
        this.panel.webview.postMessage({ type: 'stall', events });
      },
      (events) => {
        this.panel.webview.postMessage({ type: 'dead', events });
      }
    );
    this.tailer.start();
    this.sendRoles(this.tailer.getRoles());
  }

  private startStagePoller(): void {
    if (this.stagePoller) {
      clearInterval(this.stagePoller);
    }
    const poll = () => {
      const stages = readPipelineStages(this.targetPath);
      const label = currentStageLabel(stages);
      const isIdle = label === 'idle';
      if (!isIdle) {
        this.wasActive = true;
      }
      if (this.wasActive && isIdle) {
        this.wasActive = false;
        this.panel.webview.postMessage({ type: 'swarmDone' });
      } else {
        this.panel.webview.postMessage({ type: 'stage', label });
      }
    };
    poll();
    this.stagePoller = setInterval(poll, STAGE_POLL_INTERVAL_MS);
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
    return getWebviewHtml(getNonce());
  }

  public dispose(): void {
    SwarmPanel.currentPanel = undefined;
    this.tailer?.stop();
    if (this.stagePoller) {
      clearInterval(this.stagePoller);
      this.stagePoller = undefined;
    }
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
