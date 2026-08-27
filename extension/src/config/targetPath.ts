export interface WorkspaceFolderLike {
  uri: {
    fsPath: string;
  };
}

export interface ResolveTargetPathInput {
  configuredTargetPath?: string;
  workspaceFolders?: WorkspaceFolderLike[];
}

export function resolveTargetPath(
  input: ResolveTargetPathInput
): string | undefined {
  const configured = input.configuredTargetPath?.trim();
  if (configured) {
    return configured;
  }

  const folders = input.workspaceFolders ?? [];
  if (folders.length > 0) {
    return folders[0].uri.fsPath;
  }

  return undefined;
}
