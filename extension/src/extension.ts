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
import { getCurrentBranch, openPullRequest } from './swarm/prCreator';
import { launchSwarm, waitForSwarmReady } from './swarm/swarmLauncher';
import { stopSwarm } from './swarm/swarmStopper';
import { bounceSwarm, buildBounceExtensionCommand } from './swarm/bouncer';
import { listTmuxSessions } from './swarm/tmuxClient';
import { resolveRunName } from './run/resolveRunName';
import { startBounceWatcher, BounceType } from './swarm/bounceWatcher';
import { startChaserMonitor, stopChaserMonitor } from './watchdog/chaserMonitor';
import type { ChaserMonitorConfig, ChaserCallbacks } from './watchdog/chaserMonitor';
import { readTmuxSocket, paneTarget, getPaneBaseIndex, sendKeys, readSwarmRoles, respawnAgent } from './swarm/tmuxClient';
import { readHeartbeat } from './tools/heartbeat';
import { maybeWriteActivationMarker } from './devActivationMarker';
import { computeLiveness } from './watchdog/liveness';
import type { LivenessState, WatchdogConfig } from './watchdog/liveness';

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

type RunMode = 'one-shot' | 'drain';

let currentBounceWatcher: fs.FSWatcher | null = null;
let currentChaserMonitor: NodeJS.Timeout | null = null;

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
      // Send a generic wake-up message (empty line followed by Enter)
      sendKeys(socketPath, target, 'Enter');
    },

    triggerRespawn: (role: string): void => {
      respawnAgent(targetPath, role);
    },

    logDeadLetter: (_role: string, _filePath: string): void => {
      // Dead letter logging can be extended in future iterations
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

async function resolveTargetPath(context: vscode.ExtensionContext): Promise<string | undefined> {
  let targetPath = getTargetPath();
  if (!targetPath) {
    targetPath = await setTargetPath(context);
  }
  return targetPath;
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
  if (targetPath) {
    startOrRestartBounceWatcher(context, targetPath);
    startOrRestartChaserMonitor(targetPath, context);
  }

  // Check for pending auto-launch after extension reload
  const pendingAutoLaunch = context.workspaceState.get<boolean>(PENDING_AUTO_LAUNCH_KEY);
  if (pendingAutoLaunch) {
    context.workspaceState.update(PENDING_AUTO_LAUNCH_KEY, undefined);
    const targetPath = getTargetPath();
    const lastRunName = context.globalState.get<string>(LAST_RUN_NAME_KEY);
    if (targetPath && lastRunName) {
      vscode.window.showInformationMessage('Auto-launching swarm after reload...');
      launchSwarm(targetPath, lastRunName).then((result) => {
        if (result.success) {
          vscode.window.showInformationMessage(result.message);
          const panel = SwarmPanel.createOrShow(context.extensionUri, targetPath, runLogPath);
          panel.updateTarget(targetPath);
          // Start chaser monitor after swarm is launched
          startOrRestartChaserMonitor(targetPath, context);
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
        startOrRestartBounceWatcher(context, newTargetPath);
        startOrRestartChaserMonitor(newTargetPath, context);
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
          const panel = SwarmPanel.createOrShow(context.extensionUri, targetPath!, runLogPath);
          panel.updateTarget(targetPath!);
          panel.notifyDogfoodCheckpoint();
          // Start chaser monitor after swarm is launched
          startOrRestartChaserMonitor(targetPath!, context);
        }
      );
    }),

    vscode.commands.registerCommand('swarmforge.openPanel', async () => {
      const targetPath = getTargetPath();
      if (!targetPath) {
        vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
        return;
      }
      SwarmPanel.createOrShow(context.extensionUri, targetPath, runLogPath);
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

    vscode.commands.registerCommand('swarmforge.bounceSwarm', async () => {
      const targetPath = getTargetPath();
      if (!targetPath) {
        vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
        return;
      }

      const lastRunName = context.globalState.get<string>(LAST_RUN_NAME_KEY);
      if (!lastRunName) {
        vscode.window.showWarningMessage(
          'No previous run name stored. Use SwarmForge: Launch Swarm first.'
        );
        return;
      }

      vscode.window.showInformationMessage('Restarting swarm...');
      const result = await bounceSwarm(targetPath, lastRunName);
      if (!result.success) {
        vscode.window.showErrorMessage(result.message);
        return;
      }

      vscode.window.showInformationMessage(result.message);
      const panel = SwarmPanel.currentPanel;
      if (panel) {
        panel.updateTarget(targetPath);
      }
      // Restart chaser monitor after swarm bounce
      startOrRestartChaserMonitor(targetPath, context);
    }),

    vscode.commands.registerCommand('swarmforge.bounceExtension', async () => {
      vscode.window.showInformationMessage('Reloading SwarmForge extension...');
      const reloadCmd = buildBounceExtensionCommand();
      await vscode.commands.executeCommand(reloadCmd);
    }),

    vscode.commands.registerCommand('swarmforge.bounceAll', async () => {
      const targetPath = getTargetPath();
      if (!targetPath) {
        vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
        return;
      }

      const lastRunName = context.globalState.get<string>(LAST_RUN_NAME_KEY);
      if (!lastRunName) {
        vscode.window.showWarningMessage(
          'No previous run name stored. Use SwarmForge: Launch Swarm first.'
        );
        return;
      }

      vscode.window.showInformationMessage('Stopping swarm and reloading extension...');
      const stopResult = stopSwarm(targetPath);
      if (!stopResult.success) {
        vscode.window.showErrorMessage(`Failed to stop swarm: ${stopResult.message}`);
        return;
      }

      await context.workspaceState.update(PENDING_AUTO_LAUNCH_KEY, true);
      const reloadCmd = buildBounceExtensionCommand();
      await vscode.commands.executeCommand(reloadCmd);
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
      const panel = SwarmPanel.createOrShow(context.extensionUri, targetPath, runLogPath);
      panel.updateTarget(targetPath);
    })
  );
}

export function deactivate(): void {
  SwarmPanel.currentPanel?.dispose();
  if (currentBounceWatcher) {
    currentBounceWatcher.close();
    currentBounceWatcher = null;
  }
}
