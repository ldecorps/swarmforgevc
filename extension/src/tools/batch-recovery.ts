#!/usr/bin/env node
/**
 * BL-588: batch recovery tooling for approach 3 — clean siblings re-forward
 * unchanged; defective tickets rework from the last clean ancestor; QA lands
 * verified whole trees only.
 */
import { execFileSync } from 'child_process';
import {
  planCleanSiblingReforward,
  planDefectiveRework,
  recoveryBranchExcludesContaminatedTip,
  validateCleanSiblingLandIsolation,
  validateMergeUpBroadcast,
  validateWholeTreeLand,
} from '../quality/batchRecovery';
import { openBlockersForTicket } from '../quality/siblingDeferral';
import { readSiblingDeferralRecords } from '../metrics/siblingDeferralStore';
import { printJsonToStdout, resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

const TICKET_PATTERN = /^BL-\d+$/i;
const COMMIT_PATTERN = /^[0-9a-f]{10}$/i;

const USAGE = `Usage:
  batch-recovery.js prepare-re-forward --ticket <id> --defective-ticket <id>
  batch-recovery.js prepare-rework --ticket <id> --batch-commit <10-hex> --ancestor <10-hex>
  batch-recovery.js validate-land --operation <merge|cherry-pick|rebase-to-land|partial-subset cherry-pick> --verified-commit <10-hex>
  batch-recovery.js validate-merge-up --ticket <id> --verified-commit <10-hex> --landed-commit <10-hex>
  batch-recovery.js validate-land-isolation --landed-commit <10-hex> --defective-tip <10-hex>
`;

function isTicket(value: string | undefined): value is string {
  return !!value && TICKET_PATTERN.test(value);
}

function isCommit(value: string | undefined): value is string {
  return !!value && COMMIT_PATTERN.test(value);
}

function parseFlagPairs(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      return new Map();
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      return new Map();
    }
    flags.set(token, value);
    i += 1;
  }
  return flags;
}

export type BatchRecoveryArgs =
  | { command: 'prepare-re-forward'; ticket: string; defectiveTicket: string }
  | { command: 'prepare-rework'; ticket: string; batchCommit: string; ancestor: string }
  | { command: 'validate-land'; operation: string; verifiedCommit: string }
  | { command: 'validate-merge-up'; ticket: string; verifiedCommit: string; landedCommit: string }
  | { command: 'validate-land-isolation'; landedCommit: string; defectiveTip: string };

export function parseArgs(argv: string[]): BatchRecoveryArgs | null {
  const [command, ...rest] = argv;
  const flags = parseFlagPairs(rest);
  if (flags.size === 0 && rest.length > 0) {
    return null;
  }
  if (command === 'prepare-re-forward') {
    const ticket = flags.get('--ticket');
    const defectiveTicket = flags.get('--defective-ticket');
    if (!isTicket(ticket) || !isTicket(defectiveTicket)) {
      return null;
    }
    return { command, ticket, defectiveTicket };
  }
  if (command === 'prepare-rework') {
    const ticket = flags.get('--ticket');
    const batchCommit = flags.get('--batch-commit');
    const ancestor = flags.get('--ancestor');
    if (!isTicket(ticket) || !isCommit(batchCommit) || !isCommit(ancestor)) {
      return null;
    }
    return { command, ticket, batchCommit, ancestor };
  }
  if (command === 'validate-land') {
    const operation = flags.get('--operation');
    const verifiedCommit = flags.get('--verified-commit');
    if (!operation || !isCommit(verifiedCommit)) {
      return null;
    }
    return { command, operation, verifiedCommit };
  }
  if (command === 'validate-merge-up') {
    const ticket = flags.get('--ticket');
    const verifiedCommit = flags.get('--verified-commit');
    const landedCommit = flags.get('--landed-commit');
    if (!isTicket(ticket) || !isCommit(verifiedCommit) || !isCommit(landedCommit)) {
      return null;
    }
    return { command, ticket, verifiedCommit, landedCommit };
  }
  if (command === 'validate-land-isolation') {
    const landedCommit = flags.get('--landed-commit');
    const defectiveTip = flags.get('--defective-tip');
    if (!isCommit(landedCommit) || !isCommit(defectiveTip)) {
      return null;
    }
    return { command, landedCommit, defectiveTip };
  }
  return null;
}

