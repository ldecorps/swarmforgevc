/**
 * BL-727: the pilot's only landing path for a piloted ticket. Pure decision
 * logic - every side effect (reading the ticket's acceptance declaration,
 * running the acceptance pipeline, moving the yaml, writing the receipt) is
 * injected via PilotAcceptanceGateDeps so this module is unit-testable
 * without a real feature file, a real repo checkout, or a static import
 * edge from extension/src into specs/pipeline. The thin CLI wrapper
 * (pilot-acceptance-gate.ts) supplies the real deps.
 *
 * Invariants (backlog ticket BL-727):
 * 1. A piloted ticket reaches backlog/done/ only after its own declared
 *    acceptance contract executed green - absent, inline-only, or
 *    unreadable declarations fail CLOSED, never pass by absence.
 * 2. The gate executes the project's existing acceptance pipeline; it never
 *    reimplements Gherkin parsing or step matching. (Architecture/process
 *    invariant, not input/output behavior - see pilotAcceptanceGate.property
 *    .test.js's header comment for why this one has no property-test
 *    encoding.)
 * 3. A refused land is inert: no yaml move, no receipt, no other durable
 *    write.
 *
 * BL-729 adds a second refusal reason to the same landing path: a claim in a
 * run commit's own message ("restores `deliver!`") that the commit's own
 * patch does not support. Declared invariants:
 * 1. A commit's verdict is computed from that commit alone - its own message
 *    and its own patch - so the same commit yields the same verdict on any
 *    checkout, regardless of what sibling branches contain.
 * 2. Every non-merge commit the run authored is judged or explicitly
 *    reported unreadable; none is skipped, sampled, or assumed clean.
 * 3. A refused land is inert for every refusal reason, not only the
 *    acceptance-contract one BL-727 already covers (shared with invariant 3
 *    above - one behavior, not two).
 */
import * as fs from 'fs';
import * as path from 'path';
import { BacklogMoveResult } from '../panel/backlogWriter';

export interface AcceptanceRunResult {
  success: boolean;
  output: string;
}

export interface AcceptanceReceipt {
  ticketId: string;
  featureFile: string;
  landedCommit: string;
  result: 'passed';
  landedAt: string;
  commitClaimsChecked: number;
}

export interface UnsupportedCommitClaim {
  commit: string;
  identifier: string;
  sentence: string;
}

// `checked: false` is the BL-729 fails-OPEN case: the run's own commit range
// could not be resolved (no merge-base, an unreadable patch). `checked:
// true` always reports how many commits were judged; `unsupported` is only
// present when one of them made an unsupported claim.
export type CommitClaimsCheckOutcome =
  | { checked: true; commitsChecked: number; unsupported?: UnsupportedCommitClaim }
  | { checked: false };

export interface PilotAcceptanceGateDeps {
  readAcceptanceDeclaration: (ticketId: string) => string | undefined;
  resolveFeatureFilePath: (acceptanceDeclaration: string) => string | undefined;
  runAcceptance: (featureFilePath: string) => Promise<AcceptanceRunResult> | AcceptanceRunResult;
  checkCommitClaims: () => CommitClaimsCheckOutcome;
  moveTicketToDone: (ticketId: string) => BacklogMoveResult;
  writeReceipt: (ticketId: string, receipt: AcceptanceReceipt) => void;
  getLandedCommit: () => string;
  now: () => string;
}

export interface PilotLandSuccess {
  landed: true;
  destination: string;
  receipt: AcceptanceReceipt;
  warnings?: string[];
}

export interface PilotLandRefusal {
  landed: false;
  reasonKind: 'no-contract' | 'contract-failed' | 'claim-unsupported' | 'move-failed';
  reason: string;
  unmatchedStep?: string;
  failingScenario?: string;
  claimCommit?: string;
  claimIdentifier?: string;
  claimSentence?: string;
}

export type PilotLandOutcome = PilotLandSuccess | PilotLandRefusal;

const NO_STEP_HANDLER_RE = /no step handler matched "([^"]+)"/;
const FAILED_SCENARIO_RE = /Scenario "([^"]+)" failed at step/;

// The acceptance runner's own error text (specs/pipeline/runtime.js) names
// either the unmatched step or the failing scenario - extracted here rather
// than re-parsed by the caller, so a refusal's `reason` always names the
// same thing the runner itself named.
export function describeAcceptanceFailure(output: string): { failingScenario?: string; unmatchedStep?: string } {
  const failedScenario = output.match(FAILED_SCENARIO_RE);
  if (failedScenario) {
    return { failingScenario: failedScenario[1] };
  }
  const unmatchedStep = output.match(NO_STEP_HANDLER_RE);
  if (unmatchedStep) {
    return { unmatchedStep: unmatchedStep[1] };
  }
  return {};
}

type ContractResolution = { declaration: string; featureFilePath: string } | { refusal: PilotLandRefusal };

