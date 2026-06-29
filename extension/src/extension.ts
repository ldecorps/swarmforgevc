import * as vscode from 'vscode';
import { getTargetPath, setTargetPath } from './config/targetConfig';
import { initializeTargetRepo } from './config/targetBootstrap';
import { SwarmPanel } from './panel/swarmPanel';
import { launchSwarm, waitForSwarmReady } from './swarm/swarmLauncher';
import { listTmuxSessions } from './swarm/tmuxClient';

export function activate(context: vscode.ExtensionContext): void {
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
      const targetPath = getTargetPath() ?? (await setTargetPath(context));
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
      let targetPath = getTargetPath();
      if (!targetPath) {
        targetPath = await setTargetPath(context);
      }
      if (!targetPath) {
        return;
      }

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
          SwarmPanel.createOrShow(context.extensionUri, targetPath!);
        }
      );
    }),

    vscode.commands.registerCommand('swarmforge.openPanel', async () => {
      const targetPath = getTargetPath();
      if (!targetPath) {
        vscode.window.showWarningMessage(
          'Set a target project first (SwarmForge: Set Target Project).'
        );
        return;
      }
      SwarmPanel.createOrShow(context.extensionUri, targetPath);
    })
  );
}

export function deactivate(): void {
  SwarmPanel.currentPanel?.dispose();
}
