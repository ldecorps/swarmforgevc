import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getTargetPath, setTargetPath } from './config/targetConfig';
import { initializeTargetRepo } from './config/targetBootstrap';
import { SwarmPanel } from './panel/swarmPanel';
import { WorkTreePanel } from './panel/workTreePanel';
import { nextEligibleItem } from './swarm/backlogLoop';
import { readBacklog } from './panel/backlogReader';
import { appendRun, loadRuns, updateLastRunForTarget } from './runs/runLog';
import { startBridge } from './bridge/bridgeServer';
import type { BridgeHandle } from './bridge/bridgeServer';
import { generateBridgeToken } from './bridge/bridgeToken';
import { getCurrentBranch, openPullRequest } from './swarm/prCreator';
import { launchSwarm, waitForSwarmReady, chooseReattachTimeoutMs, isSwarmReady } from './swarm/swarmLauncher';
import { reapAllTrackedJobs, reapStaleTrackedJobs } from './swarm/childJobRegistry';
import { writeStateDump, startPeriodicStateDump, ExtensionStateSnapshot } from './swarm/stateDump';
import { hasPriorRunState, shouldOfferResumePrompt } from './swarm/swarmDiscovery';
import { stopSwarm } from './swarm/swarmStopper';
import { bounceSwarm, buildBounceExtensionCommand } from './swarm/bouncer';
import { listTmuxSessions } from './swarm/tmuxClient';
import { resolveRunName } from './run/resolveRunName';
import { startBounceWatcher, BounceType } from './swarm/bounceWatcher';
import { writeBounceAck, clearBounceAck, BouncePhase } from './swarm/bounceAck';
import { startChaserMonitor, stopChaserMonitor, buildRoleInboxes } from './watchdog/chaserMonitor';
import type { ChaserMonitorConfig, ChaserCallbacks } from './watchdog/chaserMonitor';
import { readTmuxSocket, paneTarget, getPaneBaseIndex, sendKeys, capturePane, readSwarmRoles, sleepSync, respawnAgent } from './swarm/tmuxClient';
import { sendInstructionVerified, sendHandoffWakeUp } from './swarm/verifiedInject';
import { trackPaneActivity, outboxNewestMtimeMs } from './watchdog/paneActivity';
import { setStuckEscalation, escalatedStuckRoles } from './watchdog/stuckEscalations';
import { handleWedgedRespawnTrigger } from './watchdog/wedgedRespawn';
import { scanInProcess, scanInboxNew } from './swarm/inboxChaser';
import { detectNeedsHuman } from './panel/needsHumanDetection';
import { lastHumanInputMs } from './swarm/humanInputTracker';
import {
  startIdleClearMonitor,
  stopIdleClearMonitor,
} from './swarm/idleClear';
import type { IdleClearMonitorConfig, RoleIdleStatus } from './swarm/idleClear';
import { resolveContextFullness, estimateProxyFullnessPercent } from './swarm/contextFullness';
import {
  startBounceDrain,
  readBounceDrainState,
  clearBounceDrainState,
  startBounceDrainWatcher,
  stopBounceDrainWatcher,
  startGracefulBounceFileWatcher,
} from './swarm/bounceDrain';
import type { RoleDrainStatus } from './swarm/bounceDrain';
import { readHeartbeat } from './tools/heartbeat';
import { maybeWriteActivationMarker } from './devActivationMarker';
import { computeLiveness } from './watchdog/liveness';
import type { LivenessState, WatchdogConfig } from './watchdog/liveness';
import {
  RESEND_SECRET_KEY,
  trimmedResendKeyInput,
  describeSetResult,
  describeClearResult,
  resolveResendApiKey,
} from './notify/secrets';
import { startBriefingScheduler } from './notify/briefingScheduler';
import { startBriefingEmailWatcher } from './notify/briefingEmailWatcher';
import { sendResendEmail } from './notify/resendClient';

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
// BL-135: a recipient showing recent activity (busy, not stuck) is re-chased
// with a doubling backoff instead of on every CHASER_INTERVAL_SECONDS tick —
// 30s base, capped at 5 minutes, versus the ~5s-tick hammer that produced
// ~98 nudges in ~16min against a genuinely working coordinator.
const CHASER_BACKOFF_BASE_SECONDS = 30;
const CHASER_BACKOFF_MAX_SECONDS = 300;
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

type RunMode = 'one-shot' | 'drain';

let currentBounceWatcher: fs.FSWatcher | null = null;
let currentChaserMonitor: NodeJS.Timeout | null = null;
let currentBounceDrainWatcher: NodeJS.Timeout | null = null;
let currentGracefulBounceFileWatcher: fs.FSWatcher | null = null;
let currentIdleClearMonitor: NodeJS.Timeout | null = null;
let idleClearOutputChannel: vscode.OutputChannel | undefined;
let bounceOutputChannel: vscode.OutputChannel | undefined;
let chaserOutputChannel: vscode.OutputChannel | undefined;
let currentBridge: BridgeHandle | null = null;
// BL-108: deactivate() has no other route to the target's .swarmforge dir
// (activate's targetPath is function-scoped) - remembered here so a spawned
// child-job registry can be reaped on the way out, same pattern as the
// other current* singletons above.
let currentSwarmforgeDir: string | null = null;
let currentTargetPath: string | null = null;
let stopPeriodicStateDump: (() => void) | null = null;
// BL-110: how often the durable extension-state snapshot is refreshed so an
// abrupt host kill (no deactivate()) still leaves a recent dump.
const STATE_DUMP_INTERVAL_MS = 60_000;

// BL-099: the coder's slice of the daily briefing - scheduling the once-a-
// day "briefing due" nudge and sending each committed briefing exactly once.
// Composing the briefing's content is the coordinator role prompt's job
// (specifier-owned), not this extension code.
let stopBriefingScheduler: (() => void) | null = null;
let stopBriefingEmailWatcher: (() => void) | null = null;
const BRIEFING_HOUR_UTC = 8;
const BRIEFING_SCHEDULE_CHECK_INTERVAL_MS = 5 * 60_000;
const BRIEFING_EMAIL_CHECK_INTERVAL_MS = 2 * 60_000;

