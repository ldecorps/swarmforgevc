#!/usr/bin/env node
/**
 * BL-1369: the sole CLI an agent runs to relay an in-session answer onto a
 * ticket's human_ruling field. Never writes human_approval - invariant 1.
 * Validates the answer against the ticket's declared ruling_options and
 * refuses a mismatch rather than interpreting it (the agent-paraphrase
 * failure this surface exists to prevent).
 *
 * Usage: node relay-ruling.js --ticket <id> --option <label> --relayer <role>
 *
 * Optional --target <path> defaults to the main worktree (same project-root
 * resolution as the other tools in this directory).
 *
 * Exit codes: 0 on success or a legitimate refusal (already-tapped,
 * unknown-option, no-ruling-options, no-ticket-file), 1 on bad args / IO
 * error. The refusal reason and (for unknown-option) the declared options
 * are printed to stdout as JSON so the calling agent can surface them.
 */
import { recordRelayedRuling } from '../concierge/pendingApprovalReply';
import { resolveCliMainWorktreeContext, printJsonToStdout, runCliMain, makeArgsGuardedMain } from './swarm-metrics';

const USAGE =
  'Usage: node relay-ruling.js --ticket <id> --option <label> --relayer <role> [--target <path>]';

export interface RelayRulingArgs {
  ticket: string;
  option: string;
  relayer: string;
  target?: string;
}

export function parseArgs(argv: string[]): RelayRulingArgs | null {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };
  const ticket = get('--ticket');
  const option = get('--option');
  const relayer = get('--relayer');
  const target = get('--target');
  if (!ticket || !option || !relayer) {
    return null;
  }
  return { ticket, option, relayer, target };
}

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const defaultRoot = resolveCliMainWorktreeContext().mainWorktreePath;
  const targetPath = args.target ?? defaultRoot;
  const result = recordRelayedRuling(targetPath, args.ticket, args.option, args.relayer);
  printJsonToStdout(result);
  // Both outcomes are "the command did its job"; the calling agent reads
  // the JSON to distinguish written vs refused (and the refusal reason).
  // A non-zero exit is reserved for bad args / IO errors upstream.
});

if (require.main === module) {
  runCliMain(main);
}
