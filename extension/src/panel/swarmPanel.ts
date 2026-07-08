import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SwarmRole, respawnAgent } from '../swarm/tmuxClient';
import { PaneTailer } from './paneTailer';
import { currentStageLabel, readPipelineStages, findLiveHolder, parseRolesTsv } from '../swarm/swarmState';
import { computeSwarmMetrics, DEFAULT_SUITE_WARN_SECONDS } from '../metrics/swarmMetrics';
import { computeLiveTransportHealth } from '../swarm/transportHealth';
import { escalatedStuckRoles } from '../watchdog/stuckEscalations';
import { loadRuns } from '../runs/runLog';
import { getNonce, getWebviewHtml } from './webviewHtml';
import { readBacklog, BacklogItem } from './backlogReader';
import { setAssignedTo, markDone } from './backlogWriter';
import { buildBadgeMap } from './badgeSummary';
import { NeedsHumanReconciler } from './needsHumanReconciler';
import { extractQuestionSnippet } from './needsHumanDetection';
import { NeedsHumanEvent } from './paneTailer';
import { recordSessionUrl, getSessionUrl } from '../notify/sessionUrlCapture';
import {
  NeedsHumanEmailNotifier,
  EmailNotifyConfig,
  EmailNotifierAdapters,
  NeedsHumanUpdate,
} from '../notify/needsHumanEmailNotifier';
import { sendResendEmail } from '../notify/resendClient';
import { resolveResendApiKey } from '../notify/secrets';
import { readBounceDrainState } from '../swarm/bounceDrain';
import { buildRoleInboxes } from '../watchdog/chaserMonitor';
import { scanInProcess } from '../swarm/inboxChaser';

const STAGE_POLL_INTERVAL_MS = 2000;
const OUTPUT_CHANNEL_NAME = 'SwarmForge';
// BL-121: a parcel sitting undelivered this long is a detected stall, not a
// role legitimately still working (cf. BL-067's stuckInProcessTimeoutSeconds,
// which governs agent-inactivity chasing at a much shorter horizon — this is
// the coarser "is anything actually moving" alarm for the panel).
const TRANSPORT_STALL_THRESHOLD_SECONDS = 1800;
const TRANSPORT_CANARY_BUDGET_SECONDS = 600;

export class SwarmPanel {
  public static currentPanel: SwarmPanel | undefined;
  private static readonly viewType = 'swarmforgePanel';