function buildExtensionStateSnapshot(targetPath: string | null, reason: string | null): ExtensionStateSnapshot {
  const roles = targetPath ? readSwarmRoles(targetPath) : [];
  return {
    timestamp: new Date().toISOString(),
    target: targetPath ?? undefined,
    attachState: targetPath && isSwarmReady(targetPath) ? 'attached' : 'not-attached',
    launchState: targetPath && isSwarmReady(targetPath) ? 'ready' : 'unknown',
    swarmInfo: { roles: roles.map((r) => r.role) },
    reason,
  };
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function generateDefaultRunName(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  return `run-${year}${month}${day}-${hour}${minute}`;
}

function startOrRestartBounceWatcher(
  context: vscode.ExtensionContext,
  targetPath: string
): void {
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
  const handleBounce = (bounceType: BounceType) => {
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

  const handleError = (error: string) => {
    vscode.window.showWarningMessage(`Bounce watcher error: ${error}`);
  };

  // Start the watcher
  currentBounceWatcher = startBounceWatcher(targetPath, handleBounce, handleError);

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

function startOrRestartChaserMonitor(targetPath: string, context: vscode.ExtensionContext): void {
  // Stop old chaser if it exists
  if (currentChaserMonitor) {
    stopChaserMonitor(currentChaserMonitor);
    currentChaserMonitor = null;
  }

  if (!chaserOutputChannel) {
    chaserOutputChannel = vscode.window.createOutputChannel('SwarmForge: Chaser');
    context.subscriptions.push(chaserOutputChannel);
  }
  const outputChannel = chaserOutputChannel;

  // Check if .swarmforge directory exists
  const swarmforgeDir = path.join(targetPath, '.swarmforge');
  if (!fs.existsSync(swarmforgeDir)) {
    return;
  }

  // Read tmux socket for sending wake-ups
  const socketPath = readTmuxSocket(targetPath);
  if (!socketPath) {
    return;
  }

  // Read swarm roles to know which inboxes to monitor
  const roles = readSwarmRoles(targetPath);
  const rolesList = roles.map((r) => r.role);

  // Default watchdog and chaser config
  const watchdogConfig: WatchdogConfig = {
    staleTimeoutSeconds: WATCHDOG_STALE_TIMEOUT_SECONDS,
    inFlightTimeoutSeconds: WATCHDOG_IN_FLIGHT_TIMEOUT_SECONDS,
    deadTimeoutSeconds: WATCHDOG_DEAD_TIMEOUT_SECONDS,
  };

  const chaserConfig: ChaserMonitorConfig = {
    targetPath,
    rolesList,
    chaseIntervalSeconds: CHASER_INTERVAL_SECONDS,
    chaseTimeoutSeconds: CHASER_TIMEOUT_SECONDS,
    maxChases: CHASER_MAX_CHASES,
    stuckInProcessTimeoutSeconds: CHASER_STUCK_IN_PROCESS_TIMEOUT_SECONDS,
    respawnCooldownSeconds: CHASER_RESPAWN_COOLDOWN_SECONDS,
    maxRecoveryAttempts: CHASER_MAX_RECOVERY_ATTEMPTS,
    chaseBackoffBaseSeconds: CHASER_BACKOFF_BASE_SECONDS,
    chaseBackoffMaxSeconds: CHASER_BACKOFF_MAX_SECONDS,
  };

  // Implement adapters for the chaser
  const callbacks: ChaserCallbacks = {
    getLiveness: (role: string): LivenessState => {
      const heartbeatDir = path.join(swarmforgeDir, 'heartbeat');
      const hb = readHeartbeat(heartbeatDir, role);
      const result = computeLiveness(hb, Date.now(), watchdogConfig, hb ? true : false);
      return result.state;
    },

    sendWakeUp: (role: string): void => {
      const roleInfo = roles.find((r) => r.role === role);
      if (!roleInfo) return;

      const baseIndex = getPaneBaseIndex(socketPath);
      const target = paneTarget(roleInfo.session, roleInfo.displayName, baseIndex);
      // BL-152: verified submit of the same wake message handoffd.bb's
      // notify! sends, instead of a bare unconfirmed Enter - this callback
      // is shared by both the chaser nudge and the BL-122 recovery
      // redelivery (see chaserMonitor.ts/handoffRecovery.ts).
      const result = sendHandoffWakeUp({
        capturePane: () => {
          const captured = capturePane(socketPath, target);
          return captured.exitCode === 0 ? captured.stdout : '';
        },
        sendLiteral: (text: string) => sendKeys(socketPath, target, text, true).exitCode === 0,
        sendEnter: () => sendKeys(socketPath, target, 'Enter'),
        wait: sleepSync,
      });
      if (result.status !== 'delivered') {
        outputChannel.appendLine(
          `handoff wake ${result.status} for "${role}" in pane ${target} after ${result.attempts} attempt(s)${result.reason ? `: ${result.reason}` : ''}`
        );
      }
    },

    triggerRespawn: (role: string): void => {
      // BL-147: reinstate automatic respawn as the escalation of last
      // resort, gated through respawnAgent's own busy-vs-wedged precheck
      // (a pane showing Claude Code's "esc to interrupt" busy footer is
      // never touched - the incident that motivated 5ef8dd9's blanket
      // disable) and bounded by the same maxRecoveryAttempts/
      // respawnCooldownSeconds config already used elsewhere, falling back
      // to the existing needs-human escalation on exhaustion.
      handleWedgedRespawnTrigger(
        role,
        Date.now(),
        {
          maxRecoveryAttempts: chaserConfig.maxRecoveryAttempts,
          respawnCooldownSeconds: chaserConfig.respawnCooldownSeconds,
        },
        {
          respawnAgent: (r: string) => respawnAgent(targetPath, r),
          setStuckEscalation,
        }
      );
    },

    logDeadLetter: (_role: string, _filePath: string): void => {
      // Dead letter logging can be extended in future iterations
    },

    // Activity = the pane's captured content changing (tool output, prompts)
    // or the role's outbox being written. Judged per sweep; a role showing
    // any of these within the stuck threshold is never chased (BL-067).
    getLastActivityMs: (role: string): number => {
      const roleInfo = roles.find((r) => r.role === role);
      if (!roleInfo) return Date.now();
      const baseIndex = getPaneBaseIndex(socketPath);
      const target = paneTarget(roleInfo.session, roleInfo.displayName, baseIndex);
      const capture = capturePane(socketPath, target, -50);
      const pane = capture.exitCode === 0 ? capture.stdout : '';
      return trackPaneActivity(role, pane, outboxNewestMtimeMs(targetPath, role), Date.now());
    },

    onStuckEscalation: (role: string, escalated: boolean): void => {
      setStuckEscalation(role, escalated);
    },
  };

  // Start the chaser monitor
  currentChaserMonitor = startChaserMonitor(chaserConfig, callbacks);

  // Add to subscriptions for cleanup
  if (currentChaserMonitor) {
    context.subscriptions.push({
      dispose: () => {
        if (currentChaserMonitor) {
          stopChaserMonitor(currentChaserMonitor);
          currentChaserMonitor = null;
        }
      },
    });
  }
}

// BL-099: daily briefing - once-a-day nudge into the coordinator's pane
// (the coordinator's own role prompt composes and commits the briefing
// content, per the ticket's role-prompt-owned scope) plus a watcher that
// emails each committed docs/briefings/<date>.md exactly once. Reuses the
// existing BL-073 Resend client and secret storage; this extension code
// never holds the API key beyond the single resolveResendApiKey() call.
function startOrRestartDailyBriefing(targetPath: string, context: vscode.ExtensionContext): void {
  if (stopBriefingScheduler) {
    stopBriefingScheduler();
    stopBriefingScheduler = null;
  }
  if (stopBriefingEmailWatcher) {
    stopBriefingEmailWatcher();
    stopBriefingEmailWatcher = null;
  }

  const swarmforgeDir = path.join(targetPath, '.swarmforge');
  if (!fs.existsSync(swarmforgeDir)) {
    return;
  }

  const socketPath = readTmuxSocket(targetPath);
  const briefingsDir = path.join(targetPath, 'docs', 'briefings');

  stopBriefingScheduler = startBriefingScheduler(
    {
      briefingHourUtc: BRIEFING_HOUR_UTC,
      scheduleStatePath: path.join(swarmforgeDir, 'briefing-schedule.json'),
    },
    {
      getNowMs: () => Date.now(),
      onBriefingDue: (): void => {
        if (!socketPath) return;
        const roleEntry = readSwarmRoles(targetPath).find((r) => r.role === 'coordinator');
        if (!roleEntry) return;
        const target = paneTarget(roleEntry.session, roleEntry.displayName, getPaneBaseIndex(socketPath));
        sendInstructionVerified(
          {
            capturePane: () => {
              const captured = capturePane(socketPath, target);
              return captured.exitCode === 0 ? captured.stdout : '';
            },
            sendLiteral: (text: string) => sendKeys(socketPath, target, text, true).exitCode === 0,
            sendEnter: () => {
              sendKeys(socketPath, target, 'Enter');
            },
            wait: sleepSync,
          },
          'Daily briefing due: compose today\'s briefing per your role and commit it to docs/briefings/<date>.md.'
        );
      },
    },
    BRIEFING_SCHEDULE_CHECK_INTERVAL_MS,
    setInterval,
    clearInterval
  );

  let resendApiKey: string | undefined;
  resolveResendApiKey(context.secrets).then((key) => {
    resendApiKey = key ?? undefined;
  });
  const config = vscode.workspace.getConfiguration('swarmforge');
  const to = config.get<string>('notify.email.to', '');
  const from = config.get<string>('notify.email.from', 'onboarding@resend.dev');

  stopBriefingEmailWatcher = startBriefingEmailWatcher(
    briefingsDir,
    {
      readBriefingContent: (fileName: string) => fs.readFileSync(path.join(briefingsDir, fileName), 'utf-8'),
      sendEmail: async (subject: string, text: string) => {
        if (!resendApiKey || !to) return false;
        const result = await sendResendEmail(resendApiKey, { to, from, subject, text });
        return result.success;
      },
    },
    BRIEFING_EMAIL_CHECK_INTERVAL_MS,
    setInterval,
    clearInterval
  );

  context.subscriptions.push({
    dispose: () => {
      if (stopBriefingScheduler) {
        stopBriefingScheduler();
        stopBriefingScheduler = null;
      }
      if (stopBriefingEmailWatcher) {
        stopBriefingEmailWatcher();
        stopBriefingEmailWatcher = null;
      }
    },
  });
}

// BL-107: durable acknowledgement for bounce requests. remote_bounce.sh's
// sentinel write is fire-and-forget; this records each phase transition to
// .swarmforge/bounce-ack.json (pollable by a human or an agent script) and
// to a dedicated output channel, so a requester can tell "still working"
// from "nobody picked this up".
function logBouncePhase(
  targetPath: string,
  context: vscode.ExtensionContext,
  bounceType: BounceType,
  phase: BouncePhase,
  message?: string
): void {
  const updatedAt = new Date().toISOString();
  writeBounceAck(targetPath, { bounceType, phase, updatedAt, message });
  if (!bounceOutputChannel) {
    bounceOutputChannel = vscode.window.createOutputChannel('SwarmForge: Bounce');
    context.subscriptions.push(bounceOutputChannel);
  }
  bounceOutputChannel.appendLine(
    `[${updatedAt}] bounce ${bounceType}: ${phase}${message ? ` — ${message}` : ''}`
  );
}

function handleBounceResult(
  result: { success: boolean; message: string },
  targetPath: string,
  context: vscode.ExtensionContext
): boolean {
  if (!result.success) {
    vscode.window.showErrorMessage(result.message);
    return false;
  }
  vscode.window.showInformationMessage(result.message);
  const panel = SwarmPanel.currentPanel;
  if (panel) {
    panel.updateTarget(targetPath);
  }
  startOrRestartChaserMonitor(targetPath, context);
  startOrRestartDailyBriefing(targetPath, context);
  startOrRestartIdleClearMonitor(targetPath, context);
  return true;
}

// BL-069: performs the real verified bounce (BL-058 path) for a graceful
// drain that just reached all-idle, or for a human-forced immediate bounce
// that skips the rest of the drain. Always stops the drain watcher and
// clears the sentinel first so neither path can double-fire.
async function performGracefulBounceNow(
  targetPath: string,
  bounceType: BounceType,
  context: vscode.ExtensionContext
): Promise<void> {
  if (currentBounceDrainWatcher) {
    stopBounceDrainWatcher(currentBounceDrainWatcher);
    currentBounceDrainWatcher = null;
  }
  clearBounceDrainState(targetPath);

  if (bounceType === 'extension') {
    logBouncePhase(targetPath, context, bounceType, 'relaunching', 'Reloading extension window');
    await vscode.commands.executeCommand(buildBounceExtensionCommand());
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
    const bounceResult = await bounceSwarm(validated.targetPath, validated.lastRunName);
    if (!bounceResult.success) {
      logBouncePhase(targetPath, context, bounceType, 'failed', bounceResult.message);
      vscode.window.showErrorMessage(bounceResult.message);
      return;
    }
    logBouncePhase(
      targetPath,
      context,
      bounceType,
      'relaunching',
      'Swarm relaunched and verified ready; reloading extension window'
    );
    await vscode.commands.executeCommand(buildBounceExtensionCommand());
    logBouncePhase(targetPath, context, bounceType, 'done', 'Extension window reload triggered');
    return;
  }

  const validated = validateTargetAndLastRun(targetPath, context);
  if (!validated) {
    return;
  }
  logBouncePhase(targetPath, context, bounceType, 'stopping', 'Stopping swarm before relaunch');
  const result = await bounceSwarm(validated.targetPath, validated.lastRunName);
  if (!result.success) {
    logBouncePhase(targetPath, context, bounceType, 'failed', result.message);
  } else {
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
function startOrRestartBounceDrainWatcher(targetPath: string, context: vscode.ExtensionContext): void {
  if (currentBounceDrainWatcher) {
    stopBounceDrainWatcher(currentBounceDrainWatcher);
    currentBounceDrainWatcher = null;
  }

  const swarmforgeDir = path.join(targetPath, '.swarmforge');
  if (!fs.existsSync(swarmforgeDir)) {
    return;
  }

  const roles = readSwarmRoles(targetPath);
  const roleInboxes = buildRoleInboxes(targetPath, roles.map((r) => r.role));

  const watchdogConfig: WatchdogConfig = {
    staleTimeoutSeconds: WATCHDOG_STALE_TIMEOUT_SECONDS,
    inFlightTimeoutSeconds: WATCHDOG_IN_FLIGHT_TIMEOUT_SECONDS,
    deadTimeoutSeconds: WATCHDOG_DEAD_TIMEOUT_SECONDS,
  };

  const getRoleStatuses = (): RoleDrainStatus[] =>
    roleInboxes.map(({ role, inProcessDir }) => {
      const hasInProcessWork = scanInProcess(inProcessDir).length > 0;
      const hb = readHeartbeat(path.join(swarmforgeDir, 'heartbeat'), role);
      const liveness = computeLiveness(hb, Date.now(), watchdogConfig, hb ? true : false);
      const idle = liveness.state !== 'alive' && liveness.state !== 'stuck';
      return { role, hasInProcessWork, idle };
    });

  currentBounceDrainWatcher = startBounceDrainWatcher(
    { targetPath, pollIntervalSeconds: BOUNCE_DRAIN_POLL_INTERVAL_SECONDS },
    {
      getRoleStatuses,
      onBounce: (bounceType) => {
        void performGracefulBounceNow(targetPath, bounceType, context);
      },
      onTimeout: (bounceType, busyRoles) => {
        vscode.window
          .showWarningMessage(
            `Graceful bounce is still draining (busy: ${busyRoles.join(', ') || 'none'}). Keep waiting or bounce now?`,
            'Keep Waiting',
            'Bounce Now'
          )
          .then((choice) => {
            if (choice === 'Bounce Now') {
              void performGracefulBounceNow(targetPath, bounceType, context);
            }
          });
      },
    }
  );

  context.subscriptions.push({
    dispose: () => {
      if (currentBounceDrainWatcher) {
        stopBounceDrainWatcher(currentBounceDrainWatcher);
        currentBounceDrainWatcher = null;
      }
    },
  });
}

function beginGracefulBounce(
  targetPath: string,
  bounceType: BounceType,
  context: vscode.ExtensionContext
): void {
  const config = vscode.workspace.getConfiguration('swarmforge');
  const timeoutSeconds = config.get<number>(
    'bounce.drainTimeoutSeconds',
    BOUNCE_DRAIN_TIMEOUT_SECONDS_DEFAULT
  );
  startBounceDrain(targetPath, bounceType, timeoutSeconds);
  startOrRestartBounceDrainWatcher(targetPath, context);
  logBouncePhase(targetPath, context, bounceType, 'draining', 'Waiting for all roles to go idle');
  vscode.window.showInformationMessage(
    'Graceful bounce: draining agents to idle before bouncing…'
  );
}

// BL-069 "plus a variant of the existing remote-bounce sentinel": a
// .swarmforge/bounce-graceful file (same swarm|extension|all content as the
// existing immediate-bounce sentinel) starts a drain instead of bouncing now.
function startOrRestartGracefulBounceFileWatcher(
  targetPath: string,
  context: vscode.ExtensionContext
): void {
  if (currentGracefulBounceFileWatcher) {
    currentGracefulBounceFileWatcher.close();
    currentGracefulBounceFileWatcher = null;
  }

  currentGracefulBounceFileWatcher = startGracefulBounceFileWatcher(
    targetPath,
    (bounceType) => beginGracefulBounce(targetPath, bounceType, context),
    (error) => vscode.window.showWarningMessage(`Graceful bounce trigger error: ${error}`)
  );

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
function startOrRestartIdleClearMonitor(targetPath: string, context: vscode.ExtensionContext): void {
  if (currentIdleClearMonitor) {
    stopIdleClearMonitor(currentIdleClearMonitor);
    currentIdleClearMonitor = null;
  }

  const swarmforgeDir = path.join(targetPath, '.swarmforge');
  if (!fs.existsSync(swarmforgeDir)) {
    return;
  }

  const socketPath = readTmuxSocket(targetPath);
  if (!socketPath) {
    return;
  }

  if (!idleClearOutputChannel) {
    idleClearOutputChannel = vscode.window.createOutputChannel('SwarmForge: Context Clear');
    context.subscriptions.push(idleClearOutputChannel);
  }
  const outputChannel = idleClearOutputChannel;

  const config = vscode.workspace.getConfiguration('swarmforge');
  const monitorConfig: IdleClearMonitorConfig = {
    enabled: config.get<boolean>('contextClear.enabled', true),
    settleWindowSeconds: config.get<number>(
      'contextClear.settleWindowSeconds',
      CONTEXT_CLEAR_SETTLE_WINDOW_SECONDS_DEFAULT
    ),
    fullnessThresholdPercent: config.get<number>(
      'contextClear.fullnessThresholdPercent',
      CONTEXT_CLEAR_FULLNESS_THRESHOLD_PERCENT_DEFAULT
    ),
    pollIntervalSeconds: CONTEXT_CLEAR_POLL_INTERVAL_SECONDS,
  };

  const roles = readSwarmRoles(targetPath);
  const roleInboxes = buildRoleInboxes(targetPath, roles.map((r) => r.role));
  const baseIndex = getPaneBaseIndex(socketPath);

  const paneTargetFor = (role: string): string | null => {
    const roleInfo = roles.find((r) => r.role === role);
    return roleInfo ? paneTarget(roleInfo.session, roleInfo.displayName, baseIndex) : null;
  };

  const getRoleStatuses = (): RoleIdleStatus[] =>
    roleInboxes.map(({ role, inboxNewDir, inProcessDir }) => {
      const target = paneTargetFor(role);
      const capture = target ? capturePane(socketPath, target, -50) : null;
      const paneText = capture && capture.exitCode === 0 ? capture.stdout : '';
      // BL-141: no backend here reports real context-token usage, so
      // telemetryPercent is always null for now and the proxy metric always
      // decides — see resolveContextFullness/contextFullness.ts. The proxy
      // reads a longer scrollback capture than the 50-line needs-human
      // check above, since fullness needs the whole accumulated history.
      const fullnessCapture = target
        ? capturePane(socketPath, target, -CONTEXT_CLEAR_PROXY_FULL_AT_LINE_COUNT)
        : null;
      const fullnessLineCount =
        fullnessCapture && fullnessCapture.exitCode === 0
          ? fullnessCapture.stdout.split('\n').length
          : 0;
      return {
        role,
        hasInProcessWork: scanInProcess(inProcessDir).length > 0,
        hasQueuedNew: scanInboxNew(inboxNewDir).length > 0,
        needsHumanPending: detectNeedsHuman(paneText) || escalatedStuckRoles().includes(role),
        drainInProgress: readBounceDrainState(targetPath) !== null,
        lastHumanInputMs: lastHumanInputMs(role),
        lastActivityMs: trackPaneActivity(role, paneText, outboxNewestMtimeMs(targetPath, role), Date.now()),
        contextFullness: resolveContextFullness(
          null,
          estimateProxyFullnessPercent(fullnessLineCount, CONTEXT_CLEAR_PROXY_FULL_AT_LINE_COUNT)
        ),
      };
    });

  currentIdleClearMonitor = startIdleClearMonitor(monitorConfig, {
    getRoleStatuses,
    sendClear: (role: string): void => {
      const target = paneTargetFor(role);
      if (!target) {
        return;
      }
      // BL-093: verify /clear actually submits instead of fire-and-forget -
      // a lost Enter here would leave "/clear" sitting typed-but-unsubmitted
      // in the role's input box.
      const result = sendInstructionVerified(
        {
          capturePane: () => {
            const captured = capturePane(socketPath, target);
            return captured.exitCode === 0 ? captured.stdout : '';
          },
          sendLiteral: (text: string) => sendKeys(socketPath, target, text, true).exitCode === 0,
          sendEnter: () => sendKeys(socketPath, target, 'Enter'),
          wait: sleepSync,
        },
        '/clear'
      );
      if (result.status !== 'delivered') {
        // Report, never silently drop (BL-093 verified-submit-02): this is
        // the one call site that previously discarded the result entirely.
        outputChannel.appendLine(
          `/clear delivery ${result.status} for "${role}" in pane ${target} after ${result.attempts} attempt(s)${result.reason ? `: ${result.reason}` : ''}`
        );
      }
    },
    log: (message: string): void => {
      outputChannel.appendLine(message);
    },
  });

  context.subscriptions.push({
    dispose: () => {
      if (currentIdleClearMonitor) {
        stopIdleClearMonitor(currentIdleClearMonitor);
        currentIdleClearMonitor = null;
      }
    },
  });
}

async function resolveTargetPath(context: vscode.ExtensionContext): Promise<string | undefined> {
  let targetPath = getTargetPath();
  if (!targetPath) {
    targetPath = await setTargetPath(context);
  }
  return targetPath;
}

function validateTargetAndLastRun(
  targetPath: string | undefined,
  context: vscode.ExtensionContext
): { targetPath: string; lastRunName: string } | null {
  if (!targetPath) {
    vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
    return null;
  }

  const lastRunName = context.globalState.get<string>(LAST_RUN_NAME_KEY);
  if (!lastRunName) {
    vscode.window.showWarningMessage(
      'No previous run name stored. Use SwarmForge: Launch Swarm first.'
    );
    return null;
  }

  return { targetPath, lastRunName };
}

export function activate(context: vscode.ExtensionContext): void {
  // Lets the dev-host bounce script verify a fresh activation (BL-058);
  // written only in Development extension mode.
  maybeWriteActivationMarker(
    context.extensionMode === vscode.ExtensionMode.Development,
    context.extensionPath
  );

  const runLogPath = path.join(os.homedir(), '.swarmforge', 'runs.jsonl');

  // Start bounce watcher and chaser if target is already set
  const targetPath = getTargetPath();
  const pendingAutoLaunch = context.workspaceState.get<boolean>(PENDING_AUTO_LAUNCH_KEY);
  if (targetPath) {
    currentSwarmforgeDir = path.join(targetPath, '.swarmforge');
    currentTargetPath = targetPath;
    // BL-110 state-dump-02: a periodically-refreshed durable snapshot, so an
    // abrupt host kill (no deactivate()) still leaves a recent one to
    // recover/debug from.
    stopPeriodicStateDump = startPeriodicStateDump(
      currentSwarmforgeDir,
      () => buildExtensionStateSnapshot(currentTargetPath, null),
      STATE_DUMP_INTERVAL_MS,
      setInterval,
      clearInterval
    );

    // BL-108 startup-reaper-03: a host killed without deactivate() (VS
    // Code's "Stop Extension Host" can SIGKILL without awaiting it) leaves
    // registry entries whose owner_host_pid died with it. Reap those
    // groups now, before anything else starts, so a fresh activation never
    // inherits a previous session's orphaned process tree.
    reapStaleTrackedJobs(currentSwarmforgeDir, isPidAlive, (pgid, signal) => {
      try {
        process.kill(-pgid, signal);
      } catch {
        // already gone
      }
    });

    // BL-069 crash safety: a drain sentinel can only be stale here — a live
    // watcher would already be running to complete it — so any sentinel
    // found at extension startup is left over from a crashed session.
    clearBounceDrainState(targetPath);
    startOrRestartBounceWatcher(context, targetPath);
    startOrRestartChaserMonitor(targetPath, context);
    startOrRestartDailyBriefing(targetPath, context);
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
      const reattachTimeoutMs = chooseReattachTimeoutMs(
        readTmuxSocket(targetPath) !== undefined,
        REATTACH_COLD_START_TIMEOUT_MS,
        REATTACH_READY_TIMEOUT_MS
      );
      // BL-086: this block now runs unprompted on every editor start (via
      // the added onStartupFinished activation event), not just after the
      // user happens to invoke a command. Treat it as startup-triggered:
      // attach silently in the background (preserveFocus) when a swarm is
      // live, and do nothing visible otherwise. shouldOfferResumePrompt's
      // non-startup branch stays reachable (and tested) for the case where
      // a command wins the activation race before onStartupFinished fires,
      // preserving today's resume-offer behavior on that path.
      const isStartupTriggeredActivation = true;
      waitForSwarmReady(targetPath, reattachTimeoutMs, REATTACH_READY_POLL_MS).then((ready) => {
        if (ready) {
          // Re-attach automatically: tiles reconnect to the live output
          // streams without restarting any agent. preserveFocus keeps the
          // editor the operator opened into in the foreground.
          const panel = SwarmPanel.createOrShow(
            context.extensionUri,
            targetPath,
            runLogPath,
            undefined,
            context.secrets,
            isStartupTriggeredActivation
          );
          panel.updateTarget(targetPath);
        } else if (
          shouldOfferResumePrompt(isStartupTriggeredActivation, hasPriorRunState(targetPath))
        ) {
          // Cold relaunch with no live processes: offer resume from the
          // target's prior run rather than a silent no-op or a surprise
          // cold start.
          vscode.window
            .showInformationMessage(
              'A previous SwarmForge run was found for this target but is not currently live. Resume it?',
              'Resume',
              'Not Now'
            )
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
    const targetPath = getTargetPath();
    const lastRunName = context.globalState.get<string>(LAST_RUN_NAME_KEY);
    if (targetPath && lastRunName) {
      vscode.window.showInformationMessage('Auto-launching swarm after reload...');
      launchSwarm(targetPath, lastRunName).then((result) => {
        if (result.success) {
          vscode.window.showInformationMessage(result.message);
          const panel = SwarmPanel.createOrShow(
            context.extensionUri,
            targetPath,
            runLogPath,
            undefined,
            context.secrets
          );
          panel.updateTarget(targetPath);
          // Start chaser monitor after swarm is launched
          startOrRestartChaserMonitor(targetPath, context);
          startOrRestartDailyBriefing(targetPath, context);
          startOrRestartIdleClearMonitor(targetPath, context);
        } else {
          vscode.window.showErrorMessage(result.message);
        }
      });
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('swarmforge.testTmux', async () => {
      const result = listTmuxSessions();
      if (result.exitCode !== 0) {
        vscode.window.showErrorMessage(
          `tmux unavailable: ${result.stderr || 'unknown error'}`
        );
        return;
      }

      const sessions = result.stdout || '(no sessions)';
      const doc = await vscode.workspace.openTextDocument({
        content: `# tmux list-sessions\n\n${sessions}\n`,
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: false });
      vscode.window.showInformationMessage('tmux connection OK');
    }),

    vscode.commands.registerCommand('swarmforge.setTarget', async () => {
      await setTargetPath(context);
      const newTargetPath = getTargetPath();
      if (newTargetPath) {
        clearBounceDrainState(newTargetPath);
        startOrRestartBounceWatcher(context, newTargetPath);
        startOrRestartChaserMonitor(newTargetPath, context);
        startOrRestartDailyBriefing(newTargetPath, context);
        startOrRestartGracefulBounceFileWatcher(newTargetPath, context);
        startOrRestartIdleClearMonitor(newTargetPath, context);
      }
    }),

    vscode.commands.registerCommand('swarmforge.initializeTarget', async () => {
      const targetPath = await resolveTargetPath(context);
      if (!targetPath) {
        return;
      }

      try {
        const result = await initializeTargetRepo(targetPath);
        const status = result.committed ? ' and committed' : '';
        vscode.window.showInformationMessage(
          `Initialized ${result.created.length} file(s)${status} in ${targetPath}.`
        );
        if (result.skipped.length > 0) {
          vscode.window.showInformationMessage(
            `Skipped existing prompt file(s): ${result.skipped.join(', ')}`
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to initialize target: ${message}`);
      }
    }),

    vscode.commands.registerCommand('swarmforge.launchSwarm', async () => {
      const targetPath = await resolveTargetPath(context);
      if (!targetPath) {
        return;
      }

      const config = vscode.workspace.getConfiguration('swarmforge');
      const promptEnabled = config.get<boolean>('run.promptForName', true);
      const promptResult = promptEnabled
        ? await vscode.window.showInputBox({
            title: 'SwarmForge Run Name',
            prompt: 'Name this run (used for branch and PR title; leave blank for timestamp default)',
            placeHolder: 'e.g. fix-auth-bug',
            validateInput: () => undefined,
          })
        : '';
      const runName = resolveRunName({ promptEnabled, promptResult, defaultName: generateDefaultRunName() });
      if (runName === undefined) {
        return;
      }

      await context.globalState.update(LAST_RUN_NAME_KEY, runName);
      appendRun(runLogPath, {
        name: runName,
        targetPath,
        startedAt: new Date().toISOString(),
      });

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Launching SwarmForge swarm...',
          cancellable: false,
        },
        async () => {
          const result = await launchSwarm(targetPath!, runName);
          if (!result.success) {
            vscode.window.showErrorMessage(result.message);
            return;
          }

          const ready = await waitForSwarmReady(targetPath!);
          if (!ready) {
            vscode.window.showWarningMessage(
              'Swarm process finished but state files were not detected yet.'
            );
          }

          vscode.window.showInformationMessage(result.message);
          const panel = SwarmPanel.createOrShow(
            context.extensionUri,
            targetPath!,
            runLogPath,
            undefined,
            context.secrets
          );
          panel.updateTarget(targetPath!);
          panel.notifyDogfoodCheckpoint();
          // Start chaser monitor after swarm is launched
          startOrRestartChaserMonitor(targetPath!, context);
          startOrRestartDailyBriefing(targetPath!, context);
          startOrRestartIdleClearMonitor(targetPath!, context);
        }
      );
    }),

    vscode.commands.registerCommand('swarmforge.openPanel', async () => {
      const targetPath = getTargetPath();
      if (!targetPath) {
        vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
        return;
      }
      SwarmPanel.createOrShow(
        context.extensionUri,
        targetPath,
        runLogPath,
        undefined,
        context.secrets
      );
    }),

    vscode.commands.registerCommand('swarmforge.stopSwarm', async () => {
      const targetPath = getTargetPath();
      if (!targetPath) {
        vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
        return;
      }

      const confirmed = await vscode.window.showWarningMessage(
        'Stop the SwarmForge swarm? This will kill all agent sessions.',
        { modal: true },
        STOP_SWARM_BUTTON
      );
      if (confirmed !== STOP_SWARM_BUTTON) {
        return;
      }

      const result = stopSwarm(targetPath);
      if (result.success) {
        vscode.window.showInformationMessage(result.message);
        // Stop chaser monitor when swarm is stopped
        if (currentChaserMonitor) {
          stopChaserMonitor(currentChaserMonitor);
          currentChaserMonitor = null;
        }
      } else {
        vscode.window.showWarningMessage(result.message);
      }
    }),

    vscode.commands.registerCommand('swarmforge.startBridge', async () => {
      const targetPath = getTargetPath();
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
      const token = generateBridgeToken();
      currentBridge = await startBridge(targetPath, runLogPath, token);
      vscode.window.showInformationMessage(
        `SwarmForge bridge listening on http://127.0.0.1:${currentBridge.port} — token: ${token}`
      );
    }),

    vscode.commands.registerCommand('swarmforge.stopBridge', async () => {
      if (!currentBridge) {
        vscode.window.showInformationMessage('SwarmForge bridge is not running.');
        return;
      }
      currentBridge.stop();
      currentBridge = null;
      vscode.window.showInformationMessage('SwarmForge bridge stopped.');
    }),

    vscode.commands.registerCommand('swarmforge.bounceSwarm', async () => {
      const validated = validateTargetAndLastRun(getTargetPath(), context);
      if (!validated) {
        return;
      }
      const { targetPath, lastRunName } = validated;

      vscode.window.showInformationMessage('Restarting swarm...');
      logBouncePhase(targetPath, context, 'swarm', 'stopping', 'Stopping swarm before relaunch');
      const result = await bounceSwarm(targetPath, lastRunName);
      logBouncePhase(
        targetPath,
        context,
        'swarm',
        result.success ? 'done' : 'failed',
        result.message
      );
      handleBounceResult(result, targetPath, context);
    }),

    vscode.commands.registerCommand('swarmforge.bounceExtension', async () => {
      const targetPath = getTargetPath();
      vscode.window.showInformationMessage('Reloading SwarmForge extension...');
      if (targetPath) {
        logBouncePhase(targetPath, context, 'extension', 'relaunching', 'Reloading extension window');
      }
      const reloadCmd = buildBounceExtensionCommand();
      await vscode.commands.executeCommand(reloadCmd);
    }),

    vscode.commands.registerCommand('swarmforge.bounceAll', async () => {
      const validated = validateTargetAndLastRun(getTargetPath(), context);
      if (!validated) {
        return;
      }
      const { targetPath, lastRunName } = validated;

      // BL-107: bounce (stop + relaunch + verify ready) FIRST, then reload
      // the window — see the matching fix in performGracefulBounceNow for
      // why the old stop -> pendingAutoLaunch -> reload order was unsafe.
      vscode.window.showInformationMessage('Restarting swarm before reloading extension...');
      logBouncePhase(targetPath, context, 'all', 'stopping', 'Stopping swarm before relaunch');
      const bounceResult = await bounceSwarm(targetPath, lastRunName);
      if (!bounceResult.success) {
        logBouncePhase(targetPath, context, 'all', 'failed', bounceResult.message);
        vscode.window.showErrorMessage(bounceResult.message);
        return;
      }
      logBouncePhase(
        targetPath,
        context,
        'all',
        'relaunching',
        'Swarm relaunched and verified ready; reloading extension window'
      );
      const reloadCmd = buildBounceExtensionCommand();
      await vscode.commands.executeCommand(reloadCmd);
      logBouncePhase(targetPath, context, 'all', 'done', 'Extension window reload triggered');
    }),

    // BL-069: instruct all agents to finish their current work and refuse
    // new work, then bounce automatically once every role is idle.
    vscode.commands.registerCommand('swarmforge.bounceGraceful', async () => {
      const targetPath = getTargetPath();
      if (!targetPath) {
        vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
        return;
      }
      beginGracefulBounce(targetPath, 'swarm', context);
    }),

    vscode.commands.registerCommand('swarmforge.cancelBounceDrain', async () => {
      const targetPath = getTargetPath();
      if (!targetPath) {
        return;
      }
      if (currentBounceDrainWatcher) {
        stopBounceDrainWatcher(currentBounceDrainWatcher);
        currentBounceDrainWatcher = null;
      }
      clearBounceDrainState(targetPath);
      clearBounceAck(targetPath);
      vscode.window.showInformationMessage('Graceful bounce drain cancelled — agents accept work again.');
    }),

    vscode.commands.registerCommand('swarmforge.forceBounceNow', async () => {
      const targetPath = getTargetPath();
      if (!targetPath) {
        vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
        return;
      }
      const drainState = readBounceDrainState(targetPath);
      await performGracefulBounceNow(targetPath, drainState?.bounceType ?? 'swarm', context);
    }),

    vscode.commands.registerCommand('swarmforge.openPR', async () => {
      const targetPath = getTargetPath();
      if (!targetPath) {
        vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
        return;
      }

      const branch = getCurrentBranch(targetPath);
      if (!branch) {
        vscode.window.showErrorMessage('Could not determine current branch in target repo.');
        return;
      }

      const lastRunName = context.globalState.get<string>(LAST_RUN_NAME_KEY) ?? '';
      const title = await vscode.window.showInputBox({
        title: 'Open Pull Request',
        prompt: 'PR title',
        value: lastRunName,
        validateInput: (v) => (v.trim() ? undefined : 'PR title is required'),
      });
      if (!title) {
        return;
      }

      const result = openPullRequest(targetPath, title.trim());
      if (result.success) {
        updateLastRunForTarget(runLogPath, targetPath, {
          prUrl: result.url,
          completedAt: new Date().toISOString(),
        });
        const open = 'Open in Browser';
        const choice = await vscode.window.showInformationMessage(result.message, open);
        if (choice === open && result.url) {
          vscode.env.openExternal(vscode.Uri.parse(result.url));
        }
      } else {
        vscode.window.showErrorMessage(result.message);
      }
    }),

    vscode.commands.registerCommand('swarmforge.showRuns', async () => {
      const runs = loadRuns(runLogPath);
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
    }),

    vscode.commands.registerCommand('swarmforge.showWorkTree', () => {
      const targetPath = getTargetPath();
      if (!targetPath) {
        vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
        return;
      }
      WorkTreePanel.createOrShow(targetPath);
    }),

    vscode.commands.registerCommand('swarmforge.highlightTile', (role: string) => {
      SwarmPanel.currentPanel?.highlightTile(role);
    }),

    vscode.commands.registerCommand('swarmforge.setRunMode', async () => {
      const current = context.workspaceState.get<RunMode>(RUN_MODE_KEY, 'one-shot');
      const picked = await vscode.window.showQuickPick(
        [
          { label: 'one-shot', description: 'Stop after the current backlog item (default)', picked: current === 'one-shot' },
          { label: 'drain', description: 'Keep running until the backlog is empty or all items are blocked', picked: current === 'drain' },
        ],
        { title: 'SwarmForge Run Mode', placeHolder: 'Select run mode' }
      );
      if (picked) {
        await context.workspaceState.update(RUN_MODE_KEY, picked.label as RunMode);
        vscode.window.showInformationMessage(`SwarmForge run mode set to: ${picked.label}`);
      }
    }),

    vscode.commands.registerCommand('swarmforge.drainCheck', async () => {
      const targetPath = getTargetPath();
      if (!targetPath) {
        return;
      }
      const runMode = context.workspaceState.get<RunMode>(RUN_MODE_KEY, 'one-shot');
      if (runMode !== 'drain') {
        return;
      }
      const items = readBacklog(targetPath);
      const next = nextEligibleItem(items);
      if (!next) {
        vscode.window.showInformationMessage('SwarmForge: Backlog drained — no eligible next item.');
        return;
      }
      const go = 'Launch Next Item';
      const choice = await vscode.window.showInformationMessage(
        `Drain mode: next eligible item is ${next.id} — "${next.title}". Launch now?`,
        go
      );
      if (choice !== go) {
        return;
      }
      const runName = next.id.toLowerCase();
      await context.globalState.update(LAST_RUN_NAME_KEY, runName);
      appendRun(runLogPath, { name: runName, targetPath, startedAt: new Date().toISOString() });
      const result = await launchSwarm(targetPath, runName);
      if (!result.success) {
        vscode.window.showErrorMessage(result.message);
        return;
      }
      const panel = SwarmPanel.createOrShow(
        context.extensionUri,
        targetPath,
        runLogPath,
        undefined,
        context.secrets
      );
      panel.updateTarget(targetPath);
    }),

    vscode.commands.registerCommand('swarmforge.setResendApiKey', async () => {
      const input = await vscode.window.showInputBox({
        title: 'SwarmForge: Set Resend API Key',
        prompt: 'Enter the Resend API key to store in SecretStorage',
        password: true,
        ignoreFocusOut: true,
      });
      const key = trimmedResendKeyInput(input);
      if (!key) {
        return;
      }
      await context.secrets.store(RESEND_SECRET_KEY, key);
      vscode.window.showInformationMessage(describeSetResult(Boolean(process.env.RESEND_API_KEY)));
    }),

    vscode.commands.registerCommand('swarmforge.clearResendApiKey', async () => {
      await context.secrets.delete(RESEND_SECRET_KEY);
      vscode.window.showInformationMessage(describeClearResult(Boolean(process.env.RESEND_API_KEY)));
    })
  );
}

export function deactivate(): void {
  SwarmPanel.currentPanel?.dispose();
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
    reapAllTrackedJobs(currentSwarmforgeDir, (pgid, signal) => {
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
    writeStateDump(currentSwarmforgeDir, buildExtensionStateSnapshot(currentTargetPath, 'extension-deactivate'));
  }
}
