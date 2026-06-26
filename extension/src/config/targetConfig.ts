import * as vscode from 'vscode';

export function getTargetPath(): string | undefined {
  const config = vscode.workspace.getConfiguration('swarmforge');
  const configured = config.get<string>('targetPath')?.trim();
  if (configured) {
    return configured;
  }

  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }

  return undefined;
}

export async function setTargetPath(
  context?: vscode.ExtensionContext
): Promise<string | undefined> {
  const current = getTargetPath() ?? '';

  const picked = await vscode.window.showInputBox({
    title: 'SwarmForge Target Project',
    prompt: 'Path to the project where SwarmForge will run',
    value: current,
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Target path is required';
      }
      return undefined;
    },
  });

  if (!picked) {
    return undefined;
  }

  const resolved = picked.trim();
  await vscode.workspace
    .getConfiguration('swarmforge')
    .update('targetPath', resolved, vscode.ConfigurationTarget.Workspace);

  if (context) {
    await context.globalState.update('swarmforge.targetPath', resolved);
  }

  vscode.window.showInformationMessage(`SwarmForge target set to: ${resolved}`);
  return resolved;
}

export function resolveSwarmScript(targetPath: string): string | undefined {
  const localSwarm = `${targetPath}/swarm`;
  const fs = require('fs') as typeof import('fs');
  if (fs.existsSync(localSwarm)) {
    return localSwarm;
  }
  return undefined;
}
