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
exports.activate = activate;
exports.deactivate = deactivate;
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const vscode = __importStar(require("vscode"));
const targetConfig_1 = require("./config/targetConfig");
const targetBootstrap_1 = require("./config/targetBootstrap");
const swarmPanel_1 = require("./panel/swarmPanel");
const workTreePanel_1 = require("./panel/workTreePanel");
const backlogLoop_1 = require("./swarm/backlogLoop");
const backlogReader_1 = require("./panel/backlogReader");
const runLog_1 = require("./runs/runLog");
const prCreator_1 = require("./swarm/prCreator");
const swarmLauncher_1 = require("./swarm/swarmLauncher");
const swarmStopper_1 = require("./swarm/swarmStopper");
const bouncer_1 = require("./swarm/bouncer");
const tmuxClient_1 = require("./swarm/tmuxClient");
const resolveRunName_1 = require("./run/resolveRunName");
const bounceWatcher_1 = require("./swarm/bounceWatcher");
const chaserMonitor_1 = require("./watchdog/chaserMonitor");
const tmuxClient_2 = require("./swarm/tmuxClient");
const paneActivity_1 = require("./watchdog/paneActivity");
const stuckEscalations_1 = require("./watchdog/stuckEscalations");
const inboxChaser_1 = require("./swarm/inboxChaser");
const bounceDrain_1 = require("./swarm/bounceDrain");
const heartbeat_1 = require("./tools/heartbeat");
const devActivationMarker_1 = require("./devActivationMarker");
const liveness_1 = require("./watchdog/liveness");
const NO_TARGET_MESSAGE = 'Set a target project first (SwarmForge: Set Target Project).';
const STOP_SWARM_BUTTON = 'Stop Swarm';
const LAST_RUN_NAME_KEY = 'swarmforge.lastRunName';
const RUN_MODE_KEY = 'swarmforge.runMode';
const PENDING_AUTO_LAUNCH_KEY = 'swarmforge.pendingAutoLaunch';
const WATCHDOG_STALE_TIMEOUT_SECONDS = 30;
const WATCHDOG_IN_FLIGHT_TIMEOUT_SECONDS = 60;
const WATCHDOG_DEAD_TIMEOUT_SECONDS = 120;
const CHASER_INTERVAL_SECONDS = 5;
const CHASER_TIMEOUT_SECONDS = 30;
const CHASER_MAX_CHASES = 3;
const CHASER_STUCK_IN_PROCESS_TIMEOUT_SECONDS = 60;
const BOUNCE_DRAIN_POLL_INTERVAL_SECONDS = 5;
const BOUNCE_DRAIN_TIMEOUT_SECONDS_DEFAULT = 900;
let currentBounceWatcher = null;
let currentChaserMonitor = null;
let currentBounceDrainWatcher = null;
let currentGracefulBounceFileWatcher = null;
function generateDefaultRunName() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    return `run-${year}${month}${day}-${hour}${minute}`;
}
function startOrRestartBounceWatcher(context, targetPath) {
    // Dispose old watcher if it exists
    if (currentBounceWatcher) {
        currentBounceWatcher.close();
        currentBounceWatcher = null;
    }
    // Check if .swarmforge directory exists
    const swarmforgeDir = path.join(targetPath, '.swarmforge');
    if (!fs.existsSync(swarmforgeDir)) {
        return;
    }
    // Create handler that dispatches to appropriate command
    const handleBounce = (bounceType) => {
        switch (bounceType) {
            case 'swarm':
                vscode.commands.executeCommand('swarmforge.bounceSwarm');
                break;
            case 'extension':
                vscode.commands.executeCommand('swarmforge.bounceExtension');
                break;
            case 'all':
                vscode.commands.executeCommand('swarmforge.bounceAll');
                break;
        }
    };
    const handleError = (error) => {
        vscode.window.showWarningMessage(`Bounce watcher error: ${error}`);
    };
    // Start the watcher
    currentBounceWatcher = (0, bounceWatcher_1.startBounceWatcher)(targetPath, handleBounce, handleError);
    // Add to subscriptions for cleanup
    if (currentBounceWatcher) {
        context.subscriptions.push({
            dispose: () => {
                if (currentBounceWatcher) {
                    currentBounceWatcher.close();
                    currentBounceWatcher = null;
                }
            },
        });
    }
}
function startOrRestartChaserMonitor(targetPath, context) {
    // Stop old chaser if it exists
    if (currentChaserMonitor) {
        (0, chaserMonitor_1.stopChaserMonitor)(currentChaserMonitor);
        currentChaserMonitor = null;
    }
    // Check if .swarmforge directory exists
    const swarmforgeDir = path.join(targetPath, '.swarmforge');
    if (!fs.existsSync(swarmforgeDir)) {
        return;
    }
    // Read tmux socket for sending wake-ups
    const socketPath = (0, tmuxClient_2.readTmuxSocket)(targetPath);
    if (!socketPath) {
        return;
    }
    // Read swarm roles to know which inboxes to monitor
    const roles = (0, tmuxClient_2.readSwarmRoles)(targetPath);
    const rolesList = roles.map((r) => r.role);
    // Default watchdog and chaser config
    const watchdogConfig = {
        staleTimeoutSeconds: WATCHDOG_STALE_TIMEOUT_SECONDS,
        inFlightTimeoutSeconds: WATCHDOG_IN_FLIGHT_TIMEOUT_SECONDS,
        deadTimeoutSeconds: WATCHDOG_DEAD_TIMEOUT_SECONDS,
    };
    const chaserConfig = {
        targetPath,
        rolesList,
        chaseIntervalSeconds: CHASER_INTERVAL_SECONDS,
        chaseTimeoutSeconds: CHASER_TIMEOUT_SECONDS,
        maxChases: CHASER_MAX_CHASES,
        stuckInProcessTimeoutSeconds: CHASER_STUCK_IN_PROCESS_TIMEOUT_SECONDS,
    };
    // Implement adapters for the chaser
    const callbacks = {
        getLiveness: (role) => {
            const heartbeatDir = path.join(swarmforgeDir, 'heartbeat');
            const hb = (0, heartbeat_1.readHeartbeat)(heartbeatDir, role);
            const result = (0, liveness_1.computeLiveness)(hb, Date.now(), watchdogConfig, hb ? true : false);
            return result.state;
        },
        sendWakeUp: (role) => {
            const roleInfo = roles.find((r) => r.role === role);
            if (!roleInfo)
                return;
            const baseIndex = (0, tmuxClient_2.getPaneBaseIndex)(socketPath);
            const target = (0, tmuxClient_2.paneTarget)(roleInfo.session, roleInfo.displayName, baseIndex);
            // Send a generic wake-up message (empty line followed by Enter)
            (0, tmuxClient_2.sendKeys)(socketPath, target, 'Enter');
        },
        triggerRespawn: (role) => {
            (0, tmuxClient_2.respawnAgent)(targetPath, role);
        },
        logDeadLetter: (_role, _filePath) => {
            // Dead letter logging can be extended in future iterations
        },
        // Activity = the pane's captured content changing (tool output, prompts)
        // or the role's outbox being written. Judged per sweep; a role showing
        // any of these within the stuck threshold is never chased (BL-067).
        getLastActivityMs: (role) => {
            const roleInfo = roles.find((r) => r.role === role);
            if (!roleInfo)
                return Date.now();
            const baseIndex = (0, tmuxClient_2.getPaneBaseIndex)(socketPath);
            const target = (0, tmuxClient_2.paneTarget)(roleInfo.session, roleInfo.displayName, baseIndex);
            const capture = (0, tmuxClient_2.capturePane)(socketPath, target, -50);
            const pane = capture.exitCode === 0 ? capture.stdout : '';
            return (0, paneActivity_1.trackPaneActivity)(role, pane, (0, paneActivity_1.outboxNewestMtimeMs)(targetPath, role), Date.now());
        },
        onStuckEscalation: (role, escalated) => {
            (0, stuckEscalations_1.setStuckEscalation)(role, escalated);
        },
    };
    // Start the chaser monitor
    currentChaserMonitor = (0, chaserMonitor_1.startChaserMonitor)(chaserConfig, callbacks);
    // Add to subscriptions for cleanup
    if (currentChaserMonitor) {
        context.subscriptions.push({
            dispose: () => {
                if (currentChaserMonitor) {
                    (0, chaserMonitor_1.stopChaserMonitor)(currentChaserMonitor);
                    currentChaserMonitor = null;
                }
            },
        });
    }
}
// BL-069: performs the real verified bounce (BL-058 path) for a graceful
// drain that just reached all-idle, or for a human-forced immediate bounce
// that skips the rest of the drain. Always stops the drain watcher and
// clears the sentinel first so neither path can double-fire.
async function performGracefulBounceNow(targetPath, bounceType, context) {
    if (currentBounceDrainWatcher) {
        (0, bounceDrain_1.stopBounceDrainWatcher)(currentBounceDrainWatcher);
        currentBounceDrainWatcher = null;
    }
    (0, bounceDrain_1.clearBounceDrainState)(targetPath);
    if (bounceType === 'extension') {
        await vscode.commands.executeCommand((0, bouncer_1.buildBounceExtensionCommand)());
        return;
    }
    if (bounceType === 'all') {
        const stopResult = (0, swarmStopper_1.stopSwarm)(targetPath);
        if (!stopResult.success) {
            vscode.window.showErrorMessage(`Failed to stop swarm: ${stopResult.message}`);
            return;
        }
        await context.workspaceState.update(PENDING_AUTO_LAUNCH_KEY, true);
        await vscode.commands.executeCommand((0, bouncer_1.buildBounceExtensionCommand)());
        return;
    }
    const validated = validateTargetAndLastRun(targetPath, context);
    if (!validated) {
        return;
    }
    const result = await (0, bouncer_1.bounceSwarm)(validated.targetPath, validated.lastRunName);
    if (!result.success) {
        vscode.window.showErrorMessage(result.message);
        return;
    }
    vscode.window.showInformationMessage(result.message);
    const panel = swarmPanel_1.SwarmPanel.currentPanel;
    if (panel) {
        panel.updateTarget(targetPath);
    }
    startOrRestartChaserMonitor(targetPath, context);
}
// BL-069: watches the durable drain sentinel and waits until every role
// simultaneously holds no in_process work (single file OR batch directory,
// reusing BL-067's scanInProcess) AND its pane is not actively working
// (reusing the watchdog liveness primitives), then performs the real bounce.
// Past the configured timeout with no all-idle, prompts the human once
// instead of waiting forever.
function startOrRestartBounceDrainWatcher(targetPath, context) {
    if (currentBounceDrainWatcher) {
        (0, bounceDrain_1.stopBounceDrainWatcher)(currentBounceDrainWatcher);
        currentBounceDrainWatcher = null;
    }
    const swarmforgeDir = path.join(targetPath, '.swarmforge');
    if (!fs.existsSync(swarmforgeDir)) {
        return;
    }
    const roles = (0, tmuxClient_2.readSwarmRoles)(targetPath);
    const roleInboxes = (0, chaserMonitor_1.buildRoleInboxes)(targetPath, roles.map((r) => r.role));
    const watchdogConfig = {
        staleTimeoutSeconds: WATCHDOG_STALE_TIMEOUT_SECONDS,
        inFlightTimeoutSeconds: WATCHDOG_IN_FLIGHT_TIMEOUT_SECONDS,
        deadTimeoutSeconds: WATCHDOG_DEAD_TIMEOUT_SECONDS,
    };
    const getRoleStatuses = () => roleInboxes.map(({ role, inProcessDir }) => {
        const hasInProcessWork = (0, inboxChaser_1.scanInProcess)(inProcessDir).length > 0;
        const hb = (0, heartbeat_1.readHeartbeat)(path.join(swarmforgeDir, 'heartbeat'), role);
        const liveness = (0, liveness_1.computeLiveness)(hb, Date.now(), watchdogConfig, hb ? true : false);
        const idle = liveness.state !== 'alive' && liveness.state !== 'stuck';
        return { role, hasInProcessWork, idle };
    });
    currentBounceDrainWatcher = (0, bounceDrain_1.startBounceDrainWatcher)({ targetPath, pollIntervalSeconds: BOUNCE_DRAIN_POLL_INTERVAL_SECONDS }, {
        getRoleStatuses,
        onBounce: (bounceType) => {
            void performGracefulBounceNow(targetPath, bounceType, context);
        },
        onTimeout: (bounceType, busyRoles) => {
            vscode.window
                .showWarningMessage(`Graceful bounce is still draining (busy: ${busyRoles.join(', ') || 'none'}). Keep waiting or bounce now?`, 'Keep Waiting', 'Bounce Now')
                .then((choice) => {
                if (choice === 'Bounce Now') {
                    void performGracefulBounceNow(targetPath, bounceType, context);
                }
            });
        },
    });
    context.subscriptions.push({
        dispose: () => {
            if (currentBounceDrainWatcher) {
                (0, bounceDrain_1.stopBounceDrainWatcher)(currentBounceDrainWatcher);
                currentBounceDrainWatcher = null;
            }
        },
    });
}
function beginGracefulBounce(targetPath, bounceType, context) {
    const config = vscode.workspace.getConfiguration('swarmforge');
    const timeoutSeconds = config.get('bounce.drainTimeoutSeconds', BOUNCE_DRAIN_TIMEOUT_SECONDS_DEFAULT);
    (0, bounceDrain_1.startBounceDrain)(targetPath, bounceType, timeoutSeconds);
    startOrRestartBounceDrainWatcher(targetPath, context);
    vscode.window.showInformationMessage('Graceful bounce: draining agents to idle before bouncing…');
}
// BL-069 "plus a variant of the existing remote-bounce sentinel": a
// .swarmforge/bounce-graceful file (same swarm|extension|all content as the
// existing immediate-bounce sentinel) starts a drain instead of bouncing now.
function startOrRestartGracefulBounceFileWatcher(targetPath, context) {
    if (currentGracefulBounceFileWatcher) {
        currentGracefulBounceFileWatcher.close();
        currentGracefulBounceFileWatcher = null;
    }
    currentGracefulBounceFileWatcher = (0, bounceDrain_1.startGracefulBounceFileWatcher)(targetPath, (bounceType) => beginGracefulBounce(targetPath, bounceType, context), (error) => vscode.window.showWarningMessage(`Graceful bounce trigger error: ${error}`));
    if (currentGracefulBounceFileWatcher) {
        context.subscriptions.push({
            dispose: () => {
                currentGracefulBounceFileWatcher?.close();
                currentGracefulBounceFileWatcher = null;
            },
        });
    }
}
async function resolveTargetPath(context) {
    let targetPath = (0, targetConfig_1.getTargetPath)();
    if (!targetPath) {
        targetPath = await (0, targetConfig_1.setTargetPath)(context);
    }
    return targetPath;
}
function validateTargetAndLastRun(targetPath, context) {
    if (!targetPath) {
        vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
        return null;
    }
    const lastRunName = context.globalState.get(LAST_RUN_NAME_KEY);
    if (!lastRunName) {
        vscode.window.showWarningMessage('No previous run name stored. Use SwarmForge: Launch Swarm first.');
        return null;
    }
    return { targetPath, lastRunName };
}
function activate(context) {
    // Lets the dev-host bounce script verify a fresh activation (BL-058);
    // written only in Development extension mode.
    (0, devActivationMarker_1.maybeWriteActivationMarker)(context.extensionMode === vscode.ExtensionMode.Development, context.extensionPath);
    const runLogPath = path.join(os.homedir(), '.swarmforge', 'runs.jsonl');
    // Start bounce watcher and chaser if target is already set
    const targetPath = (0, targetConfig_1.getTargetPath)();
    if (targetPath) {
        // BL-069 crash safety: a drain sentinel can only be stale here — a live
        // watcher would already be running to complete it — so any sentinel
        // found at extension startup is left over from a crashed session.
        (0, bounceDrain_1.clearBounceDrainState)(targetPath);
        startOrRestartBounceWatcher(context, targetPath);
        startOrRestartChaserMonitor(targetPath, context);
        startOrRestartGracefulBounceFileWatcher(targetPath, context);
    }
    // Check for pending auto-launch after extension reload
    const pendingAutoLaunch = context.workspaceState.get(PENDING_AUTO_LAUNCH_KEY);
    if (pendingAutoLaunch) {
        context.workspaceState.update(PENDING_AUTO_LAUNCH_KEY, undefined);
        const targetPath = (0, targetConfig_1.getTargetPath)();
        const lastRunName = context.globalState.get(LAST_RUN_NAME_KEY);
        if (targetPath && lastRunName) {
            vscode.window.showInformationMessage('Auto-launching swarm after reload...');
            (0, swarmLauncher_1.launchSwarm)(targetPath, lastRunName).then((result) => {
                if (result.success) {
                    vscode.window.showInformationMessage(result.message);
                    const panel = swarmPanel_1.SwarmPanel.createOrShow(context.extensionUri, targetPath, runLogPath, undefined, context.secrets);
                    panel.updateTarget(targetPath);
                    // Start chaser monitor after swarm is launched
                    startOrRestartChaserMonitor(targetPath, context);
                }
                else {
                    vscode.window.showErrorMessage(result.message);
                }
            });
        }
    }
    context.subscriptions.push(vscode.commands.registerCommand('swarmforge.testTmux', async () => {
        const result = (0, tmuxClient_1.listTmuxSessions)();
        if (result.exitCode !== 0) {
            vscode.window.showErrorMessage(`tmux unavailable: ${result.stderr || 'unknown error'}`);
            return;
        }
        const sessions = result.stdout || '(no sessions)';
        const doc = await vscode.workspace.openTextDocument({
            content: `# tmux list-sessions\n\n${sessions}\n`,
            language: 'markdown',
        });
        await vscode.window.showTextDocument(doc, { preview: false });
        vscode.window.showInformationMessage('tmux connection OK');
    }), vscode.commands.registerCommand('swarmforge.setTarget', async () => {
        await (0, targetConfig_1.setTargetPath)(context);
        const newTargetPath = (0, targetConfig_1.getTargetPath)();
        if (newTargetPath) {
            (0, bounceDrain_1.clearBounceDrainState)(newTargetPath);
            startOrRestartBounceWatcher(context, newTargetPath);
            startOrRestartChaserMonitor(newTargetPath, context);
            startOrRestartGracefulBounceFileWatcher(newTargetPath, context);
        }
    }), vscode.commands.registerCommand('swarmforge.initializeTarget', async () => {
        const targetPath = await resolveTargetPath(context);
        if (!targetPath) {
            return;
        }
        try {
            const result = await (0, targetBootstrap_1.initializeTargetRepo)(targetPath);
            const status = result.committed ? ' and committed' : '';
            vscode.window.showInformationMessage(`Initialized ${result.created.length} file(s)${status} in ${targetPath}.`);
            if (result.skipped.length > 0) {
                vscode.window.showInformationMessage(`Skipped existing prompt file(s): ${result.skipped.join(', ')}`);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to initialize target: ${message}`);
        }
    }), vscode.commands.registerCommand('swarmforge.launchSwarm', async () => {
        const targetPath = await resolveTargetPath(context);
        if (!targetPath) {
            return;
        }
        const config = vscode.workspace.getConfiguration('swarmforge');
        const promptEnabled = config.get('run.promptForName', true);
        const promptResult = promptEnabled
            ? await vscode.window.showInputBox({
                title: 'SwarmForge Run Name',
                prompt: 'Name this run (used for branch and PR title; leave blank for timestamp default)',
                placeHolder: 'e.g. fix-auth-bug',
                validateInput: () => undefined,
            })
            : '';
        const runName = (0, resolveRunName_1.resolveRunName)({ promptEnabled, promptResult, defaultName: generateDefaultRunName() });
        if (runName === undefined) {
            return;
        }
        await context.globalState.update(LAST_RUN_NAME_KEY, runName);
        (0, runLog_1.appendRun)(runLogPath, {
            name: runName,
            targetPath,
            startedAt: new Date().toISOString(),
        });
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Launching SwarmForge swarm...',
            cancellable: false,
        }, async () => {
            const result = await (0, swarmLauncher_1.launchSwarm)(targetPath, runName);
            if (!result.success) {
                vscode.window.showErrorMessage(result.message);
                return;
            }
            const ready = await (0, swarmLauncher_1.waitForSwarmReady)(targetPath);
            if (!ready) {
                vscode.window.showWarningMessage('Swarm process finished but state files were not detected yet.');
            }
            vscode.window.showInformationMessage(result.message);
            const panel = swarmPanel_1.SwarmPanel.createOrShow(context.extensionUri, targetPath, runLogPath, undefined, context.secrets);
            panel.updateTarget(targetPath);
            panel.notifyDogfoodCheckpoint();
            // Start chaser monitor after swarm is launched
            startOrRestartChaserMonitor(targetPath, context);
        });
    }), vscode.commands.registerCommand('swarmforge.openPanel', async () => {
        const targetPath = (0, targetConfig_1.getTargetPath)();
        if (!targetPath) {
            vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
            return;
        }
        swarmPanel_1.SwarmPanel.createOrShow(context.extensionUri, targetPath, runLogPath, undefined, context.secrets);
    }), vscode.commands.registerCommand('swarmforge.stopSwarm', async () => {
        const targetPath = (0, targetConfig_1.getTargetPath)();
        if (!targetPath) {
            vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
            return;
        }
        const confirmed = await vscode.window.showWarningMessage('Stop the SwarmForge swarm? This will kill all agent sessions.', { modal: true }, STOP_SWARM_BUTTON);
        if (confirmed !== STOP_SWARM_BUTTON) {
            return;
        }
        const result = (0, swarmStopper_1.stopSwarm)(targetPath);
        if (result.success) {
            vscode.window.showInformationMessage(result.message);
            // Stop chaser monitor when swarm is stopped
            if (currentChaserMonitor) {
                (0, chaserMonitor_1.stopChaserMonitor)(currentChaserMonitor);
                currentChaserMonitor = null;
            }
        }
        else {
            vscode.window.showWarningMessage(result.message);
        }
    }), vscode.commands.registerCommand('swarmforge.bounceSwarm', async () => {
        const validated = validateTargetAndLastRun((0, targetConfig_1.getTargetPath)(), context);
        if (!validated) {
            return;
        }
        const { targetPath, lastRunName } = validated;
        vscode.window.showInformationMessage('Restarting swarm...');
        const result = await (0, bouncer_1.bounceSwarm)(targetPath, lastRunName);
        if (!result.success) {
            vscode.window.showErrorMessage(result.message);
            return;
        }
        vscode.window.showInformationMessage(result.message);
        const panel = swarmPanel_1.SwarmPanel.currentPanel;
        if (panel) {
            panel.updateTarget(targetPath);
        }
        // Restart chaser monitor after swarm bounce
        startOrRestartChaserMonitor(targetPath, context);
    }), vscode.commands.registerCommand('swarmforge.bounceExtension', async () => {
        vscode.window.showInformationMessage('Reloading SwarmForge extension...');
        const reloadCmd = (0, bouncer_1.buildBounceExtensionCommand)();
        await vscode.commands.executeCommand(reloadCmd);
    }), vscode.commands.registerCommand('swarmforge.bounceAll', async () => {
        const validated = validateTargetAndLastRun((0, targetConfig_1.getTargetPath)(), context);
        if (!validated) {
            return;
        }
        const { targetPath } = validated;
        vscode.window.showInformationMessage('Stopping swarm and reloading extension...');
        const stopResult = (0, swarmStopper_1.stopSwarm)(targetPath);
        if (!stopResult.success) {
            vscode.window.showErrorMessage(`Failed to stop swarm: ${stopResult.message}`);
            return;
        }
        await context.workspaceState.update(PENDING_AUTO_LAUNCH_KEY, true);
        const reloadCmd = (0, bouncer_1.buildBounceExtensionCommand)();
        await vscode.commands.executeCommand(reloadCmd);
    }), 
    // BL-069: instruct all agents to finish their current work and refuse
    // new work, then bounce automatically once every role is idle.
    vscode.commands.registerCommand('swarmforge.bounceGraceful', async () => {
        const targetPath = (0, targetConfig_1.getTargetPath)();
        if (!targetPath) {
            vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
            return;
        }
        beginGracefulBounce(targetPath, 'swarm', context);
    }), vscode.commands.registerCommand('swarmforge.cancelBounceDrain', async () => {
        const targetPath = (0, targetConfig_1.getTargetPath)();
        if (!targetPath) {
            return;
        }
        if (currentBounceDrainWatcher) {
            (0, bounceDrain_1.stopBounceDrainWatcher)(currentBounceDrainWatcher);
            currentBounceDrainWatcher = null;
        }
        (0, bounceDrain_1.clearBounceDrainState)(targetPath);
        vscode.window.showInformationMessage('Graceful bounce drain cancelled — agents accept work again.');
    }), vscode.commands.registerCommand('swarmforge.forceBounceNow', async () => {
        const targetPath = (0, targetConfig_1.getTargetPath)();
        if (!targetPath) {
            vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
            return;
        }
        const drainState = (0, bounceDrain_1.readBounceDrainState)(targetPath);
        await performGracefulBounceNow(targetPath, drainState?.bounceType ?? 'swarm', context);
    }), vscode.commands.registerCommand('swarmforge.openPR', async () => {
        const targetPath = (0, targetConfig_1.getTargetPath)();
        if (!targetPath) {
            vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
            return;
        }
        const branch = (0, prCreator_1.getCurrentBranch)(targetPath);
        if (!branch) {
            vscode.window.showErrorMessage('Could not determine current branch in target repo.');
            return;
        }
        const lastRunName = context.globalState.get(LAST_RUN_NAME_KEY) ?? '';
        const title = await vscode.window.showInputBox({
            title: 'Open Pull Request',
            prompt: 'PR title',
            value: lastRunName,
            validateInput: (v) => (v.trim() ? undefined : 'PR title is required'),
        });
        if (!title) {
            return;
        }
        const result = (0, prCreator_1.openPullRequest)(targetPath, title.trim());
        if (result.success) {
            (0, runLog_1.updateLastRunForTarget)(runLogPath, targetPath, {
                prUrl: result.url,
                completedAt: new Date().toISOString(),
            });
            const open = 'Open in Browser';
            const choice = await vscode.window.showInformationMessage(result.message, open);
            if (choice === open && result.url) {
                vscode.env.openExternal(vscode.Uri.parse(result.url));
            }
        }
        else {
            vscode.window.showErrorMessage(result.message);
        }
    }), vscode.commands.registerCommand('swarmforge.showRuns', async () => {
        const runs = (0, runLog_1.loadRuns)(runLogPath);
        if (runs.length === 0) {
            vscode.window.showInformationMessage('No SwarmForge runs recorded yet.');
            return;
        }
        const items = runs
            .slice()
            .reverse()
            .map((r) => {
            const date = r.startedAt.slice(0, 10);
            const pr = r.prUrl ? `  PR: ${r.prUrl}` : '';
            return `${date}  ${r.name}  (${r.targetPath})${pr}`;
        });
        const doc = await vscode.workspace.openTextDocument({
            content: `# SwarmForge Runs\n\n${items.join('\n')}\n`,
            language: 'markdown',
        });
        await vscode.window.showTextDocument(doc, { preview: false });
    }), vscode.commands.registerCommand('swarmforge.showWorkTree', () => {
        const targetPath = (0, targetConfig_1.getTargetPath)();
        if (!targetPath) {
            vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
            return;
        }
        workTreePanel_1.WorkTreePanel.createOrShow(targetPath);
    }), vscode.commands.registerCommand('swarmforge.highlightTile', (role) => {
        swarmPanel_1.SwarmPanel.currentPanel?.highlightTile(role);
    }), vscode.commands.registerCommand('swarmforge.setRunMode', async () => {
        const current = context.workspaceState.get(RUN_MODE_KEY, 'one-shot');
        const picked = await vscode.window.showQuickPick([
            { label: 'one-shot', description: 'Stop after the current backlog item (default)', picked: current === 'one-shot' },
            { label: 'drain', description: 'Keep running until the backlog is empty or all items are blocked', picked: current === 'drain' },
        ], { title: 'SwarmForge Run Mode', placeHolder: 'Select run mode' });
        if (picked) {
            await context.workspaceState.update(RUN_MODE_KEY, picked.label);
            vscode.window.showInformationMessage(`SwarmForge run mode set to: ${picked.label}`);
        }
    }), vscode.commands.registerCommand('swarmforge.drainCheck', async () => {
        const targetPath = (0, targetConfig_1.getTargetPath)();
        if (!targetPath) {
            return;
        }
        const runMode = context.workspaceState.get(RUN_MODE_KEY, 'one-shot');
        if (runMode !== 'drain') {
            return;
        }
        const items = (0, backlogReader_1.readBacklog)(targetPath);
        const next = (0, backlogLoop_1.nextEligibleItem)(items);
        if (!next) {
            vscode.window.showInformationMessage('SwarmForge: Backlog drained — no eligible next item.');
            return;
        }
        const go = 'Launch Next Item';
        const choice = await vscode.window.showInformationMessage(`Drain mode: next eligible item is ${next.id} — "${next.title}". Launch now?`, go);
        if (choice !== go) {
            return;
        }
        const runName = next.id.toLowerCase();
        await context.globalState.update(LAST_RUN_NAME_KEY, runName);
        (0, runLog_1.appendRun)(runLogPath, { name: runName, targetPath, startedAt: new Date().toISOString() });
        const result = await (0, swarmLauncher_1.launchSwarm)(targetPath, runName);
        if (!result.success) {
            vscode.window.showErrorMessage(result.message);
            return;
        }
        const panel = swarmPanel_1.SwarmPanel.createOrShow(context.extensionUri, targetPath, runLogPath, undefined, context.secrets);
        panel.updateTarget(targetPath);
    }));
}
function deactivate() {
    swarmPanel_1.SwarmPanel.currentPanel?.dispose();
    if (currentBounceWatcher) {
        currentBounceWatcher.close();
        currentBounceWatcher = null;
    }
}
//# sourceMappingURL=extension.js.map