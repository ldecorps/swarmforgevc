export interface ResolveRunNameOpts {
  promptEnabled: boolean;
  promptResult: string | undefined;
  defaultName: string;
}

export function resolveRunName(opts: ResolveRunNameOpts): string | undefined {
  if (!opts.promptEnabled) {
    return opts.defaultName;
  }
  if (opts.promptResult === undefined) {
    return undefined;
  }
  return opts.promptResult.trim() || opts.defaultName;
}

// BL-352: moved out of extension.ts (a private function there) so a
// headless caller (record-run.ts, no vscode.* available) can generate the
// SAME timestamp-default name shape a VS Code launch would - one format,
// never a second drifting copy.
export function generateDefaultRunName(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  return `run-${year}${month}${day}-${hour}${minute}`;
}
