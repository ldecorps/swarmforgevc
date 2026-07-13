#!/usr/bin/env node
/**
 * BL-344: the iterative negotiation loop on top of BL-262's single-round
 * proposal. The operator objects, in his own words, to a proposed
 * contract; the swarm revises IN RESPONSE and re-proposes; the loop ends
 * on approval or a bounded round cap, whichever comes first. Reuses
 * BL-262's own contract.yaml/CONTRACT.md artifact and build-start gate
 * unchanged - a revision is still just `agreement: proposed` until
 * approved, so nothing new needs to be taught to the gate.
 *
 * Usage:
 *   node negotiate-onboarding-contract.js <target-repo-path> object "<objection text>"
 *   node negotiate-onboarding-contract.js <target-repo-path> approve
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseContractYaml } from '../onboarding/contractView';
import {
  DEFAULT_MAX_NEGOTIATION_ROUNDS,
  NegotiationState,
  approveContract,
  objectToContract,
  startNegotiation,
} from '../onboarding/contractNegotiation';
import { parseNegotiationLog, renderNegotiationLogLine } from '../onboarding/negotiationLog';
import { updateTargetContract } from '../config/targetBootstrap';
import { printJsonToStdout, runCliMain } from './swarm-metrics';

export type ParsedArgs =
  | { targetRepoPath: string; action: 'object'; objection: string }
  | { targetRepoPath: string; action: 'approve' };

export function parseArgs(argv: string[]): ParsedArgs | null {
  const [targetRepoPath, action, objection] = argv;
  if (!targetRepoPath || !action) return null;
  if (action === 'object') {
    return objection ? { targetRepoPath, action: 'object', objection } : null;
  }
  if (action === 'approve') {
    return { targetRepoPath, action: 'approve' };
  }
  return null;
}

export function negotiationLogPath(targetRepoPath: string): string {
  return path.join(targetRepoPath, '.swarmforge', 'onboarding-negotiation.jsonl');
}

// A dedicated, explicit terminal marker for the round-limit outcome -
// deliberately NOT derived from "rounds recorded === maxRounds", because
// using every round successfully is not itself terminal (the operator can
// still approve the LAST round's own revision). Only an objection
// ATTEMPTED after the budget is already exhausted is terminal, and that
// attempt writes nothing else (no revised contract, no new round) - this
// file is the one durable trace of it, so a LATER, separate CLI
// invocation (this loop is re-invoked fresh per round, potentially hours
// apart) can still tell "exhausted, refuse everything" apart from
// "exactly at the cap, one legitimate round old, approval still open".
function negotiationEndedPath(targetRepoPath: string): string {
  return path.join(targetRepoPath, '.swarmforge', 'onboarding-negotiation-ended.json');
}

function contractYamlPath(targetRepoPath: string): string {
  return path.join(targetRepoPath, '.swarmforge', 'contract.yaml');
}

// Reconstructs the FULL negotiation state from the durable, real artifacts
// already on disk - the contract's own current agreement field (never a
// separately-tracked "approved" flag that could drift from it), the
// append-only round log, and the round-limit terminal marker above.
// `ended`/`endedReason` are DERIVED, not guessed from a round count alone.
// This is what makes the CLI safely re-invocable across many separate
// process runs (each a fresh negotiation round, potentially hours apart).
export function readNegotiationState(targetRepoPath: string): NegotiationState {
  const rawContract = fs.readFileSync(contractYamlPath(targetRepoPath), 'utf8');
  const contract = parseContractYaml(rawContract);
  if (!contract) {
    throw new Error(`${contractYamlPath(targetRepoPath)} is missing or malformed - cannot negotiate a contract that was never proposed`);
  }
  const rounds = fs.existsSync(negotiationLogPath(targetRepoPath))
    ? parseNegotiationLog(fs.readFileSync(negotiationLogPath(targetRepoPath), 'utf8'))
    : [];
  const state = startNegotiation(contract);
  if (contract.agreement === 'agreed') {
    return { ...state, rounds, ended: true, endedReason: 'approved' };
  }
  if (fs.existsSync(negotiationEndedPath(targetRepoPath))) {
    return { ...state, rounds, ended: true, endedReason: 'round-limit' };
  }
  return { ...state, rounds };
}

async function appendRound(targetRepoPath: string, state: NegotiationState): Promise<void> {
  const lastRound = state.rounds[state.rounds.length - 1];
  if (!lastRound) return;
  await fs.promises.mkdir(path.dirname(negotiationLogPath(targetRepoPath)), { recursive: true });
  await fs.promises.appendFile(negotiationLogPath(targetRepoPath), renderNegotiationLogLine(lastRound), 'utf8');
}

export async function runObject(
  targetRepoPath: string,
  objection: string,
  maxRounds: number = DEFAULT_MAX_NEGOTIATION_ROUNDS
): Promise<Record<string, unknown>> {
  const before = readNegotiationState(targetRepoPath);
  if (before.ended) {
    throw new Error(`negotiation already ended (${before.endedReason}) - no further objections are accepted`);
  }
  const after = objectToContract(before, objection, maxRounds);
  if (after.ended) {
    // The round budget was already exhausted by this very attempt -
    // nothing is written to the contract or the round log, but the
    // terminal outcome itself IS persisted, so a later, separate
    // invocation knows to refuse without needing to repeat this attempt.
    await fs.promises.mkdir(path.dirname(negotiationEndedPath(targetRepoPath)), { recursive: true });
    await fs.promises.writeFile(negotiationEndedPath(targetRepoPath), JSON.stringify({ reason: after.endedReason }), 'utf8');
    return { ended: true, endedReason: after.endedReason, round: null };
  }
  await updateTargetContract(targetRepoPath, after.contract, `Revise SwarmForge onboarding contract (round ${after.rounds.length})`);
  await appendRound(targetRepoPath, after);
  return { ended: false, endedReason: null, round: after.rounds[after.rounds.length - 1] };
}

export async function runApprove(targetRepoPath: string): Promise<Record<string, unknown>> {
  const before = readNegotiationState(targetRepoPath);
  if (before.ended) {
    throw new Error(`negotiation already ended (${before.endedReason}) - nothing left to approve`);
  }
  const after = approveContract(before);
  await updateTargetContract(targetRepoPath, after.contract, 'Approve SwarmForge onboarding contract');
  return { ended: true, endedReason: after.endedReason, rounds: after.rounds.length };
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(
      'Usage: node negotiate-onboarding-contract.js <target-repo-path> object "<objection text>"\n' +
        '       node negotiate-onboarding-contract.js <target-repo-path> approve\n'
    );
    process.exitCode = 1;
    return;
  }
  const result =
    args.action === 'object' ? await runObject(args.targetRepoPath, args.objection) : await runApprove(args.targetRepoPath);
  printJsonToStdout(result);
}

if (require.main === module) {
  runCliMain(main);
}
