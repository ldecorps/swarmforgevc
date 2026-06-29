import * as path from 'path';
import * as vscode from 'vscode';
import { getTargetPath, setTargetPath } from './config/targetConfig';
import { initializeTargetRepo } from './config/targetBootstrap';
import { SwarmPanel } from './panel/swarmPanel';
import { appendRun, loadRuns } from './runs/runLog';
import { getCurrentBranch, openPullRequest } from './swarm/prCreator';
import { launchSwarm, waitForSwarmReady } from './swarm/swarmLauncher';
import { stopSwarm } from './swarm/swarmStopper';
import { listTmuxSessions } from './swarm/tmuxClient';

const NO_TARGET_MESSAGE = 'Set a target project first (SwarmForge: Set Target Project).';
const STOP_SWARM_BUTTON = 'Stop Swarm';
const LAST_RUN_NAME_KEY = 'swarmforge.lastRunName';

async function resolveTargetPath(context: vscode.ExtensionContext): Promise<string | undefined> {
  let targetPath = getTargetPath();
  if (!targetPath) {
    targetPath = await setTargetPath(context);
  }
  return targetPath;
}

export function activate(context: vscode.ExtensionContext): void {
  const runLogPath = path.join(context.globalStorageUri.fsPath, 'runs.json');

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

      const runName = await vscode.window.showInputBox({
        title: 'SwarmForge Run Name',
        prompt: 'Name this run (used for branch and PR title)',
        placeHolder: 'e.g. fix-auth-bug',
        validateInput: (v) => (v.trim() ? undefined : 'Run name is required'),
      });
      if (!runName) {
        return;
      }

      await context.globalState.update(LAST_RUN_NAME_KEY, runName.trim());
      appendRun(runLogPath, {
        name: runName.trim(),
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
          const result = await launchSwarm(targetPath!);
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
          const panel = SwarmPanel.createOrShow(context.extensionUri, targetPath!);
          panel.updateTarget(targetPath!);
          panel.notifyDogfoodCheckpoint();
        }
      );
    }),

    vscode.commands.registerCommand('swarmforge.openPanel', async () => {
      const targetPath = getTargetPath();
      if (!targetPath) {
        vscode.window.showWarningMessage(NO_TARGET_MESSAGE);
        return;
      }
      SwarmPanel.createOrShow(context.extensionUri, targetPath);
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
      } else {
        vscode.window.showWarningMessage(result.message);
      }
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
        .map((r) => `${r.startedAt.slice(0, 10)}  ${r.name}  (${r.targetPath})`);
      const doc = await vscode.workspace.openTextDocument({
        content: `# SwarmForge Runs\n\n${items.join('\n')}\n`,
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: false });
    })
  );
}

export function deactivate(): void {
  SwarmPanel.currentPanel?.dispose();
}
