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
const bridgeServer_1 = require("./bridge/bridgeServer");
const bridgeToken_1 = require("./bridge/bridgeToken");
const prCreator_1 = require("./swarm/prCreator");
const swarmLauncher_1 = require("./swarm/swarmLauncher");
const childJobRegistry_1 = require("./swarm/childJobRegistry");
const stateDump_1 = require("./swarm/stateDump");
const swarmDiscovery_1 = require("./swarm/swarmDiscovery");
const swarmStopper_1 = require("./swarm/swarmStopper");
const bouncer_1 = require("./swarm/bouncer");
const tmuxClient_1 = require("./swarm/tmuxClient");
const resolveRunName_1 = require("./run/resolveRunName");
const bounceWatcher_1 = require("./swarm/bounceWatcher");
const bounceAck_1 = require("./swarm/bounceAck");
const chaserMonitor_1 = require("./watchdog/chaserMonitor");
const tmuxClient_2 = require("./swarm/tmuxClient");
const verifiedInject_1 = require("./swarm/verifiedInject");
const paneActivity_1 = require("./watchdog/paneActivity");
const stuckEscalations_1 = require("./watchdog/stuckEscalations");
const inboxChaser_1 = require("./swarm/inboxChaser");
const needsHumanDetection_1 = require("./panel/needsHumanDetection");
const humanInputTracker_1 = require("./swarm/humanInputTracker");
const idleClear_1 = require("./swarm/idleClear");
const contextFullness_1 = require("./swarm/contextFullness");
const bounceDrain_1 = require("./swarm/bounceDrain");
const heartbeat_1 = require("./tools/heartbeat");
const devActivationMarker_1 = require("./devActivationMarker");
const liveness_1 = require("./watchdog/liveness");
const secrets_1 = require("./notify/secrets");
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
const CHASER_RESPAWN_COOLDOWN_SECONDS = 300;
const CHASER_MAX_RECOVERY_ATTEMPTS = 3;
const BOUNCE_DRAIN_POLL_INTERVAL_SECONDS = 5;
const BOUNCE_DRAIN_TIMEOUT_SECONDS_DEFAULT = 900;
const CONTEXT_CLEAR_POLL_INTERVAL_SECONDS = 15;
const CONTEXT_CLEAR_SETTLE_WINDOW_SECONDS_DEFAULT = 120;
// BL-141: no backend this extension drives currently reports real context-
// token usage, so the fullness gate always runs on the proxy tier for now
// (resolveContextFullness still takes a telemetryPercent parameter so a
// backend that starts reporting it plugs straight in without a redesign).
const CONTEXT_CLEAR_FULLNESS_THRESHOLD_PERCENT_DEFAULT = 75;
// Proxy: pane-history line count treated as "full" for contextFullness's
// deterministic proxy metric. capturePane below reads the last 400 lines of
// scrollback, so that count is "100% full" on this proxy's scale.
const CONTEXT_CLEAR_PROXY_FULL_AT_LINE_COUNT = 400;
// BL-080: short retry window for the activation re-attach check when no
// swarm socket is on disk yet - this only smooths a transient probe flake,
// not a real boot.
const REATTACH_READY_TIMEOUT_MS = 3000;
const REATTACH_READY_POLL_MS = 200;
// BL-084: when a swarm socket already exists at activation, a genuine cold
// start is under way (N tmux sessions each spawning a fresh `claude`), which
// routinely exceeds the 3s flake-smoothing budget above. Match the
// launcher's own readiness budget (launchSwarm's default readyTimeoutMs) so
// a slow-but-real cold start still attaches automatically instead of
// falling through to "previous run found, resume?".
const REATTACH_COLD_START_TIMEOUT_MS = 120_000;
// BL-108: grace window between SIGTERM and SIGKILL when deactivate() reaps
// a tracked child-job process group.
const DEACTIVATE_REAP_GRACE_MS = 5_000;
let currentBounceWatcher = null;
let currentChaserMonitor = null;
let currentBounceDrainWatcher = null;
let currentGracefulBounceFileWatcher = null;
let currentIdleClearMonitor = null;
let idleClearOutputChannel;
let bounceOutputChannel;
let currentBridge = null;
// BL-108: deactivate() has no other route to the target's .swarmforge dir
// (activate's targetPath is function-scoped) - remembered here so a spawned
// child-job registry can be reaped on the way out, same pattern as the
// other current* singletons above.
let currentSwarmforgeDir = null;
let currentTargetPath = null;
let stopPeriodicStateDump = null;
// BL-110: how often the durable extension-state snapshot is refreshed so an
// abrupt host kill (no deactivate()) still leaves a recent dump.
const STATE_DUMP_INTERVAL_MS = 60_000;
function buildExtensionStateSnapshot(targetPath, reason) {
    const roles = targetPath ? (0, tmuxClient_2.readSwarmRoles)(targetPath) : [];
    return {
        timestamp: new Date().toISOString(),
        target: targetPath ?? undefined,
        attachState: targetPath && (0, swarmLauncher_1.isSwarmReady)(targetPath) ? 'attached' : 'not-attached',
        launchState: targetPath && (0, swarmLauncher_1.isSwarmReady)(targetPath) ? 'ready' : 'unknown',
        swarmInfo: { roles: roles.map((r) => r.role) },
        reason,
    };
}
function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
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
        respawnCooldownSeconds: CHASER_RESPAWN_COOLDOWN_SECONDS,
        maxRecoveryAttempts: CHASER_MAX_RECOVERY_ATTEMPTS,
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
            // BL-137 follow-up: the extension chaser may still conclude a role
            // needs intervention, but it must not automatically respawn panes.
            // Manual panel restarts continue to use respawnAgent deliberately.
            (0, stuckEscalations_1.setStuckEscalation)(role, true);
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
// BL-107: durable acknowledgement for bounce requests. remote_bounce.sh's
// sentinel write is fire-and-forget; this records each phase transition to
// .swarmforge/bounce-ack.json (pollable by a human or an agent script) and
// to a dedicated output channel, so a requester can tell "still working"
// from "nobody picked this up".
function logBouncePhase(targetPath, context, bounceType, phase, message) {
    const updatedAt = new Date().toISOString();
    (0, bounceAck_1.writeBounceAck)(targetPath, { bounceType, phase, updatedAt, message });
    if (!bounceOutputChannel) {
        bounceOutputChannel = vscode.window.createOutputChannel('SwarmForge: Bounce');
        context.subscriptions.push(bounceOutputChannel);
    }
    bounceOutputChannel.appendLine(`[${updatedAt}] bounce ${bounceType}: ${phase}${message ? ` — ${message}` : ''}`);
}
function handleBounceResult(result, targetPath, context) {
    if (!result.success) {
        vscode.window.showErrorMessage(result.message);
        return false;
    }
    vscode.window.showInformationMessage(result.message);
    const panel = swarmPanel_1.SwarmPanel.currentPanel;
    if (panel) {
        panel.updateTarget(targetPath);
    }
    startOrRestartChaserMonitor(targetPath, context);
    startOrRestartIdleClearMonitor(targetPath, context);
    return true;
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
        logBouncePhase(targetPath, context, bounceType, 'relaunching', 'Reloading extension window');
        await vscode.commands.executeCommand((0, bouncer_1.buildBounceExtensionCommand)());
        return;
    }
    if (bounceType === 'all') {
        // BL-107: the relaunch leg must complete (stop + relaunch + verify
        // ready — the existing 'swarm' bounce path) BEFORE the window reload.
        // Reloading first and relying on a pendingAutoLaunch flag consumed at
        // activation left the auto-launch unreachable when the reload only
        // fired onCommand activation; bouncing first removes that dependency
        // entirely, since a reloaded extension re-attaches to an already-live
        // swarm.
        const validated = validateTargetAndLastRun(targetPath, context);
        if (!validated) {
            return;
        }
        logBouncePhase(targetPath, context, bounceType, 'stopping', 'Stopping swarm before relaunch');
        const bounceResult = await (0, bouncer_1.bounceSwarm)(validated.targetPath, validated.lastRunName);
        if (!bounceResult.success) {
            logBouncePhase(targetPath, context, bounceType, 'failed', bounceResult.message);
            vscode.window.showErrorMessage(bounceResult.message);
            return;
        }
        logBouncePhase(targetPath, context, bounceType, 'relaunching', 'Swarm relaunched and verified ready; reloading extension window');
        await vscode.commands.executeCommand((0, bouncer_1.buildBounceExtensionCommand)());
        logBouncePhase(targetPath, context, bounceType, 'done', 'Extension window reload triggered');
        return;
    }
    const validated = validateTargetAndLastRun(targetPath, context);
    if (!validated) {
        return;
    }
    logBouncePhase(targetPath, context, bounceType, 'stopping', 'Stopping swarm before relaunch');
    const result = await (0, bouncer_1.bounceSwarm)(validated.targetPath, validated.lastRunName);
    if (!result.success) {
        logBouncePhase(targetPath, context, bounceType, 'failed', result.message);
    }
    else {
        logBouncePhase(targetPath, context, bounceType, 'done', result.message);
    }
    handleBounceResult(result, targetPath, context);
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
    logBouncePhase(targetPath, context, bounceType, 'draining', 'Waiting for all roles to go idle');
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
// BL-076: sends "/clear" to a role's pane once it has been drained-idle
// through a settle window (no work held or queued, no pending question, no
// recent human keystroke, no output change), so the next parcel starts with
// a fresh context window. Reuses BL-069's drain-idle primitives
// (scanInProcess/scanInboxNew, buildRoleInboxes) and BL-067's pane-activity
// tracking wherever they already fit, rather than re-deriving them.
function startOrRestartIdleClearMonitor(targetPath, context) {
    if (currentIdleClearMonitor) {
        (0, idleClear_1.stopIdleClearMonitor)(currentIdleClearMonitor);
        currentIdleClearMonitor = null;
    }
    const swarmforgeDir = path.join(targetPath, '.swarmforge');
    if (!fs.existsSync(swarmforgeDir)) {
        return;
    }
    const socketPath = (0, tmuxClient_2.readTmuxSocket)(targetPath);
    if (!socketPath) {
        return;
    }
    if (!idleClearOutputChannel) {
        idleClearOutputChannel = vscode.window.createOutputChannel('SwarmForge: Context Clear');
        context.subscriptions.push(idleClearOutputChannel);
    }
    const outputChannel = idleClearOutputChannel;
    const config = vscode.workspace.getConfiguration('swarmforge');
    const monitorConfig = {
        enabled: config.get('contextClear.enabled', true),
        settleWindowSeconds: config.get('contextClear.settleWindowSeconds', CONTEXT_CLEAR_SETTLE_WINDOW_SECONDS_DEFAULT),
        fullnessThresholdPercent: config.get('contextClear.fullnessThresholdPercent', CONTEXT_CLEAR_FULLNESS_THRESHOLD_PERCENT_DEFAULT),
        pollIntervalSeconds: CONTEXT_CLEAR_POLL_INTERVAL_SECONDS,
    };
    const roles = (0, tmuxClient_2.readSwarmRoles)(targetPath);
    const roleInboxes = (0, chaserMonitor_1.buildRoleInboxes)(targetPath, roles.map((r) => r.role));
    const baseIndex = (0, tmuxClient_2.getPaneBaseIndex)(socketPath);
    const paneTargetFor = (role) => {
        const roleInfo = roles.find((r) => r.role === role);
        return roleInfo ? (0, tmuxClient_2.paneTarget)(roleInfo.session, roleInfo.displayName, baseIndex) : null;
    };
    const getRoleStatuses = () => roleInboxes.map(({ role, inboxNewDir, inProcessDir }) => {
        const target = paneTargetFor(role);
        const capture = target ? (0, tmuxClient_2.capturePane)(socketPath, target, -50) : null;
        const paneText = capture && capture.exitCode === 0 ? capture.stdout : '';
        // BL-141: no backend here reports real context-token usage, so
        // telemetryPercent is always null for now and the proxy metric always
        // decides — see resolveContextFullness/contextFullness.ts. The proxy
        // reads a longer scrollback capture than the 50-line needs-human
        // check above, since fullness needs the whole accumulated history.
        const fullnessCapture = target
            ? (0, tmuxClient_2.capturePane)(socketPath, target, -CONTEXT_CLEAR_PROXY_FULL_AT_LINE_COUNT)
            : null;
        const fullnessLineCount = fullnessCapture && fullnessCapture.exitCode === 0
            ? fullnessCapture.stdout.split('\n').length
            : 0;
        return {
            role,
            hasInProcessWork: (0, inboxChaser_1.scanInProcess)(inProcessDir).length > 0,
            hasQueuedNew: (0, inboxChaser_1.scanInboxNew)(inboxNewDir).length > 0,
            needsHumanPending: (0, needsHumanDetection_1.detectNeedsHuman)(paneText) || (0, stuckEscalations_1.escalatedStuckRoles)().includes(role),
            drainInProgress: (0, bounceDrain_1.readBounceDrainState)(targetPath) !== null,
            lastHumanInputMs: (0, humanInputTracker_1.lastHumanInputMs)(role),
            lastActivityMs: (0, paneActivity_1.trackPaneActivity)(role, paneText, (0, paneActivity_1.outboxNewestMtimeMs)(targetPath, role), Date.now()),
            contextFullness: (0, contextFullness_1.resolveContextFullness)(null, (0, contextFullness_1.estimateProxyFullnessPercent)(fullnessLineCount, CONTEXT_CLEAR_PROXY_FULL_AT_LINE_COUNT)),
        };
    });
    currentIdleClearMonitor = (0, idleClear_1.startIdleClearMonitor)(monitorConfig, {
        getRoleStatuses,
        sendClear: (role) => {
            const target = paneTargetFor(role);
            if (!target) {
                return;
            }
            // BL-093: verify /clear actually submits instead of fire-and-forget -
            // a lost Enter here would leave "/clear" sitting typed-but-unsubmitted
            // in the role's input box.
            const result = (0, verifiedInject_1.sendInstructionVerified)({
                capturePane: () => {
                    const captured = (0, tmuxClient_2.capturePane)(socketPath, target);
                    return captured.exitCode === 0 ? captured.stdout : '';
                },
                sendLiteral: (text) => (0, tmuxClient_2.sendKeys)(socketPath, target, text, true).exitCode === 0,
                sendEnter: () => (0, tmuxClient_2.sendKeys)(socketPath, target, 'Enter'),
                wait: tmuxClient_2.sleepSync,
            }, '/clear');
            if (result.status !== 'delivered') {
                // Report, never silently drop (BL-093 verified-submit-02): this is
                // the one call site that previously discarded the result entirely.
                outputChannel.appendLine(`/clear delivery ${result.status} for "${role}" in pane ${target} after ${result.attempts} attempt(s)${result.reason ? `: ${result.reason}` : ''}`);
            }
        },
        log: (message) => {
            outputChannel.appendLine(message);
        },
    });
    context.subscriptions.push({
        dispose: () => {
            if (currentIdleClearMonitor) {
                (0, idleClear_1.stopIdleClearMonitor)(currentIdleClearMonitor);
                currentIdleClearMonitor = null;
            }
        },
    });
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
    const pendingAutoLaunch = context.workspaceState.get(PENDING_AUTO_LAUNCH_KEY);
    if (targetPath) {
        currentSwarmforgeDir = path.join(targetPath, '.swarmforge');
        currentTargetPath = targetPath;
        // BL-110 state-dump-02: a periodically-refreshed durable snapshot, so an
        // abrupt host kill (no deactivate()) still leaves a recent one to
        // recover/debug from.
        stopPeriodicStateDump = (0, stateDump_1.startPeriodicStateDump)(currentSwarmforgeDir, () => buildExtensionStateSnapshot(currentTargetPath, null), STATE_DUMP_INTERVAL_MS, setInterval, clearInterval);
        // BL-108 startup-reaper-03: a host killed without deactivate() (VS
        // Code's "Stop Extension Host" can SIGKILL without awaiting it) leaves
        // registry entries whose owner_host_pid died with it. Reap those
        // groups now, before anything else starts, so a fresh activation never
        // inherits a previous session's orphaned process tree.
        (0, childJobRegistry_1.reapStaleTrackedJobs)(currentSwarmforgeDir, isPidAlive, (pgid, signal) => {
            try {
                process.kill(-pgid, signal);
            }
            catch {
                // already gone
            }
        });
        // BL-069 crash safety: a drain sentinel can only be stale here — a live
        // watcher would already be running to complete it — so any sentinel
        // found at extension startup is left over from a crashed session.
        (0, bounceDrain_1.clearBounceDrainState)(targetPath);
        startOrRestartBounceWatcher(context, targetPath);
        startOrRestartChaserMonitor(targetPath, context);
        startOrRestartGracefulBounceFileWatcher(targetPath, context);
        startOrRestartIdleClearMonitor(targetPath, context);
        // BL-066: a live swarm runs under tmux, independent of the extension
        // host — an editor reload never touches it. Skip when a deliberate
        // auto-launch is already pending below (BL-057's bounceAll flow), so
        // the two paths never race each other.
        if (!pendingAutoLaunch) {
            // BL-080: a bare isSwarmReady() call here is a single, un-retried
            // check of a four-condition probe (socket file, `tmux ls`, roles.tsv,
            // every role session) run at the exact instant the extension host
            // cold-starts - the moment on this machine most prone to transient
            // subprocess/resource contention. The swarm launcher never trusts a
            // single isSwarmReady() call either (waitForSwarmReady polls it for
            // up to 120s during an actual launch); activation had no equivalent
            // tolerance, so one flaked check against a genuinely live swarm fell
            // through to the "previous run found, resume?" prompt instead of
            // re-attaching - the reported defect. A short bounded retry (well
            // under launch's own timeout, since a live swarm is already up and
            // this is only smoothing a transient check, not waiting for a cold
            // boot) fixes the false negative without meaningfully delaying the
            // genuine cold-start case, where every retry still finds no socket.
            //
            // BL-084: BL-080's flat 3s only covers that transient-flake case. A
            // socket already present at activation means a real swarm cold start
            // is in progress (8 tmux sessions each spawning a fresh `claude`),
            // which routinely takes longer than 3s - so widen the wait budget to
            // the launcher's own budget in that case, without penalizing the
            // truly-empty (no socket) case.
            const reattachTimeoutMs = (0, swarmLauncher_1.chooseReattachTimeoutMs)((0, tmuxClient_2.readTmuxSocket)(targetPath) !== undefined, REATTACH_COLD_START_TIMEOUT_MS, REATTACH_READY_TIMEOUT_MS);
            // BL-086: this block now runs unprompted on every editor start (via
            // the added onStartupFinished activation event), not just after the
            // user happens to invoke a command. Treat it as startup-triggered:
            // attach silently in the background (preserveFocus) when a swarm is
            // live, and do nothing visible otherwise. shouldOfferResumePrompt's
            // non-startup branch stays reachable (and tested) for the case where
            // a command wins the activation race before onStartupFinished fires,
            // preserving today's resume-offer behavior on that path.
            const isStartupTriggeredActivation = true;
            (0, swarmLauncher_1.waitForSwarmReady)(targetPath, reattachTimeoutMs, REATTACH_READY_POLL_MS).then((ready) => {
                if (ready) {
                    // Re-attach automatically: tiles reconnect to the live output
                    // streams without restarting any agent. preserveFocus keeps the
                    // editor the operator opened into in the foreground.
                    const panel = swarmPanel_1.SwarmPanel.createOrShow(context.extensionUri, targetPath, runLogPath, undefined, context.secrets, isStartupTriggeredActivation);
                    panel.updateTarget(targetPath);
                }
                else if ((0, swarmDiscovery_1.shouldOfferResumePrompt)(isStartupTriggeredActivation, (0, swarmDiscovery_1.hasPriorRunState)(targetPath))) {
                    // Cold relaunch with no live processes: offer resume from the
                    // target's prior run rather than a silent no-op or a surprise
                    // cold start.
                    vscode.window
                        .showInformationMessage('A previous SwarmForge run was found for this target but is not currently live. Resume it?', 'Resume', 'Not Now')
                        .then((choice) => {
                        if (choice === 'Resume') {
                            vscode.commands.executeCommand('swarmforge.launchSwarm');
                        }
                    });
                }
            });
        }
    }
    // Check for pending auto-launch after extension reload
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
                    startOrRestartIdleClearMonitor(targetPath, context);
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
            startOrRestartIdleClearMonitor(newTargetPath, context);
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
            startOrRestartIdleClearMonitor(targetPath, context);
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
    }), vscode.commands.registerCommand('swarmforge.startBridge', async () => {
        const targetPath = (0, targetConfig_1.getTargetPath)();
        if (!targetPath) {
            vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
            return;
        }
        if (currentBridge) {
            vscode.window.showInformationMessage(`SwarmForge bridge already running on port ${currentBridge.port}.`);
            return;
        }
        // The token lives only in this extension host process and is shown
        // once to the user; it is never written into the target repo.
        const token = (0, bridgeToken_1.generateBridgeToken)();
        currentBridge = await (0, bridgeServer_1.startBridge)(targetPath, runLogPath, token);
        vscode.window.showInformationMessage(`SwarmForge bridge listening on http://127.0.0.1:${currentBridge.port} — token: ${token}`);
    }), vscode.commands.registerCommand('swarmforge.stopBridge', async () => {
        if (!currentBridge) {
            vscode.window.showInformationMessage('SwarmForge bridge is not running.');
            return;
        }
        currentBridge.stop();
        currentBridge = null;
        vscode.window.showInformationMessage('SwarmForge bridge stopped.');
    }), vscode.commands.registerCommand('swarmforge.bounceSwarm', async () => {
        const validated = validateTargetAndLastRun((0, targetConfig_1.getTargetPath)(), context);
        if (!validated) {
            return;
        }
        const { targetPath, lastRunName } = validated;
        vscode.window.showInformationMessage('Restarting swarm...');
        logBouncePhase(targetPath, context, 'swarm', 'stopping', 'Stopping swarm before relaunch');
        const result = await (0, bouncer_1.bounceSwarm)(targetPath, lastRunName);
        logBouncePhase(targetPath, context, 'swarm', result.success ? 'done' : 'failed', result.message);
        handleBounceResult(result, targetPath, context);
    }), vscode.commands.registerCommand('swarmforge.bounceExtension', async () => {
        const targetPath = (0, targetConfig_1.getTargetPath)();
        vscode.window.showInformationMessage('Reloading SwarmForge extension...');
        if (targetPath) {
            logBouncePhase(targetPath, context, 'extension', 'relaunching', 'Reloading extension window');
        }
        const reloadCmd = (0, bouncer_1.buildBounceExtensionCommand)();
        await vscode.commands.executeCommand(reloadCmd);
    }), vscode.commands.registerCommand('swarmforge.bounceAll', async () => {
        const validated = validateTargetAndLastRun((0, targetConfig_1.getTargetPath)(), context);
        if (!validated) {
            return;
        }
        const { targetPath, lastRunName } = validated;
        // BL-107: bounce (stop + relaunch + verify ready) FIRST, then reload
        // the window — see the matching fix in performGracefulBounceNow for
        // why the old stop -> pendingAutoLaunch -> reload order was unsafe.
        vscode.window.showInformationMessage('Restarting swarm before reloading extension...');
        logBouncePhase(targetPath, context, 'all', 'stopping', 'Stopping swarm before relaunch');
        const bounceResult = await (0, bouncer_1.bounceSwarm)(targetPath, lastRunName);
        if (!bounceResult.success) {
            logBouncePhase(targetPath, context, 'all', 'failed', bounceResult.message);
            vscode.window.showErrorMessage(bounceResult.message);
            return;
        }
        logBouncePhase(targetPath, context, 'all', 'relaunching', 'Swarm relaunched and verified ready; reloading extension window');
        const reloadCmd = (0, bouncer_1.buildBounceExtensionCommand)();
        await vscode.commands.executeCommand(reloadCmd);
        logBouncePhase(targetPath, context, 'all', 'done', 'Extension window reload triggered');
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
        (0, bounceAck_1.clearBounceAck)(targetPath);
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
    }), vscode.commands.registerCommand('swarmforge.setResendApiKey', async () => {
        const input = await vscode.window.showInputBox({
            title: 'SwarmForge: Set Resend API Key',
            prompt: 'Enter the Resend API key to store in SecretStorage',
            password: true,
            ignoreFocusOut: true,
        });
        const key = (0, secrets_1.trimmedResendKeyInput)(input);
        if (!key) {
            return;
        }
        await context.secrets.store(secrets_1.RESEND_SECRET_KEY, key);
        vscode.window.showInformationMessage((0, secrets_1.describeSetResult)(Boolean(process.env.RESEND_API_KEY)));
    }), vscode.commands.registerCommand('swarmforge.clearResendApiKey', async () => {
        await context.secrets.delete(secrets_1.RESEND_SECRET_KEY);
        vscode.window.showInformationMessage((0, secrets_1.describeClearResult)(Boolean(process.env.RESEND_API_KEY)));
    }));
}
function deactivate() {
    swarmPanel_1.SwarmPanel.currentPanel?.dispose();
    if (currentBounceWatcher) {
        currentBounceWatcher.close();
        currentBounceWatcher = null;
    }
    if (currentBridge) {
        currentBridge.stop();
        currentBridge = null;
    }
    // BL-108 deactivate-reap-02: a normal "stop the extension" must not leak
    // any process group this host spawned and tracked. Best-effort - a
    // partially-torn-down group must not block the rest of deactivate().
    if (currentSwarmforgeDir) {
        (0, childJobRegistry_1.reapAllTrackedJobs)(currentSwarmforgeDir, (pgid, signal) => {
            process.kill(-pgid, signal);
        }, DEACTIVATE_REAP_GRACE_MS);
    }
    // BL-110 state-dump-01: a final, best-effort dump with the known shutdown
    // reason, on top of the periodic snapshot above.
    if (stopPeriodicStateDump) {
        stopPeriodicStateDump();
        stopPeriodicStateDump = null;
    }
    if (currentSwarmforgeDir) {
        (0, stateDump_1.writeStateDump)(currentSwarmforgeDir, buildExtensionStateSnapshot(currentTargetPath, 'extension-deactivate'));
    }
}
//# sourceMappingURL=extension.js.map