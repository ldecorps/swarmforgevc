/**
 * BL-588: batch-recovery CLI command runners — pure policy delegation to
 * batchRecovery core with IO at the edges only.
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
import { printJsonToStdout } from './swarm-metrics';
import type { BatchRecoveryArgs } from './batchRecoveryArgs';

function gitIsAncestor(descendant: string, ancestor: string, cwd: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function refuse(reason: string): void {
  process.stderr.write(`REFUSED: ${reason}\n`);
  process.exitCode = 4;
}

export function runPrepareReforward(
  mainWorktreePath: string,
  args: Extract<BatchRecoveryArgs, { command: 'prepare-re-forward' }>
): void {
  const records = readSiblingDeferralRecords(mainWorktreePath);
  const blockers = openBlockersForTicket(records, args.ticket);
  const blocker = blockers.find((b) => b.blockedBy === args.defectiveTicket);
  if (!blocker) {
    refuse(`no open deferral for ${args.ticket} pending ${args.defectiveTicket}`);
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

export function runPrepareRework(args: Extract<BatchRecoveryArgs, { command: 'prepare-rework' }>): void {
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

export function runValidateLand(args: Extract<BatchRecoveryArgs, { command: 'validate-land' }>): void {
  const result = validateWholeTreeLand({
    landingOperation: args.operation,
    verifiedCommit: args.verifiedCommit,
  });
  if (result.refused) {
    refuse(result.reason ?? 'landing refused');
    return;
  }
  printJsonToStdout({ allowed: true });
}

export function runValidateMergeUp(
  args: Extract<BatchRecoveryArgs, { command: 'validate-merge-up' }>,
  cwd: string
): void {
  const result = validateMergeUpBroadcast({
    ticket: args.ticket,
    verifiedCommit: args.verifiedCommit,
    landedCommit: args.landedCommit,
    isAncestor: (desc, anc) => gitIsAncestor(desc, anc, cwd),
  });
  if (!result.ok) {
    refuse(result.reason ?? 'merge-up refused');
    return;
  }
  printJsonToStdout({ ok: true, namedCommit: result.namedCommit });
}

export function runValidateLandIsolation(
  args: Extract<BatchRecoveryArgs, { command: 'validate-land-isolation' }>
): void {
  const merged = new Set([args.landedCommit]);
  const result = validateCleanSiblingLandIsolation({
    landedTicket: 'BL-B',
    landedCommit: args.landedCommit,
    defectiveRecoveryTip: args.defectiveTip,
    mergeIncludesCommit: (commit) => merged.has(commit),
  });
  if (!result.ok) {
    refuse(result.reason ?? 'land isolation refused');
    return;
  }
  printJsonToStdout({ ok: true });
}

export function dispatchBatchRecoveryCommand(
  mainWorktreePath: string,
  args: BatchRecoveryArgs
): void {
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
