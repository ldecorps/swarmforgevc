import * as vscode from 'vscode';
import { resolveTargetPath, WorkspaceFolderLike } from './targetPath';

export function getTargetPath(): string | undefined {
  const config = vscode.workspace.getConfiguration('swarmforge');
  const fromSettings = resolveTargetPath({
    configuredTargetPath: config.get<string>('targetPath'),
    workspaceFolders:
      vscode.workspace.workspaceFolders as WorkspaceFolderLike[] | undefined,
  });
  if (fromSettings) {
    return fromSettings;
  }

  const fromEnv = process.env['SWARMFORGE_TARGET_PATH']?.trim();
  return fromEnv || undefined;
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