// Step 1: resolve the ticket's acceptance: declaration to an executable
// feature file, or the no-contract refusal naming what was declared.
function resolveContract(ticketId: string, deps: PilotAcceptanceGateDeps): ContractResolution {
  const declaration = deps.readAcceptanceDeclaration(ticketId);
  const featureFilePath = declaration ? deps.resolveFeatureFilePath(declaration) : undefined;
  if (!featureFilePath) {
    const declared = declaration === undefined ? 'no acceptance: field' : JSON.stringify(declaration);
    return {
      refusal: {
        landed: false,
        reasonKind: 'no-contract',
        reason: `${ticketId} has no executable acceptance contract: acceptance: must name an existing feature file (declared: ${declared})`,
      },
    };
  }
  // featureFilePath is only ever truthy when declaration was too (see the
  // ternary above), so this narrows what TS cannot infer from that ternary.
  return { declaration: declaration!, featureFilePath };
}

// Step 2: run the resolved feature file through the acceptance pipeline, or
// the contract-failed refusal naming the unmatched step / failing scenario.
async function runContract(
  ticketId: string,
  featureFilePath: string,
  deps: PilotAcceptanceGateDeps
): Promise<{ refusal: PilotLandRefusal } | undefined> {
  const result = await deps.runAcceptance(featureFilePath);
  if (result.success) {
    return undefined;
  }
  const { failingScenario, unmatchedStep } = describeAcceptanceFailure(result.output);
  const named = failingScenario
    ? `failing scenario "${failingScenario}"`
    : unmatchedStep
      ? `unmatched step "${unmatchedStep}"`
      : 'see acceptance output';
  return {
    refusal: {
      landed: false,
      reasonKind: 'contract-failed',
      reason: `${ticketId}'s acceptance contract did not pass: ${named}`,
      failingScenario,
      unmatchedStep,
    },
  };
}

// Step 3: a run commit whose message claims a change its own patch does not
// support refuses the land before anything moves - the precise BL-636 gap
// (a described fix was indistinguishable from a made fix). `checked: false`
// (history unreadable) is not a refusal: it falls through to land, carrying
// a warning instead.
function checkClaims(deps: PilotAcceptanceGateDeps): { refusal: PilotLandRefusal } | { claimsCheck: CommitClaimsCheckOutcome } {
  const claimsCheck = deps.checkCommitClaims();
  if (claimsCheck.checked && claimsCheck.unsupported) {
    const { commit, identifier, sentence } = claimsCheck.unsupported;
    return {
      refusal: {
        landed: false,
        reasonKind: 'claim-unsupported',
        reason: `commit ${commit} claims a change to "${identifier}" that its own patch does not support (claimed in: "${sentence}")`,
        claimCommit: commit,
        claimIdentifier: identifier,
        claimSentence: sentence,
      },
    };
  }
  return { claimsCheck };
}

// Step 4: a green contract with every claim supported (or unreadable
// history) has only the move itself left to fail - versus the landed
// outcome with its written receipt.
function moveAndRecordReceipt(
  ticketId: string,
  declaration: string,
  deps: PilotAcceptanceGateDeps,
  claimsCheck: CommitClaimsCheckOutcome
): PilotLandOutcome {
  // Captured before the move: if getLandedCommit() itself fails (e.g. no
  // HEAD yet), nothing has moved or been written yet either.
  const landedCommit = deps.getLandedCommit();

  const move = deps.moveTicketToDone(ticketId);
  if (!move.moved || !move.destination) {
    return {
      landed: false,
      reasonKind: 'move-failed',
      reason: `${ticketId}'s acceptance contract passed but the ticket yaml could not be moved to backlog/done/`,
    };
  }

  const receipt: AcceptanceReceipt = {
    ticketId,
    featureFile: declaration.trim(),
    landedCommit,
    result: 'passed',
    landedAt: deps.now(),
    commitClaimsChecked: claimsCheck.checked ? claimsCheck.commitsChecked : 0,
  };
  deps.writeReceipt(ticketId, receipt);

  const outcome: PilotLandSuccess = { landed: true, destination: move.destination, receipt };
  if (!claimsCheck.checked) {
    outcome.warnings = ['commit claims were not checked: the run\'s own commit history could not be resolved'];
  }
  return outcome;
}

export async function landPilotedTicket(ticketId: string, deps: PilotAcceptanceGateDeps): Promise<PilotLandOutcome> {
  const contract = resolveContract(ticketId, deps);
  if ('refusal' in contract) {
    return contract.refusal;
  }

  const contractFailure = await runContract(ticketId, contract.featureFilePath, deps);
  if (contractFailure) {
    return contractFailure.refusal;
  }

  const claims = checkClaims(deps);
  if ('refusal' in claims) {
    return claims.refusal;
  }

  return moveAndRecordReceipt(ticketId, contract.declaration, deps, claims.claimsCheck);
}

// Pure, fs-based: an acceptance declaration is executable only when it
// resolves to an existing file. Collapses "absent" (caller never invokes
// this with an undefined declaration - see landPilotedTicket above),
// "inline Gherkin text" (multi-line, so never a bare path), and "a path
// that does not exist" into the same fail-closed outcome via one existence
// check, rather than three separate code paths that could drift apart.
export function resolveFeatureFilePath(repoRoot: string, acceptanceDeclaration: string): string | undefined {
  const trimmed = acceptanceDeclaration.trim();
  if (!trimmed || trimmed.includes('\n')) {
    return undefined;
  }
  const candidate = path.isAbsolute(trimmed) ? trimmed : path.join(repoRoot, trimmed);
  try {
    return fs.statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}
