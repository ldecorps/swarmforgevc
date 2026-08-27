// BL-588 (approach 3): when a batch commit satisfies several tickets but only
// one carries a failing check, clean siblings must re-forward on their
// original commit for whole-tree re-verification while the defective ticket
// reworks from the last clean ancestor — never cherry-pick or rebase-to-land.
// Pure decision surface only; git and handoff I/O live in tools/metrics.

export const REFUSED_LANDING_OPERATIONS = [
  'cherry-pick',
  'rebase-to-land',
  'partial-subset cherry-pick',
] as const;

export type RefusedLandingOperation = (typeof REFUSED_LANDING_OPERATIONS)[number];
export type AllowedLandingOperation = 'merge';
export type LandingOperation = AllowedLandingOperation | RefusedLandingOperation;

export interface LandingRefusal {
  refused: true;
  reason: string;
}

export interface LandingAllowed {
  refused: false;
}

export type LandingDisposition = LandingRefusal | LandingAllowed;

const WHOLE_TREE_REASON = 'landing must merge a verified whole tree';

export function refuseNonWholeTreeLanding(operation: string): LandingDisposition {
  if (operation === 'merge') {
    return { refused: false };
  }
  if ((REFUSED_LANDING_OPERATIONS as readonly string[]).includes(operation)) {
    return { refused: true, reason: WHOLE_TREE_REASON };
  }
  return { refused: true, reason: `unsupported landing operation: ${operation}` };
}

export interface CleanSiblingReforwardInput {
  ticket: string;
  batchCommit: string;
  deferralCommit: string;
  defectiveTicket: string;
}

export interface CleanSiblingReforwardPlan {
  ticket: string;
  forwardCommit: string;
  recoveryTicket: string;
}

export function planCleanSiblingReforward(input: CleanSiblingReforwardInput): CleanSiblingReforwardPlan {
  if (input.deferralCommit !== input.batchCommit) {
    throw new Error('deferral commit must match the shared batch commit for unchanged re-forward');
  }
  return {
    ticket: input.ticket,
    forwardCommit: input.deferralCommit,
    recoveryTicket: input.defectiveTicket,
  };
}

export interface DefectiveReworkInput {
  ticket: string;
  batchCommit: string;
  lastCleanAncestor: string;
}

export interface DefectiveReworkPlan {
  ticket: string;
  branchBase: string;
  contaminatedBatchTip: string;
}

export function planDefectiveRework(input: DefectiveReworkInput): DefectiveReworkPlan {
  if (input.lastCleanAncestor === input.batchCommit) {
    throw new Error('last clean ancestor must precede the contaminated batch tip');
  }
  return {
    ticket: input.ticket,
    branchBase: input.lastCleanAncestor,
    contaminatedBatchTip: input.batchCommit,
  };
}

export function recoveryBranchExcludesContaminatedTip(plan: DefectiveReworkPlan): boolean {
  return plan.branchBase !== plan.contaminatedBatchTip;
}

export interface WholeTreeLandInput {
  landingOperation: string;
  verifiedCommit: string;
  defectiveRecoveryTip?: string;
}

export function validateWholeTreeLand(input: WholeTreeLandInput): LandingDisposition {
  const op = refuseNonWholeTreeLanding(input.landingOperation);
  if (op.refused) {
    return op;
  }
  if (!input.verifiedCommit) {
    return { refused: true, reason: WHOLE_TREE_REASON };
  }
  return { refused: false };
}

export interface MergeUpBroadcastInput {
  ticket: string;
  verifiedCommit: string;
  landedCommit: string;
  isAncestor: (descendant: string, ancestor: string) => boolean;
}

export interface MergeUpValidation {
  ok: boolean;
  reason?: string;
  namedCommit?: string;
}

export function validateMergeUpBroadcast(input: MergeUpBroadcastInput): MergeUpValidation {
  if (!input.verifiedCommit) {
    return { ok: false, reason: 'merge-up must name the verified whole-tree commit' };
  }
  if (!input.isAncestor(input.landedCommit, input.verifiedCommit)) {
    return {
      ok: false,
      reason: 'named commit must be an ancestor of the merge-up commit QA landed on main',
    };
  }
  return { ok: true, namedCommit: input.verifiedCommit };
}

export interface CleanSiblingLandIsolationInput {
  landedTicket: string;
  landedCommit: string;
  defectiveRecoveryTip: string;
  mergeIncludesCommit: (commit: string) => boolean;
}

export function validateCleanSiblingLandIsolation(input: CleanSiblingLandIsolationInput): { ok: boolean; reason?: string } {
  if (input.mergeIncludesCommit(input.defectiveRecoveryTip)) {
    return {
      ok: false,
      reason: 'defective recovery branch must not merge as part of the clean sibling landing',
    };
  }
  if (!input.mergeIncludesCommit(input.landedCommit)) {
    return { ok: false, reason: 'landing must merge the verified whole tree commit' };
  }
  return { ok: true };
}
