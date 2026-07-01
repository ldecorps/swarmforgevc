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
const vscode = __importStar(require("vscode"));
const tmuxClient_1 = require("../swarm/tmuxClient");
const paneTailer_1 = require("./paneTailer");
const swarmState_1 = require("../swarm/swarmState");
const runLog_1 = require("../runs/runLog");
const webviewHtml_1 = require("./webviewHtml");
const backlogReader_1 = require("./backlogReader");
const badgeSummary_1 = require("./badgeSummary");
const STAGE_POLL_INTERVAL_MS = 2000;
const OUTPUT_CHANNEL_NAME = 'SwarmForge';
class SwarmPanel {
    extensionUri;
    targetPath;
    runLogPath;
    static currentPanel;
    static viewType = 'swarmforgePanel';
    panel;
    outputChannel;
    tailer;
    stagePoller;
    disposables = [];
    wasActive = false;
    dogfoodShown = false;
    workspaceState;
    constructor(panel, extensionUri, targetPath, runLogPath, workspaceState) {
        this.extensionUri = extensionUri;
        this.targetPath = targetPath;
        this.runLogPath = runLogPath;
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
            }
        }, null, this.disposables);
    }
    static createOrShow(extensionUri, targetPath, runLogPath) {
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
        SwarmPanel.currentPanel = new SwarmPanel(panel, extensionUri, targetPath, runLogPath);
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
        this.tailer = new paneTailer_1.PaneTailer(this.targetPath, (updates) => {
            this.panel.webview.postMessage({ type: 'output', updates });
        }, (events) => {
            this.panel.webview.postMessage({ type: 'stall', events });
        }, (events) => {
            this.panel.webview.postMessage({ type: 'dead', events });
        }, (message) => {
            this.outputChannel.appendLine(message);
        }, historyLines, (roles) => {
            this.sendRoles(roles);
        }, paneRows, (events) => {
            this.panel.webview.postMessage({ type: 'needsHuman', events });
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
        };
        poll();
        this.stagePoller = setInterval(poll, STAGE_POLL_INTERVAL_MS);
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