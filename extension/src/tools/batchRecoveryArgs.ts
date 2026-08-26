/**
 * BL-588: flag parsing for batch-recovery CLI — shared parse/validate surface
 * kept separate from command runners so the thin main wrapper stays small.
 */
import { parseFlagPairs } from './bounceArgsCore';

const TICKET_PATTERN = /^BL-\d+$/i;
const COMMIT_PATTERN = /^[0-9a-f]{10}$/i;

export const PREPARE_REFORWARD_FLAGS = ['--ticket', '--defective-ticket'] as const;
export const PREPARE_REWORK_FLAGS = ['--ticket', '--batch-commit', '--ancestor'] as const;
export const VALIDATE_LAND_FLAGS = ['--operation', '--verified-commit'] as const;
export const VALIDATE_MERGE_UP_FLAGS = ['--ticket', '--verified-commit', '--landed-commit'] as const;
export const VALIDATE_LAND_ISOLATION_FLAGS = ['--landed-commit', '--defective-tip'] as const;

function isTicket(value: string | undefined): value is string {
  return !!value && TICKET_PATTERN.test(value);
}

function isCommit(value: string | undefined): value is string {
  return !!value && COMMIT_PATTERN.test(value);
}

export type BatchRecoveryArgs =
  | { command: 'prepare-re-forward'; ticket: string; defectiveTicket: string }
  | { command: 'prepare-rework'; ticket: string; batchCommit: string; ancestor: string }
  | { command: 'validate-land'; operation: string; verifiedCommit: string }
  | { command: 'validate-merge-up'; ticket: string; verifiedCommit: string; landedCommit: string }
  | { command: 'validate-land-isolation'; landedCommit: string; defectiveTip: string };

export function parseArgs(argv: string[]): BatchRecoveryArgs | null {
  const [command, ...rest] = argv;
  if (command === 'prepare-re-forward') {
    const flags = parseFlagPairs(rest, PREPARE_REFORWARD_FLAGS);
    const ticket = flags?.['--ticket'];
    const defectiveTicket = flags?.['--defective-ticket'];
    if (!isTicket(ticket) || !isTicket(defectiveTicket)) {
      return null;
    }
    return { command, ticket, defectiveTicket };
  }
  if (command === 'prepare-rework') {
    const flags = parseFlagPairs(rest, PREPARE_REWORK_FLAGS);
    const ticket = flags?.['--ticket'];
    const batchCommit = flags?.['--batch-commit'];
    const ancestor = flags?.['--ancestor'];
    if (!isTicket(ticket) || !isCommit(batchCommit) || !isCommit(ancestor)) {
      return null;
    }
    return { command, ticket, batchCommit, ancestor };
  }
  if (command === 'validate-land') {
    const flags = parseFlagPairs(rest, VALIDATE_LAND_FLAGS);
    const operation = flags?.['--operation'];
    const verifiedCommit = flags?.['--verified-commit'];
    if (!operation || !isCommit(verifiedCommit)) {
      return null;
    }
    return { command, operation, verifiedCommit };
  }
  if (command === 'validate-merge-up') {
    const flags = parseFlagPairs(rest, VALIDATE_MERGE_UP_FLAGS);
    const ticket = flags?.['--ticket'];
    const verifiedCommit = flags?.['--verified-commit'];
    const landedCommit = flags?.['--landed-commit'];
    if (!isTicket(ticket) || !isCommit(verifiedCommit) || !isCommit(landedCommit)) {
      return null;
    }
    return { command, ticket, verifiedCommit, landedCommit };
  }
  if (command === 'validate-land-isolation') {
    const flags = parseFlagPairs(rest, VALIDATE_LAND_ISOLATION_FLAGS);
    const landedCommit = flags?.['--landed-commit'];
    const defectiveTip = flags?.['--defective-tip'];
    if (!isCommit(landedCommit) || !isCommit(defectiveTip)) {
      return null;
    }
    return { command, landedCommit, defectiveTip };
  }
  return null;
}
