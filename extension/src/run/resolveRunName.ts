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
