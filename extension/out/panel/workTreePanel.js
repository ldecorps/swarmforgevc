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
exports.WorkTreePanel = void 0;
const vscode = __importStar(require("vscode"));
const backlogReader_1 = require("./backlogReader");
const gitTracer_1 = require("./gitTracer");
const webviewHtml_1 = require("./webviewHtml");
const POLL_INTERVAL_MS = 2000;
class WorkTreePanel {
    targetPath;
    static currentPanel;
    static viewType = 'swarmforgeWorkTree';
    panel;
    poller;
    disposables = [];
    constructor(panel, targetPath) {
        this.targetPath = targetPath;
        this.panel = panel;
        this.panel.webview.html = (0, webviewHtml_1.getWorkTreeHtml)((0, webviewHtml_1.getNonce)());
        this.startPoller();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage((message) => {
            if (message.type === 'highlightTile') {
                vscode.commands.executeCommand('swarmforge.highlightTile', message.role);
            }
        }, null, this.disposables);
    }
    static createOrShow(targetPath) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        if (WorkTreePanel.currentPanel) {
            WorkTreePanel.currentPanel.targetPath = targetPath;
            WorkTreePanel.currentPanel.panel.reveal(column);
            WorkTreePanel.currentPanel.sendUpdate();
            return WorkTreePanel.currentPanel;
        }
        const panel = vscode.window.createWebviewPanel(WorkTreePanel.viewType, 'SwarmForge: Work Tree', column ?? vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
        WorkTreePanel.currentPanel = new WorkTreePanel(panel, targetPath);
        return WorkTreePanel.currentPanel;
    }
    startPoller() {
        this.sendUpdate();
        this.poller = setInterval(() => this.sendUpdate(), POLL_INTERVAL_MS);
    }
    sendUpdate() {
        const items = (0, backlogReader_1.readBacklog)(this.targetPath);
        const enriched = items.map((item) => {
            const commit = (0, gitTracer_1.lastCommitForItem)(this.targetPath, item.id);
            return { ...item, lastCommit: commit ?? null };
        });
        this.panel.webview.postMessage({ type: 'update', items: enriched });
    }
    dispose() {
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
exports.WorkTreePanel = WorkTreePanel;
//# sourceMappingURL=workTreePanel.js.map