  private readonly panel: vscode.WebviewPanel;
  private readonly outputChannel: vscode.OutputChannel;
  private tailer: PaneTailer | undefined;
  private stagePoller: ReturnType<typeof setInterval> | undefined;
  private disposables: vscode.Disposable[] = [];
  private wasActive = false;
  private readonly needsHumanReconciler = new NeedsHumanReconciler();
  private dogfoodShown = false;
  private workspaceState: vscode.Memento | undefined;
  private emailNotifier: NeedsHumanEmailNotifier | undefined;
  private latestPaneText = new Map<string, string>();
  private resendApiKey: string | undefined;
  private wasDraining = false;

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private targetPath: string,
    private readonly runLogPath: string,
    workspaceState?: vscode.Memento,
    private readonly secrets?: vscode.SecretStorage
  ) {
    this.workspaceState = workspaceState;
    this.panel = panel;
    this.outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
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
          case 'tileSelected':
            if (this.workspaceState) {
              this.workspaceState.update('swarmforge.selectedRole', message.role);
            }
            break;
          case 'fitTilePaneToHeight':
            this.tailer?.updatePaneRows(message.role, message.paneRows);
            break;
          case 'cancelBounceDrain':
            vscode.commands.executeCommand('swarmforge.cancelBounceDrain');
            break;
          case 'forceBounceNow':
            vscode.commands.executeCommand('swarmforge.forceBounceNow');
            break;
          case 'markBacklogDone':
            // BL-034: folder move only, no status-field rewrite - the
            // done/ folder is the authoritative signal (BL-033), same as
            // the read side already assumes. The next stage poll re-reads
            // and reflects it, exactly like an external disk edit would.
            markDone(this.targetPath, message.id);
            break;
          case 'setBacklogAssignee':
            setAssignedTo(this.targetPath, message.id, message.assignedTo);
            break;
        }
      },
      null,
      this.disposables
    );
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    targetPath: string,
    runLogPath: string,
    workspaceState?: vscode.Memento,
    secrets?: vscode.SecretStorage,
    preserveFocus = false
  ): SwarmPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (SwarmPanel.currentPanel) {
      SwarmPanel.currentPanel.targetPath = targetPath;
      SwarmPanel.currentPanel.panel.reveal(column, preserveFocus);
      SwarmPanel.currentPanel.setupTailer();
      return SwarmPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      SwarmPanel.viewType,
      'SwarmForge',
      { viewColumn: column ?? vscode.ViewColumn.One, preserveFocus },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    SwarmPanel.currentPanel = new SwarmPanel(
      panel,
      extensionUri,
      targetPath,
      runLogPath,
      workspaceState,
      secrets
    );
    return SwarmPanel.currentPanel;
  }

  public highlightTile(role: string): void {
    this.panel.webview.postMessage({ type: 'highlightTile', role });
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
    const config = vscode.workspace.getConfiguration('swarmforge');
    const historyLines = config.get<number>('tile.historyLines', 5000);
    const paneRows = config.get<number>('tile.paneRows', 200);
    this.setupEmailNotifier(config);
    this.tailer = new PaneTailer(
      this.targetPath,
      (updates) => {
        this.panel.webview.postMessage({ type: 'output', updates });
        // Pane text already captured for the tile is reused here rather than
        // re-reading tmux, both to find the claude.ai/code session deep link
        // (BL-073) as it streams and to quote the prompt when a needs-human
        // event fires below.
        for (const update of updates) {
          this.latestPaneText.set(update.role, update.text);
          recordSessionUrl(update.role, update.text);
        }
      },
      (events) => {
        this.panel.webview.postMessage({ type: 'stall', events });
      },
      (events) => {
        this.panel.webview.postMessage({ type: 'dead', events });
      },
      (message) => {
        this.outputChannel.appendLine(message);
      },
      historyLines,
      (roles) => {
        this.sendRoles(roles);
      },
      paneRows,
      (events) => {
        const deltas = this.needsHumanReconciler.applyQuestionEvents(events);
        if (deltas.length > 0) {
          this.panel.webview.postMessage({ type: 'needsHuman', events: deltas });
        }
        this.recordEmailUpdates(deltas);
      },
      (message) => {
        this.outputChannel.appendLine(message);
      },
      (events) => {
        this.panel.webview.postMessage({ type: 'activity', events });
      }
    );
    this.tailer.start();
    this.sendRoles(this.tailer.getRoles());
    if (this.workspaceState) {
      const selectedRole = this.workspaceState.get<string>('swarmforge.selectedRole');
      if (selectedRole) {
        this.panel.webview.postMessage({ type: 'restoreSelection', role: selectedRole });
      }
    }
  }

  // BL-073: email the human when a needs-human state persists past a grace
  // period. Off until both a recipient (setting) and a Resend API key (host
  // env RESEND_API_KEY, or the swarmforge.resendApiKey secret) resolve — the
  // key is never read from a workspace setting, so it can never end up in a
  // committed settings.json.
  private setupEmailNotifier(config: vscode.WorkspaceConfiguration): void {
    const to = config.get<string>('notify.email.to', '');
    const from = config.get<string>('notify.email.from', 'onboarding@resend.dev');
    const graceSeconds = config.get<number>('notify.email.graceSeconds', 60);
    const cooldownSeconds = config.get<number>('notify.email.cooldownSeconds', 600);

    const notifyConfig: EmailNotifyConfig = {
      enabled: false,
      graceSeconds,
      cooldownSeconds,
      to,
      from,
    };

    const adapters: EmailNotifierAdapters = {
      getSessionUrl: (role) => getSessionUrl(role),
      getTicketBadge: (role) => {
        const badge = buildBadgeMap(readBacklog(this.targetPath), this.targetPath)[role];
        return badge ? { id: badge.id, summary: badge.summary } : null;
      },
      sendEmail: (message) => {
        if (!this.resendApiKey) {
          return Promise.resolve({ success: false, error: 'Resend API key not configured' });
        }
        return sendResendEmail(this.resendApiKey, message);
      },
      onSendResult: (role, result) => {
        this.outputChannel.appendLine(
          result.success
            ? `Needs-human email sent for ${role}.`
            : `Needs-human email for ${role} failed: ${result.error}`
        );
      },
    };

    this.emailNotifier = new NeedsHumanEmailNotifier(notifyConfig, adapters);

    resolveResendApiKey(this.secrets).then((key) => {
      this.resendApiKey = key;
      notifyConfig.enabled = Boolean(key && to);
    });
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
      const recentRuns = loadRuns(this.runLogPath)
        .slice(-10)
        .reverse()
        .map((r) => ({
          ...r,
          status: r.targetPath === this.targetPath && !isIdle ? 'running' : 'stopped',
        }));
      if (this.wasActive && isIdle) {
        this.wasActive = false;
        this.panel.webview.postMessage({ type: 'swarmDone' });
      }
      this.panel.webview.postMessage({ type: 'stage', label, recentRuns });
      const backlogItems = readBacklog(this.targetPath);
      // Build a map of active item IDs to their live holders
      const holderMap: Record<string, string> = {};
      for (const item of backlogItems) {
        if (item.status === 'active') {
          const holder = findLiveHolder(this.targetPath, item.id);
          if (holder) {
            holderMap[item.id] = holder;
          }
        }
      }
      this.panel.webview.postMessage({ type: 'backlogUpdate', items: backlogItems });
      this.panel.webview.postMessage({ type: 'holderUpdate', holders: holderMap });
      this.panel.webview.postMessage({ type: 'badgeUpdate', badges: buildBadgeMap(backlogItems, this.targetPath) });
      const transportRoles = this.tailer?.getRoles() ?? [];
      const transportRoleInboxes = buildRoleInboxes(this.targetPath, transportRoles.map((r) => r.role));
      const transportHealth = computeLiveTransportHealth(this.targetPath, transportRoleInboxes, Date.now(), {
        stallThresholdSeconds: TRANSPORT_STALL_THRESHOLD_SECONDS,
        canaryBudgetSeconds: TRANSPORT_CANARY_BUDGET_SECONDS,
      });
      this.panel.webview.postMessage({ type: 'transportHealth', health: transportHealth });
      // BL-071: reuses this existing poll tick - no new polling loop, no
      // per-second git invocations.
      this.postMetrics();
      this.postStuckEscalations();
      this.emailNotifier?.sweep(Date.now());
      this.postBounceDrainStatus();
    };
    poll();
    this.stagePoller = setInterval(poll, STAGE_POLL_INTERVAL_MS);
  }

  // BL-071: host computes, webview presents. Fed by the SAME vscode-free
  // metrics/swarmMetrics.ts module the swarm-metrics CLI calls, so the two
  // never disagree (swarm-metrics-08).
  private postMetrics(): void {
    let roles: ReturnType<typeof parseRolesTsv> = [];
    try {
      roles = parseRolesTsv(fs.readFileSync(path.join(this.targetPath, '.swarmforge', 'roles.tsv'), 'utf8'));
    } catch {
      roles = [];
    }
    const latestRun = loadRuns(this.runLogPath)
      .filter((r) => r.targetPath === this.targetPath)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
    const runStartMs = latestRun ? Date.parse(latestRun.startedAt) : null;
    const suiteWarnSeconds = vscode.workspace
      .getConfiguration('swarmforge')
      .get<number>('metrics.suiteWarnSeconds', DEFAULT_SUITE_WARN_SECONDS);
    const metrics = computeSwarmMetrics(this.targetPath, roles, runStartMs, Date.now(), suiteWarnSeconds);
    this.panel.webview.postMessage({
      type: 'metricsUpdate',
      metrics,
      roles: roles.map((r) => r.role),
    });
  }

  // Roles the stuck-in-process chaser escalated (chases exhausted, no
  // recovery) surface with the same needs-human red border the question
  // detector uses. Routed through needsHumanReconciler so this source's
  // "false" never clears a tile the question detector still holds true (and
  // vice versa) — see needsHumanReconciler.ts (BL-067).
  private postStuckEscalations(): void {
    const deltas = this.needsHumanReconciler.applyStuckRoles(escalatedStuckRoles());
    if (deltas.length > 0) {
      this.panel.webview.postMessage({ type: 'needsHuman', events: deltas });
      this.emailNotifier?.recordUpdates(deltas, Date.now());
    }
    this.recordEmailUpdates(deltas);
  }

  // Feeds the BL-073 email notifier from the RECONCILED needs-human deltas
  // (the same ones posted to the webview), not from either raw source
  // directly. Both the question detector and the stuck-in-process chaser
  // reach this: a stuck-escalated role now emails too (the silent-overnight
  // -stall case BL-067/BL-073 both exist for), and — same reasoning as the
  // webview reconciler — one source's "false" can never prematurely clear
  // the grace-period clock while the other source still holds true.
  private recordEmailUpdates(deltas: NeedsHumanEvent[]): void {
    if (!this.emailNotifier || deltas.length === 0) {
      return;
    }
    const updates: NeedsHumanUpdate[] = deltas.map((event) => ({
      role: event.role,
      needsHuman: event.needsHuman,
      snippet: event.needsHuman
        ? extractQuestionSnippet(this.latestPaneText.get(event.role))
        : undefined,
    }));
    this.emailNotifier.recordUpdates(updates, Date.now());
  }

  // BL-069: surfaces the graceful bounce drain state (banner + per-tile
  // busy/idle) purely by reading the durable sentinel and each role's
  // in_process holds — presentation only, no orchestration decision lives
  // here; that belongs to the extension-host drain watcher.
  private postBounceDrainStatus(): void {
    const state = readBounceDrainState(this.targetPath);
    if (!state) {
      if (this.wasDraining) {
        this.wasDraining = false;
        this.panel.webview.postMessage({ type: 'bounceDrain', draining: false });
      }
      return;
    }
    this.wasDraining = true;
    const roles = this.tailer?.getRoles() ?? [];
    const roleInboxes = buildRoleInboxes(this.targetPath, roles.map((r) => r.role));
    const busyRoles = roleInboxes
      .filter((inbox) => scanInProcess(inbox.inProcessDir).length > 0)
      .map((inbox) => inbox.role);
    this.panel.webview.postMessage({
      type: 'bounceDrain',
      draining: true,
      busyRoles,
      totalRoles: roles.length,
    });
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
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'panel.js')
    ).toString();
    return getWebviewHtml(scriptUri, this.panel.webview.cspSource);
  }

  public dispose(): void {
    SwarmPanel.currentPanel = undefined;
    this.outputChannel.dispose();
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
