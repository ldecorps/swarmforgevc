"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwarmPanel = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const tmuxClient_1 = require("../swarm/tmuxClient");
const paneTailer_1 = require("./paneTailer");
const swarmState_1 = require("../swarm/swarmState");
const swarmMetrics_1 = require("../metrics/swarmMetrics");
const daemonHealth_1 = require("../swarm/daemonHealth");
const stuckEscalations_1 = require("../watchdog/stuckEscalations");
const runLog_1 = require("../runs/runLog");
const webviewHtml_1 = require("./webviewHtml");
const backlogReader_1 = require("./backlogReader");
const backlogWriter_1 = require("./backlogWriter");
const badgeSummary_1 = require("./badgeSummary");
const needsHumanReconciler_1 = require("./needsHumanReconciler");
const needsHumanDetection_1 = require("./needsHumanDetection");
const sessionUrlCapture_1 = require("../notify/sessionUrlCapture");
const needsHumanEmailNotifier_1 = require("../notify/needsHumanEmailNotifier");
const resendClient_1 = require("../notify/resendClient");
const secrets_1 = require("../notify/secrets");
const bounceDrain_1 = require("../swarm/bounceDrain");
const chaserMonitor_1 = require("../watchdog/chaserMonitor");
const inboxChaser_1 = require("../swarm/inboxChaser");
const STAGE_POLL_INTERVAL_MS = 2000;
const OUTPUT_CHANNEL_NAME = 'SwarmForge';
class SwarmPanel {
    extensionUri;
    targetPath;
    runLogPath;
    secrets;
    static currentPanel;
    static viewType = 'swarmforgePanel';
    panel;
    outputChannel;
    tailer;
    stagePoller;
    disposables = [];
    wasActive = false;
    needsHumanReconciler = new needsHumanReconciler_1.NeedsHumanReconciler();
    dogfoodShown = false;
    workspaceState;
    emailNotifier;
    latestPaneText = new Map();
    resendApiKey;
    wasDraining = false;
    constructor(panel, extensionUri, targetPath, runLogPath, workspaceState, secrets) {
        this.extensionUri = extensionUri;
        this.targetPath = targetPath;
        this.runLogPath = runLogPath;
        this.secrets = secrets;
        this.workspaceState = workspaceState;
        this.panel = panel;
        this.outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
        this.panel.webview.html = this.getHtml();
        this.setupTailer();
        this.startStagePoller();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage((message) => {
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
                    const result = (0, tmuxClient_1.respawnAgent)(this.targetPath, message.role);
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
                    (0, backlogWriter_1.markDone)(this.targetPath, message.id);
                    break;
                case 'setBacklogAssignee':
                    (0, backlogWriter_1.setAssignedTo)(this.targetPath, message.id, message.assignedTo);
                    break;
            }
        }, null, this.disposables);
    }
    static createOrShow(extensionUri, targetPath, runLogPath, workspaceState, secrets) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        if (SwarmPanel.currentPanel) {
            SwarmPanel.currentPanel.targetPath = targetPath;
            SwarmPanel.currentPanel.panel.reveal(column);
            SwarmPanel.currentPanel.setupTailer();
            return SwarmPanel.currentPanel;
        }
        const panel = vscode.window.createWebviewPanel(SwarmPanel.viewType, 'SwarmForge', column ?? vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [extensionUri],
        });
        SwarmPanel.currentPanel = new SwarmPanel(panel, extensionUri, targetPath, runLogPath, workspaceState, secrets);
        return SwarmPanel.currentPanel;
    }
    highlightTile(role) {
        this.panel.webview.postMessage({ type: 'highlightTile', role });
    }
    updateTarget(targetPath) {
        this.targetPath = targetPath;
        this.setupTailer();
    }
    notifyDogfoodCheckpoint() {
        if (this.dogfoodShown) {
            return;
        }
        this.dogfoodShown = true;
        vscode.window.showInformationMessage('DOGFOOD CHECKPOINT REACHED — launch and live tiles are functional. ' +
            'Point this extension at its own repo to verify before continuing.');
    }
    setupTailer() {
        this.tailer?.stop();
        const config = vscode.workspace.getConfiguration('swarmforge');
        const historyLines = config.get('tile.historyLines', 5000);
        const paneRows = config.get('tile.paneRows', 200);
        this.setupEmailNotifier(config);
        this.tailer = new paneTailer_1.PaneTailer(this.targetPath, (updates) => {
            this.panel.webview.postMessage({ type: 'output', updates });
            // Pane text already captured for the tile is reused here rather than
            // re-reading tmux, both to find the claude.ai/code session deep link
            // (BL-073) as it streams and to quote the prompt when a needs-human
            // event fires below.
            for (const update of updates) {
                this.latestPaneText.set(update.role, update.text);
                (0, sessionUrlCapture_1.recordSessionUrl)(update.role, update.text);
            }
        }, (events) => {
            this.panel.webview.postMessage({ type: 'stall', events });
        }, (events) => {
            this.panel.webview.postMessage({ type: 'dead', events });
        }, (message) => {
            this.outputChannel.appendLine(message);
        }, historyLines, (roles) => {
            this.sendRoles(roles);
        }, paneRows, (events) => {
            const deltas = this.needsHumanReconciler.applyQuestionEvents(events);
            if (deltas.length > 0) {
                this.panel.webview.postMessage({ type: 'needsHuman', events: deltas });
            }
            this.recordEmailUpdates(deltas);
        }, (message) => {
            this.outputChannel.appendLine(message);
        });
        this.tailer.start();
        this.sendRoles(this.tailer.getRoles());
        if (this.workspaceState) {
            const selectedRole = this.workspaceState.get('swarmforge.selectedRole');
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
    setupEmailNotifier(config) {
        const to = config.get('notify.email.to', '');
        const from = config.get('notify.email.from', 'onboarding@resend.dev');
        const graceSeconds = config.get('notify.email.graceSeconds', 60);
        const cooldownSeconds = config.get('notify.email.cooldownSeconds', 600);
        const notifyConfig = {
            enabled: false,
            graceSeconds,
            cooldownSeconds,
            to,
            from,
        };
        const adapters = {
            getSessionUrl: (role) => (0, sessionUrlCapture_1.getSessionUrl)(role),
            getTicketBadge: (role) => {
                const badge = (0, badgeSummary_1.buildBadgeMap)((0, backlogReader_1.readBacklog)(this.targetPath), this.targetPath)[role];
                return badge ? { id: badge.id, summary: badge.summary } : null;
            },
            sendEmail: (message) => {
                if (!this.resendApiKey) {
                    return Promise.resolve({ success: false, error: 'Resend API key not configured' });
                }
                return (0, resendClient_1.sendResendEmail)(this.resendApiKey, message);
            },
            onSendResult: (role, result) => {
                this.outputChannel.appendLine(result.success
                    ? `Needs-human email sent for ${role}.`
                    : `Needs-human email for ${role} failed: ${result.error}`);
            },
        };
        this.emailNotifier = new needsHumanEmailNotifier_1.NeedsHumanEmailNotifier(notifyConfig, adapters);
        (0, secrets_1.resolveResendApiKey)(this.secrets).then((key) => {
            this.resendApiKey = key;
            notifyConfig.enabled = Boolean(key && to);
        });
    }
    startStagePoller() {
        if (this.stagePoller) {
            clearInterval(this.stagePoller);
        }
        const poll = () => {
            const stages = (0, swarmState_1.readPipelineStages)(this.targetPath);
            const label = (0, swarmState_1.currentStageLabel)(stages);
            const isIdle = label === 'idle';
            if (!isIdle) {
                this.wasActive = true;
            }
            const recentRuns = (0, runLog_1.loadRuns)(this.runLogPath)
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
            const backlogItems = (0, backlogReader_1.readBacklog)(this.targetPath);
            // Build a map of active item IDs to their live holders
            const holderMap = {};
            for (const item of backlogItems) {
                if (item.status === 'active') {
                    const holder = (0, swarmState_1.findLiveHolder)(this.targetPath, item.id);
                    if (holder) {
                        holderMap[item.id] = holder;
                    }
                }
            }
            this.panel.webview.postMessage({ type: 'backlogUpdate', items: backlogItems });
            this.panel.webview.postMessage({ type: 'holderUpdate', holders: holderMap });
            this.panel.webview.postMessage({ type: 'badgeUpdate', badges: (0, badgeSummary_1.buildBadgeMap)(backlogItems, this.targetPath) });
            this.panel.webview.postMessage({ type: 'transportHealth', health: (0, daemonHealth_1.readDaemonHealth)(this.targetPath) });
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
    postMetrics() {
        let roles = [];
        try {
            roles = (0, swarmState_1.parseRolesTsv)(fs.readFileSync(path.join(this.targetPath, '.swarmforge', 'roles.tsv'), 'utf8'));
        }
        catch {
            roles = [];
        }
        const latestRun = (0, runLog_1.loadRuns)(this.runLogPath)
            .filter((r) => r.targetPath === this.targetPath)
            .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
        const runStartMs = latestRun ? Date.parse(latestRun.startedAt) : null;
        const suiteWarnSeconds = vscode.workspace
            .getConfiguration('swarmforge')
            .get('metrics.suiteWarnSeconds', swarmMetrics_1.DEFAULT_SUITE_WARN_SECONDS);
        const metrics = (0, swarmMetrics_1.computeSwarmMetrics)(this.targetPath, roles, runStartMs, Date.now(), suiteWarnSeconds);
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
    postStuckEscalations() {
        const deltas = this.needsHumanReconciler.applyStuckRoles((0, stuckEscalations_1.escalatedStuckRoles)());
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
    recordEmailUpdates(deltas) {
        if (!this.emailNotifier || deltas.length === 0) {
            return;
        }
        const updates = deltas.map((event) => ({
            role: event.role,
            needsHuman: event.needsHuman,
            snippet: event.needsHuman
                ? (0, needsHumanDetection_1.extractQuestionSnippet)(this.latestPaneText.get(event.role))
                : undefined,
        }));
        this.emailNotifier.recordUpdates(updates, Date.now());
    }
    // BL-069: surfaces the graceful bounce drain state (banner + per-tile
    // busy/idle) purely by reading the durable sentinel and each role's
    // in_process holds — presentation only, no orchestration decision lives
    // here; that belongs to the extension-host drain watcher.
    postBounceDrainStatus() {
        const state = (0, bounceDrain_1.readBounceDrainState)(this.targetPath);
        if (!state) {
            if (this.wasDraining) {
                this.wasDraining = false;
                this.panel.webview.postMessage({ type: 'bounceDrain', draining: false });
            }
            return;
        }
        this.wasDraining = true;
        const roles = this.tailer?.getRoles() ?? [];
        const roleInboxes = (0, chaserMonitor_1.buildRoleInboxes)(this.targetPath, roles.map((r) => r.role));
        const busyRoles = roleInboxes
            .filter((inbox) => (0, inboxChaser_1.scanInProcess)(inbox.inProcessDir).length > 0)
            .map((inbox) => inbox.role);
        this.panel.webview.postMessage({
            type: 'bounceDrain',
            draining: true,
            busyRoles,
            totalRoles: roles.length,
        });
    }
    sendRoles(roles) {
        this.panel.webview.postMessage({
            type: 'roles',
            roles: roles.map((r) => ({
                role: r.role,
                displayName: r.displayName,
                agent: r.agent,
            })),
        });
    }
    getHtml() {
        const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'panel.js')).toString();
        return (0, webviewHtml_1.getWebviewHtml)(scriptUri, this.panel.webview.cspSource);
    }
    dispose() {
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
exports.SwarmPanel = SwarmPanel;
//# sourceMappingURL=swarmPanel.js.map