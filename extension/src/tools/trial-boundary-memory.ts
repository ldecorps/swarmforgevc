/**
 * BL-1182: the bridge the BoB trial lifecycle crosses to run BL-1178's
 * agent-memory transfer at a trial boundary.
 *
 * The lifecycle lives in Babashka (model_steward_trial_lib.bb / the steward
 * CLI) and BL-1177's capture/inject is TypeScript; Babashka cannot import it,
 * so the steward shells to this compiled tool - the same bb -> node bridge
 * handoffd and effective_backlog_depth_cli.bb already use. Nothing is
 * re-implemented here: it composes buildOutgoingCaptureState with
 * runTrialBoundaryMemoryTransfer and reports the outcome as one JSON line.
 *
 * The exit status IS the contract the caller needs: 0 when the incoming agent
 * has the outgoing agent's memory, non-zero otherwise. BL-1178's invariant 2 -
 * "a failed transfer aborts the switch, never leaves an amnesiac seat as
 * success" - is the steward's to honour, and it honours it by refusing to move
 * the seat when this exits non-zero.
 */

import {
  buildOutgoingCaptureState,
  runTrialBoundaryMemoryTransfer,
  TrialBoundary,
} from './agentMemoryHotSwap';

export type TrialBoundaryMemoryArgs = {
  role: string;
  boundary: TrialBoundary;
  targetPath: string;
  transcriptSummary: string;
};

export type TrialBoundaryMemoryReport = {
  ok: boolean;
  role: string;
  boundary: TrialBoundary;
  captured: boolean;
  injected: boolean;
  signal?: string;
};

const BOUNDARIES: readonly string[] = ['start', 'end'];

/** Pure argv parse, so main() stays a thin wrapper over testable helpers. */
export function parseTrialBoundaryArgs(argv: readonly string[]): TrialBoundaryMemoryArgs {
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const role = flag('role');
  const boundary = flag('boundary');
  const targetPath = flag('target');
  if (!role) {
    throw new Error('trial-boundary-memory: --role <role> is required');
  }
  if (!boundary || !BOUNDARIES.includes(boundary)) {
    throw new Error(`trial-boundary-memory: --boundary must be one of ${BOUNDARIES.join('|')}`);
  }
  if (!targetPath) {
    throw new Error('trial-boundary-memory: --target <repo root> is required');
  }
  return {
    role,
    boundary: boundary as TrialBoundary,
    targetPath,
    transcriptSummary: flag('summary') ?? '',
  };
}

export function runTrialBoundaryMemory(
  args: TrialBoundaryMemoryArgs,
  deps: {
    buildState?: typeof buildOutgoingCaptureState;
    transfer?: typeof runTrialBoundaryMemoryTransfer;
  } = {}
): TrialBoundaryMemoryReport {
  const buildState = deps.buildState ?? buildOutgoingCaptureState;
  const transfer = deps.transfer ?? runTrialBoundaryMemoryTransfer;
  const outgoing = buildState(args.targetPath, args.role, args.transcriptSummary);
  const outcome = transfer(args.role, args.boundary, outgoing);
  return outcome.ok
    ? { ok: true, role: args.role, boundary: args.boundary, captured: true, injected: true }
    : {
        ok: false,
        role: args.role,
        boundary: args.boundary,
        captured: outcome.captured,
        injected: false,
        signal: outcome.signal,
      };
}

export function main(argv: readonly string[]): number {
  let report: TrialBoundaryMemoryReport;
  try {
    report = runTrialBoundaryMemory(parseTrialBoundaryArgs(argv));
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ ok: false, signal: (err as Error).message })}\n`);
    return 2;
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return report.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
