// BL-819: flag parsing for lean-ledger-record.js. `--target` is an explicit
// injected seam (constitution: "CLI main() is a thin wrapper... inject side
// effects, not *_FORCE_RESULT env bypasses") so main() is testable
// in-process against a fixture directory without needing a real git repo -
// resolveProjectRoot requires `git rev-parse`, which a plain fixture dir
// does not have.
import { parseFlagPairs } from './bounceArgsCore';

export interface LeanLedgerRecordArgs {
  ticket: string;
  target?: string;
}

const TICKET_PATTERN = /^(BL|GH)-\d+$/i;

const FLAG_NAMES = ['--ticket', '--target'] as const;
type FlagName = (typeof FLAG_NAMES)[number];

export function parseArgs(argv: string[]): LeanLedgerRecordArgs | null {
  const flags = parseFlagPairs(argv, FLAG_NAMES);
  if (!flags) {
    return null;
  }
  const { '--ticket': ticket, '--target': target } = flags;
  if (!ticket || !TICKET_PATTERN.test(ticket)) {
    return null;
  }
  return target !== undefined ? { ticket: ticket.toUpperCase(), target } : { ticket: ticket.toUpperCase() };
}

export const USAGE = 'Usage: lean-ledger-record.js --ticket <id> [--target <path>]\n';