function gitIsAncestor(descendant: string, ancestor: string, cwd: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runPrepareReforward(mainWorktreePath: string, args: Extract<BatchRecoveryArgs, { command: 'prepare-re-forward' }>): void {
  const records = readSiblingDeferralRecords(mainWorktreePath);
  const blockers = openBlockersForTicket(records, args.ticket);
  const blocker = blockers.find((b) => b.blockedBy === args.defectiveTicket);
  if (!blocker) {
    process.stderr.write(`REFUSED: no open deferral for ${args.ticket} pending ${args.defectiveTicket}\n`);
    process.exitCode = 4;
    return;
  }
  const plan = planCleanSiblingReforward({
    ticket: args.ticket,
    batchCommit: blocker.commit,
    deferralCommit: blocker.commit,
    defectiveTicket: args.defectiveTicket,
  });
  printJsonToStdout({
    ticket: plan.ticket,
    forwardCommit: plan.forwardCommit,
    recoveryTicket: plan.recoveryTicket,
    handoffType: 'git_handoff',
  });
}

function runPrepareRework(args: Extract<BatchRecoveryArgs, { command: 'prepare-rework' }>): void {
  const plan = planDefectiveRework({
    ticket: args.ticket,
    batchCommit: args.batchCommit,
    lastCleanAncestor: args.ancestor,
  });
  printJsonToStdout({
    ticket: plan.ticket,
    branchBase: plan.branchBase,
    excludesContaminatedTip: recoveryBranchExcludesContaminatedTip(plan),
  });
}

function runValidateLand(args: Extract<BatchRecoveryArgs, { command: 'validate-land' }>): void {
  const result = validateWholeTreeLand({
    landingOperation: args.operation,
    verifiedCommit: args.verifiedCommit,
  });
  if (result.refused) {
    process.stderr.write(`REFUSED: ${result.reason}\n`);
    process.exitCode = 4;
    return;
  }
  printJsonToStdout({ allowed: true });
}

function runValidateMergeUp(args: Extract<BatchRecoveryArgs, { command: 'validate-merge-up' }>, cwd: string): void {
  const result = validateMergeUpBroadcast({
    ticket: args.ticket,
    verifiedCommit: args.verifiedCommit,
    landedCommit: args.landedCommit,
    isAncestor: (desc, anc) => gitIsAncestor(desc, anc, cwd),
  });
  if (!result.ok) {
    process.stderr.write(`REFUSED: ${result.reason}\n`);
    process.exitCode = 4;
    return;
  }
  printJsonToStdout({ ok: true, namedCommit: result.namedCommit });
}

function runValidateLandIsolation(args: Extract<BatchRecoveryArgs, { command: 'validate-land-isolation' }>): void {
  const merged = new Set([args.landedCommit]);
  const result = validateCleanSiblingLandIsolation({
    landedTicket: 'BL-B',
    landedCommit: args.landedCommit,
    defectiveRecoveryTip: args.defectiveTip,
    mergeIncludesCommit: (commit) => merged.has(commit),
  });
  if (!result.ok) {
    process.stderr.write(`REFUSED: ${result.reason}\n`);
    process.exitCode = 4;
    return;
  }
  printJsonToStdout({ ok: true });
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  if (args.command === 'prepare-re-forward') {
    runPrepareReforward(mainWorktreePath, args);
  } else if (args.command === 'prepare-rework') {
    runPrepareRework(args);
  } else if (args.command === 'validate-land') {
    runValidateLand(args);
  } else if (args.command === 'validate-merge-up') {
    runValidateMergeUp(args, mainWorktreePath);
  } else {
    runValidateLandIsolation(args);
  }
}

if (require.main === module) {
  runCliMain(main);
}
