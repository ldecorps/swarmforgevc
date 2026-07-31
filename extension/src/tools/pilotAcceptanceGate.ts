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
}

export interface PilotAcceptanceGateDeps {
  readAcceptanceDeclaration: (ticketId: string) => string | undefined;
  resolveFeatureFilePath: (acceptanceDeclaration: string) => string | undefined;
  runAcceptance: (featureFilePath: string) => Promise<AcceptanceRunResult> | AcceptanceRunResult;
  moveTicketToDone: (ticketId: string) => BacklogMoveResult;
  writeReceipt: (ticketId: string, receipt: AcceptanceReceipt) => void;
  getLandedCommit: () => string;
  now: () => string;
}

export interface PilotLandSuccess {
  landed: true;
  destination: string;
  receipt: AcceptanceReceipt;
}

export interface PilotLandRefusal {
  landed: false;
  reasonKind: 'no-contract' | 'contract-failed' | 'move-failed';
  reason: string;
  unmatchedStep?: string;
  failingScenario?: string;
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

// Step 3: a green contract's only remaining ways to not land - the move
// itself failing - versus the landed outcome with its written receipt.
function moveAndRecordReceipt(ticketId: string, declaration: string, deps: PilotAcceptanceGateDeps): PilotLandOutcome {
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
  };
  deps.writeReceipt(ticketId, receipt);
  return { landed: true, destination: move.destination, receipt };
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

  return moveAndRecordReceipt(ticketId, contract.declaration, deps);
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
