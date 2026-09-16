// BL-1510: flag parsing for render-model-scoring-report.js, split out from
// the CLI/IO module per this project's own *Args.ts convention (see
// leanLedgerRecordArgs.ts, closingCeremonyRunArgs.ts) so the parsing logic
// carries its own mutation-test surface separate from the IO adapters.

export interface RenderModelScoringReportArgs {
  projectRoot: string;
  outPath?: string;
  send: boolean;
}

export const USAGE = 'Usage: render-model-scoring-report.js <project-root> [--out <path>] [--no-send]\n';

export function parseArgs(argv: string[]): RenderModelScoringReportArgs | null {
  const noSendIndex = argv.indexOf('--no-send');
  const send = noSendIndex < 0;
  const withoutNoSend = noSendIndex < 0 ? argv : [...argv.slice(0, noSendIndex), ...argv.slice(noSendIndex + 1)];
  const outIndex = withoutNoSend.indexOf('--out');
  let outPath: string | undefined;
  let positional = withoutNoSend;
  if (outIndex >= 0) {
    outPath = withoutNoSend[outIndex + 1];
    if (outPath === undefined) {
      return null;
    }
    positional = [...withoutNoSend.slice(0, outIndex), ...withoutNoSend.slice(outIndex + 2)];
  }
  const [projectRoot] = positional;
  if (!projectRoot) {
    return null;
  }
  return outPath !== undefined ? { projectRoot, outPath, send } : { projectRoot, send };
}
