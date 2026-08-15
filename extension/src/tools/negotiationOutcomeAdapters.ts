// Shared wrapper around negotiate-onboarding-contract.ts's own
// runObject/runApprove (the ONE real writer of negotiation state, BL-381
// invariant) - translates its already-ended throw into the terminal
// ObjectToContractResult/ApproveContractResult outcome instead of letting it
// escape as an exception. Both BL-381's own Telegram negotiation relay
// (relay-onboarding-negotiation-telegram.ts) and BL-624's contract-phase
// relay (contractPhaseRealAdapters.ts) drive negotiation over a real target
// repo this same way; this file is their shared translation, never a second
// negotiation engine.
import { ProposedContract } from '../onboarding/contractTypes';
import { ApproveContractResult, ObjectToContractResult } from '../onboarding/negotiationTelegramRelay';
import { runObject, runApprove } from './negotiate-onboarding-contract';

function isAlreadyEndedError(err: unknown): boolean {
  return err instanceof Error && /already ended/.test(err.message);
}

export async function runObjectAsOutcome(targetRepoPath: string, text: string): Promise<ObjectToContractResult> {
  try {
    const result = await runObject(targetRepoPath, text);
    if (result.ended) {
      return { outcome: 'round-limit' };
    }
    if (!result.derived) {
      return { outcome: 'not-derived' };
    }
    return { outcome: 'revised', contract: result.contract as ProposedContract };
  } catch (err) {
    if (isAlreadyEndedError(err)) {
      return { outcome: 'already-ended' };
    }
    throw err;
  }
}

export async function runApproveAsOutcome(targetRepoPath: string): Promise<ApproveContractResult> {
  try {
    const result = await runApprove(targetRepoPath);
    return { outcome: 'agreed', contract: result.contract as ProposedContract };
  } catch (err) {
    if (isAlreadyEndedError(err)) {
      return { outcome: 'already-ended' };
    }
    throw err;
  }
}
