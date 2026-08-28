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
 *
 * BL-737 adds a cross-file duplication refusal on the same path: identical
 * normalized text in more than two files the run's own commits touched.
 */
import * as fs from 'fs';
import * as path from 'path';
import { BacklogMoveResult } from '../panel/backlogWriter';
import {
  MultiworktreeFixtureAssessment,
  MultiworktreeFixtureMetadata,
  MULTIWORKTREE_REQUIRED_REFUSAL,
} from './multiworktreeAcceptanceFixture';
import {
  assessProducerCrosscheck,
  isPatternTicket,
  PRODUCER_CROSSCHECK_REQUIRED_REFUSAL,
  ProducerCrosscheckMetadata,
} from './producerCrosscheckAcceptance';
import {
  ACCEPTANCE_NOT_EXECUTED_REFUSAL,
  acceptanceExecutedForFeature,
  assessRelandNotes,
  isRevertRelandTicket,
  RELAND_NOTES_REQUIRED_REFUSAL,
} from './pilotAcceptanceExecution';
import {
  CROSS_FILE_DUPLICATION_REFUSAL,
  CrossFileDuplicationCheckOutcome,
} from './crossFileDuplicationCheck';
import {
  PARALLEL_SHELL_REIMPLEMENTATION_REFUSAL,
  ShellEntryPointDriveCheckOutcome,
} from './shellEntryPointDriveCheck';
import {
  UNREACHABLE_STEP_HANDLER_REFUSAL,
  UnreachableStepHandlerCheckOutcome,
} from './unreachableStepHandlerCheck';
import {
  UNTESTED_PARSER_BRANCH_REFUSAL,
  MultiBranchParserCoverageOutcome,
} from './multiBranchParserCoverageCheck';
import {
  PILOT_HAT_PROMPT_MISSING_REFUSAL,
  PerHatRolePromptEvidenceOutcome,
} from './perHatRolePromptEvidenceCheck';
import {
  PILOT_CRAP_VIOLATION_REFUSAL,
  PILOT_CRAP_EVIDENCE_MISSING_REFUSAL,
  PilotScopedCrapCheckOutcome,
  assessPilotScopedCrap,
  isExtensionSrcTsPath,
  isExtensionTsPath,
} from './pilotScopedCrapCheck';
import {
  PILOT_RAW_MKDTEMP_REFUSAL,
  PilotMkdtempConventionCheckOutcome,
} from './pilotMkdtempConventionCheck';
import {
  PILOT_VACUOUS_PROPERTY_GENERATOR_REFUSAL,
  PropertyGeneratorReachCheckOutcome,
} from './propertyGeneratorReachCheck';
import {
  ORPHANED_AUTHORED_DOC_REFUSAL,
  OrphanDocsLandCheckOutcome,
} from './docsOrphanLandCheck';

export {
  assessProducerCrosscheck,
  DISPLAY_NAME_FOR_ROLE_PRODUCER,
  enumerateDisplayNameForRoleOutputs,
  isPatternTicket,
  PRODUCER_CROSSCHECK_ENV,
  PRODUCER_CROSSCHECK_REQUIRED_REFUSAL,
  ProducerCrosscheckMetadata,
  readConfiguredRoleNames,
  recordProducerCrosscheck,
} from './producerCrosscheckAcceptance';

export {
  CROSS_FILE_DUPLICATION_REFUSAL,
  findCrossFileDuplication,
  MIN_DUPLICATION_BLOCK_LINES,
  CrossFileDuplicationCheckOutcome,
  CrossFileDuplicationHit,
} from './crossFileDuplicationCheck';

export {
  PARALLEL_SHELL_REIMPLEMENTATION_REFUSAL,
  assessShellEntryPointDrive,
  extractNamedEntryPoints,
  testInvokesEntryPoint,
  ShellEntryPointDriveCheckOutcome,
  ShellEntryPointDriveMiss,
} from './shellEntryPointDriveCheck';

export {
  UNREACHABLE_STEP_HANDLER_REFUSAL,
  assessUnreachableStepHandlers,
  extractRegisteredPatternSources,
  renderFeatureStepTexts,
  isStepHandlerPath,
  isPairedStepFile,
  UnreachableStepHandlerCheckOutcome,
  UnreachableStepHandlerMiss,
} from './unreachableStepHandlerCheck';

export {
  UNTESTED_PARSER_BRANCH_REFUSAL,
  assessMultiBranchParserCoverage,
  extractMultiBranchParsers,
  armExercisedByTests,
  MIN_PARSER_ARMS,
  MultiBranchParserCoverageOutcome,
  UntestedParserBranchMiss,
  MultiBranchParser,
} from './multiBranchParserCoverageCheck';

export {
  PILOT_HAT_PROMPT_MISSING_REFUSAL,
  assessPerHatRolePromptEvidence,
  verdictHasRolePromptEvidence,
  PerHatRolePromptEvidenceOutcome,
  PerHatRolePromptMiss,
  StageVerdictEvidence,
} from './perHatRolePromptEvidenceCheck';

export {
  PILOT_CRAP_VIOLATION_REFUSAL,
  PILOT_CRAP_EVIDENCE_MISSING_REFUSAL,
  PilotScopedCrapCheckOutcome,
  assessPilotScopedCrap,
  isExtensionSrcTsPath,
  isExtensionTsPath,
} from './pilotScopedCrapCheck';

export {
  PILOT_RAW_MKDTEMP_REFUSAL,
  PilotMkdtempConventionCheckOutcome,
  assessPilotMkdtempConvention,
  isExtensionTestJsPath,
} from './pilotMkdtempConventionCheck';

export {
  PILOT_VACUOUS_PROPERTY_GENERATOR_REFUSAL,
  PropertyGeneratorReachCheckOutcome,
  assessPropertyGeneratorReach,
  isPropertyTestPath,
} from './propertyGeneratorReachCheck';

export {
  ORPHANED_AUTHORED_DOC_REFUSAL,
  OrphanDocsLandCheckOutcome,
  assessOrphanDocsLandCheck,
} from './docsOrphanLandCheck';

export interface AcceptanceRunResult {
  success: boolean;
  output: string;
  multiWorktreeFixture?: MultiworktreeFixtureMetadata;
  producerCrosscheck?: ProducerCrosscheckMetadata;
}

export interface AcceptanceReceipt {
  ticketId: string;
  featureFile: string;
  landedCommit: string;
  result: 'passed';
  landedAt: string;
  commitClaimsChecked: number;
  crossFileDuplicationFilesScanned?: number;
  shellEntryPointDrive?: { shellTestsScanned: number; entryPointsNamed: number };
  unreachableStepHandlers?: { stepFilesScanned: number; patternsChecked: number };
  multiBranchParserCoverage?: { parsersScanned: number };
  perHatRolePromptEvidence?: { verdictsScanned: number };
  /** AcceptanceReceipt.scopedCrap — durable paths-scanned + outcome evidence (BL-745). */
  scopedCrap?: { tsFilesScanned: number; scannedPaths: string[]; outcome: 'passed' };
  mkdtempConvention?: { testFilesScanned: number };
  orphanedDocsCheck?: { docsTouched: boolean };
  multiWorktreeFixture?: MultiworktreeFixtureMetadata;
  producerCrosscheck?: ProducerCrosscheckMetadata;
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

// BL-1215: unlike every other checked/unchecked outcome shape in this file,
// this one has NO "not checked" case - an origin/main that cannot be read
// is refused, never waved through with a warning (fails CLOSED, the
// deliberate mirror image of CommitClaimsCheckOutcome's fails-OPEN
// posture). `reason` names why, for both the not-landed and
// origin-unreadable cases alike, so the refusal text never has to guess.
export type OriginMainLandingCheckOutcome = { reachable: true } | { reachable: false; reason: string };

export interface PilotAcceptanceGateDeps {
  readAcceptanceDeclaration: (ticketId: string) => string | undefined;
  readRequiredWiring?: (ticketId: string) => string[] | undefined;
  readTicketNotes?: (ticketId: string) => string | undefined;
  acceptanceReceiptExists?: (ticketId: string) => boolean;
  resolveFeatureFilePath: (acceptanceDeclaration: string) => string | undefined;
  isLifecycleTeardownTicket: (ticketId: string) => boolean;
  assessMultiworktreeFixture: () => MultiworktreeFixtureAssessment;
  runAcceptance: (featureFilePath: string) => Promise<AcceptanceRunResult> | AcceptanceRunResult;
  recordAcceptanceExecution?: (featureFilePath: string) => void;
  readAcceptanceExecution?: () => string | undefined;
  checkCommitClaims: () => CommitClaimsCheckOutcome;
  checkCrossFileDuplication: () => CrossFileDuplicationCheckOutcome;
  checkScopedCrap: () => PilotScopedCrapCheckOutcome;
  checkMkdtempConvention: () => PilotMkdtempConventionCheckOutcome;
  checkPropertyGeneratorReach: () => PropertyGeneratorReachCheckOutcome;
  checkShellEntryPointDrive: (ticketId: string) => ShellEntryPointDriveCheckOutcome;
  checkOrphanedAuthoredDocs: () => OrphanDocsLandCheckOutcome;
  checkUnreachableStepHandlers: (ticketId: string) => UnreachableStepHandlerCheckOutcome;
  checkMultiBranchParserCoverage: (ticketId: string) => MultiBranchParserCoverageOutcome;
  checkPerHatRolePromptEvidence: (ticketId: string) => PerHatRolePromptEvidenceOutcome;
  moveTicketToDone: (ticketId: string) => BacklogMoveResult;
  writeReceipt: (ticketId: string, receipt: AcceptanceReceipt) => void;
  getLandedCommit: () => string;
  // BL-1215: is `commit` (the run's own implementation commit, from
  // getLandedCommit above) reachable from origin/main right now. No
  // network in unit tests - a real seam, injected the same way as every
  // other check in this deps interface.
  checkOriginMainLanding: (commit: string) => OriginMainLandingCheckOutcome;
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
  reasonKind:
    | 'no-contract'
    | 'multiworktree-required'
    | 'acceptance-not-executed'
    | 'reland-notes-required'
    | 'contract-failed'
    | 'producer-crosscheck-required'
    | 'claim-unsupported'
    | 'cross-file-duplication'
    | 'crap-violation'
    | 'crap-evidence-missing'
    | 'raw-mkdtemp-outside-helper'
    | 'vacuous-property-generator'
    | 'parallel-shell-reimplementation'
    | 'orphaned-authored-doc'
    | 'unreachable-step-handler'
    | 'untested-parser-branch'
    | 'pilot-hat-prompt-missing'
    | 'commit-not-on-origin-main'
    | 'move-failed';
  reason: string;
  unmatchedStep?: string;
  failingScenario?: string;
  unlandedCommit?: string;
  claimCommit?: string;
  claimIdentifier?: string;
  claimSentence?: string;
  duplicationFingerprint?: string;
  duplicationPaths?: string[];
  crapFile?: string;
  crapFunction?: string;
  mkdtempFile?: string;
  mkdtempLine?: number;
  vacuousPropertyFile?: string;
  vacuousPropertyFunction?: string;
  vacuousGeneratorBound?: number;
  vacuousFunctionBoundary?: number;
  shellEntryPoint?: string;
  shellTestPath?: string;
  orphanedDocPath?: string;
  unreachablePattern?: string;
  unreachableStepFile?: string;
  untestedParserFunction?: string;
  untestedParserArm?: string;
  untestedParserPath?: string;
  missingHatPromptRole?: string;
  missingHatPromptVerdict?: string;
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

// Step 2: lifecycle/teardown tickets refuse land when the host only offers a
// single-worktree sandbox — the BL-637 class of defect hides behind that.
function requireMultiworktreeFixture(
  ticketId: string,
  deps: PilotAcceptanceGateDeps
): { refusal: PilotLandRefusal } | { fixture: MultiworktreeFixtureAssessment } {
  if (!deps.isLifecycleTeardownTicket(ticketId)) {
    return { fixture: { satisfied: true, metadata: { worktreeCount: 1, siblingHandoffdRoots: [], pilotRoot: '' } } };
  }
  const fixture = deps.assessMultiworktreeFixture();
  if (!fixture.satisfied) {
    return {
      refusal: {
        landed: false,
        reasonKind: 'multiworktree-required',
        reason: `${ticketId} refuses land: ${MULTIWORKTREE_REQUIRED_REFUSAL}`,
      },
    };
  }
  return { fixture };
}

// Step 3: run the resolved feature file through the acceptance pipeline, or
// the contract-failed refusal naming the unmatched step / failing scenario.
async function runContract(
  ticketId: string,
  featureFilePath: string,
  deps: PilotAcceptanceGateDeps
): Promise<{ refusal: PilotLandRefusal } | { runResult: AcceptanceRunResult }> {
  const result = await deps.runAcceptance(featureFilePath);
  if (result.success) {
    deps.recordAcceptanceExecution?.(featureFilePath);
    return { runResult: result };
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

// Step 3c: identical normalized blocks shared by more than two files the
// run itself touched refuse the land (BL-737 / BL-637 threshold). Unreadable
// touched-file history fails OPEN with a warning, mirroring BL-729.
function checkDuplication(
  deps: PilotAcceptanceGateDeps
): { refusal: PilotLandRefusal } | { duplicationCheck: CrossFileDuplicationCheckOutcome } {
  const duplicationCheck = deps.checkCrossFileDuplication();
  if (duplicationCheck.checked && duplicationCheck.duplication) {
    const { fingerprint, paths } = duplicationCheck.duplication;
    const named = paths.slice(0, 2).join(', ');
    return {
      refusal: {
        landed: false,
        reasonKind: 'cross-file-duplication',
        reason: `${CROSS_FILE_DUPLICATION_REFUSAL} (fingerprint length ${fingerprint.length}; e.g. ${named})`,
        duplicationFingerprint: fingerprint,
        duplicationPaths: paths,
      },
    };
  }
  return { duplicationCheck };
}

// Step 3c½: touched extension/*.ts must pass scoped CRAP (BL-741). Runs even when
// mutation_cost is low — that flag lightens mutation testing only, never CRAP.
// Unreadable touched-file history fails OPEN with a warning, mirroring BL-729.
function checkCrap(
  deps: PilotAcceptanceGateDeps
): { refusal: PilotLandRefusal } | { crapCheck: PilotScopedCrapCheckOutcome } {
  const crapCheck = deps.checkScopedCrap();
  if (crapCheck.checked && crapCheck.violations.length > 0) {
    const hit = crapCheck.violations[0];
    return {
      refusal: {
        landed: false,
        reasonKind: 'crap-violation',
        reason: `${PILOT_CRAP_VIOLATION_REFUSAL} (file ${hit.file}; function ${hit.function}; CRAP=${hit.crap.toFixed(2)})`,
        crapFile: hit.file,
        crapFunction: hit.function,
      },
    };
  }
  return { crapCheck };
}

function extensionSrcPathsInScope(crapCheck: PilotScopedCrapCheckOutcome): string[] {
  if (crapCheck.checked) {
    const fromScanned = (crapCheck.scannedPaths ?? []).filter(isExtensionSrcTsPath);
    if (fromScanned.length > 0) {
      return fromScanned;
    }
    return crapCheck.srcPathsInScope ?? [];
  }
  return crapCheck.srcPathsInScope ?? [];
}

function buildScopedCrapReceiptEvidence(
  crapCheck: PilotScopedCrapCheckOutcome
): AcceptanceReceipt['scopedCrap'] | undefined {
  if (!crapCheck.checked) {
    return undefined;
  }
  const srcPaths = (crapCheck.scannedPaths ?? []).filter(isExtensionSrcTsPath);
  if (srcPaths.length === 0) {
    return undefined;
  }
  return {
    tsFilesScanned: crapCheck.tsFilesScanned,
    scannedPaths: crapCheck.scannedPaths ?? [],
    outcome: 'passed',
  };
}

function srcPathsNamedInEvidence(
  srcPaths: string[],
  evidence: AcceptanceReceipt['scopedCrap']
): boolean {
  if (!evidence) {
    return false;
  }
  const named = evidence.scannedPaths.filter(isExtensionSrcTsPath);
  return srcPaths.every((p) => named.includes(p));
}

// Step 3c⅝: src-touching lands must leave durable path-scoped CRAP evidence (BL-745).
function requireScopedCrapReceiptEvidence(
  ticketId: string,
  crapCheck: PilotScopedCrapCheckOutcome
): { refusal: PilotLandRefusal } | { evidence?: AcceptanceReceipt['scopedCrap'] } {
  const srcPaths = extensionSrcPathsInScope(crapCheck);
  if (srcPaths.length === 0) {
    return { evidence: buildScopedCrapReceiptEvidence(crapCheck) };
  }
  const evidence = buildScopedCrapReceiptEvidence(crapCheck);
  if (!srcPathsNamedInEvidence(srcPaths, evidence)) {
    return {
      refusal: {
        landed: false,
        reasonKind: 'crap-evidence-missing',
        reason: `${ticketId} refuses land: ${PILOT_CRAP_EVIDENCE_MISSING_REFUSAL}`,
      },
    };
  }
  return { evidence };
}

// Step 3c¾: touched extension/test/*.js must use mkTmpDir, not raw mkdtempSync
// outside helpers/tmpDir.js (BL-743). Unreadable touched-file history fails OPEN.
function checkMkdtemp(
  deps: PilotAcceptanceGateDeps
): { refusal: PilotLandRefusal } | { mkdtempCheck: PilotMkdtempConventionCheckOutcome } {
  const mkdtempCheck = deps.checkMkdtempConvention();
  if (mkdtempCheck.checked && mkdtempCheck.violations.length > 0) {
    const hit = mkdtempCheck.violations[0];
    return {
      refusal: {
        landed: false,
        reasonKind: 'raw-mkdtemp-outside-helper',
        reason: `${PILOT_RAW_MKDTEMP_REFUSAL} (file ${hit.file}; line ${hit.line})`,
        mkdtempFile: hit.file,
        mkdtempLine: hit.line,
      },
    };
  }
  return { mkdtempCheck };
}

// Step 3c⅞: touched *.property.test.js must reach the non-trivial branch of
// the function under test (BL-739). vacuous *.property.test.js refuses land.
// Unreadable touched-file history fails OPEN.
export function checkPropertyGeneratorReach(
  deps: PilotAcceptanceGateDeps
): { refusal: PilotLandRefusal } | { reachCheck: PropertyGeneratorReachCheckOutcome } {
  const reachCheck = deps.checkPropertyGeneratorReach();
  if (reachCheck.checked && reachCheck.miss) {
    const { propertyFile, targetFunction, generatorBound, functionBoundary } = reachCheck.miss;
    return {
      refusal: {
        landed: false,
        reasonKind: 'vacuous-property-generator',
        reason: `${PILOT_VACUOUS_PROPERTY_GENERATOR_REFUSAL} (file ${propertyFile}; function ${targetFunction}; generator max ${generatorBound}; boundary ${functionBoundary})`,
        vacuousPropertyFile: propertyFile,
        vacuousPropertyFunction: targetFunction,
        vacuousGeneratorBound: generatorBound,
        vacuousFunctionBoundary: functionBoundary,
      },
    };
  }
  return { reachCheck };
}

// Step 3d: when the run touches shell tests and the ticket names a non-test
// .sh entry-point, every named basename must be invoked in a touched test
// (BL-747 / BL-637 parallel-reimplementation gap). Unreadable inputs fail OPEN.
function checkShellDrive(
  ticketId: string,
  deps: PilotAcceptanceGateDeps
): { refusal: PilotLandRefusal } | { shellDriveCheck: ShellEntryPointDriveCheckOutcome } {
  const shellDriveCheck = deps.checkShellEntryPointDrive(ticketId);
  if (shellDriveCheck.checked && shellDriveCheck.miss) {
    const { entryPoint, testPath } = shellDriveCheck.miss;
    return {
      refusal: {
        landed: false,
        reasonKind: 'parallel-shell-reimplementation',
        reason: `${PARALLEL_SHELL_REIMPLEMENTATION_REFUSAL} (entry-point ${entryPoint}; test ${testPath})`,
        shellEntryPoint: entryPoint,
        shellTestPath: testPath,
      },
    };
  }
  return { shellDriveCheck };
}

// Step 3d½: orphaned authored doc land refusal when docs touched — authored
// Divio-mode docs must be linked from docs/index.md (BL-757). Unreadable
// inputs fail OPEN; no docs touched skips the check.
function checkOrphanAuthoredDocs(
  deps: PilotAcceptanceGateDeps
): { refusal: PilotLandRefusal } | { orphanDocsCheck: OrphanDocsLandCheckOutcome } {
  const orphanDocsCheck = deps.checkOrphanedAuthoredDocs();
  if (orphanDocsCheck.checked && orphanDocsCheck.docsTouched && orphanDocsCheck.miss) {
    const { path: docPath } = orphanDocsCheck.miss;
    return {
      refusal: {
        landed: false,
        reasonKind: 'orphaned-authored-doc',
        reason: `${ORPHANED_AUTHORED_DOC_REFUSAL} (${docPath})`,
        orphanedDocPath: docPath,
      },
    };
  }
  return { orphanDocsCheck };
}

// Step 3e: touched specs/pipeline/steps/*.js patterns must match a rendered
// step of the ticket's acceptance feature (BL-753). Unreadable inputs fail OPEN.
function checkUnreachableHandlers(
  ticketId: string,
  deps: PilotAcceptanceGateDeps
): { refusal: PilotLandRefusal } | { unreachableCheck: UnreachableStepHandlerCheckOutcome } {
  const unreachableCheck = deps.checkUnreachableStepHandlers(ticketId);
  if (unreachableCheck.checked && unreachableCheck.miss) {
    const { pattern, stepFilePath } = unreachableCheck.miss;
    return {
      refusal: {
        landed: false,
        reasonKind: 'unreachable-step-handler',
        reason: `${UNREACHABLE_STEP_HANDLER_REFUSAL} (pattern ${pattern}; file ${stepFilePath})`,
        unreachablePattern: pattern,
        unreachableStepFile: stepFilePath,
      },
    };
  }
  return { unreachableCheck };
}

// Step 3f: run-touched multi-arm parsers (≥3 cond/case/if-else arms) need a
// distinct exercising test per arm (BL-755). Unreadable inputs fail OPEN.
function checkMultiBranchCoverage(
  ticketId: string,
  deps: PilotAcceptanceGateDeps
): { refusal: PilotLandRefusal } | { multiBranchCheck: MultiBranchParserCoverageOutcome } {
  const multiBranchCheck = deps.checkMultiBranchParserCoverage(ticketId);
  if (multiBranchCheck.checked && multiBranchCheck.miss) {
    const { functionName, sourcePath, armLabel } = multiBranchCheck.miss;
    return {
      refusal: {
        landed: false,
        reasonKind: 'untested-parser-branch',
        reason: `${UNTESTED_PARSER_BRANCH_REFUSAL} (function ${functionName}; arm ${armLabel}; file ${sourcePath})`,
        untestedParserFunction: functionName,
        untestedParserArm: armLabel,
        untestedParserPath: sourcePath,
      },
    };
  }
  return { multiBranchCheck };
}

// Step 3g: every completed expedite stage verdict must record the injected
// role prompt path + sha256 (BL-758). Unreadable expedite trees fail OPEN.
function checkPerHatPromptEvidence(
  ticketId: string,
  deps: PilotAcceptanceGateDeps
): { refusal: PilotLandRefusal } | { perHatCheck: PerHatRolePromptEvidenceOutcome } {
  const perHatCheck = deps.checkPerHatRolePromptEvidence(ticketId);
  if (perHatCheck.checked && perHatCheck.miss) {
    const { verdictPath, role } = perHatCheck.miss;
    const named = role || verdictPath;
    return {
      refusal: {
        landed: false,
        reasonKind: 'pilot-hat-prompt-missing',
        reason: `${PILOT_HAT_PROMPT_MISSING_REFUSAL} (${named})`,
        missingHatPromptRole: role,
        missingHatPromptVerdict: verdictPath,
      },
    };
  }
  return { perHatCheck };
}

// Step 2b: revert-then-reland tickets must carry visible yaml notes before
// a second done move — the BL-559 double-land hygiene gap.
function requireRelandNotes(ticketId: string, deps: PilotAcceptanceGateDeps): { refusal: PilotLandRefusal } | { ok: true } {
  const notes = deps.readTicketNotes?.(ticketId);
  if (!isRevertRelandTicket(notes)) {
    return { ok: true };
  }
  if (!assessRelandNotes(notes).satisfied) {
    return {
      refusal: {
        landed: false,
        reasonKind: 'reland-notes-required',
        reason: `${ticketId} refuses land: ${RELAND_NOTES_REQUIRED_REFUSAL}`,
      },
    };
  }
  return { ok: true };
}

// Step 3a: declaration alone is insufficient — the acceptance pipeline must
// have executed for this landing attempt before anything moves.
function requireAcceptanceExecuted(
  ticketId: string,
  featureFilePath: string,
  deps: PilotAcceptanceGateDeps
): { refusal: PilotLandRefusal } | { ok: true } {
  const executed = deps.readAcceptanceExecution?.();
  if (acceptanceExecutedForFeature(executed, featureFilePath)) {
    return { ok: true };
  }
  return {
    refusal: {
      landed: false,
      reasonKind: 'acceptance-not-executed',
      reason: `${ticketId} refuses land: ${ACCEPTANCE_NOT_EXECUTED_REFUSAL}`,
    },
  };
}

// Step 3b: pattern/regex tickets must carry exhaustive producer crosscheck
// metadata from the acceptance pipeline — repro-only coverage cannot land.
function requireProducerCrosscheck(
  ticketId: string,
  acceptance: string,
  requiredWiring: string[] | undefined,
  runResult: AcceptanceRunResult
): { refusal: PilotLandRefusal } | { crosscheck?: ProducerCrosscheckMetadata } {
  if (!isPatternTicket(acceptance, requiredWiring)) {
    return { crosscheck: runResult.producerCrosscheck };
  }
  const assessment = assessProducerCrosscheck(runResult.producerCrosscheck);
  if (!assessment.satisfied) {
    return {
      refusal: {
        landed: false,
        reasonKind: 'producer-crosscheck-required',
        reason: `${ticketId} refuses land: ${PRODUCER_CROSSCHECK_REQUIRED_REFUSAL}`,
      },
    };
  }
  return { crosscheck: assessment.metadata };
}

// BL-1215: "done" is a fact about origin/main, not about local HEAD alone.
// Fails CLOSED - the deliberate mirror of checkClaims' fails-OPEN posture
// above: an origin/main that cannot be read is treated as not-landed,
// never waved through with a warning, because silence about origin/main
// is exactly the defect this closes (BL-1158). Never a push - refusal
// only; landing the commit is a human/pilot's own next step.
function checkOriginLanding(
  commit: string,
  deps: PilotAcceptanceGateDeps
): { refusal: PilotLandRefusal } | { ok: true } {
  const outcome = deps.checkOriginMainLanding(commit);
  if (!outcome.reachable) {
    return {
      refusal: {
        landed: false,
        reasonKind: 'commit-not-on-origin-main',
        reason: `refuses land: implementation commit ${commit} is not reachable from origin/main (${outcome.reason}) - push it and re-run`,
        unlandedCommit: commit,
      },
    };
  }
  return { ok: true };
}

// Step 4: a green contract with every claim supported (or unreadable
// history) has only the move itself left to fail - versus the landed
// outcome with its written receipt.
function moveAndRecordReceipt(
  ticketId: string,
  declaration: string,
  deps: PilotAcceptanceGateDeps,
  claimsCheck: CommitClaimsCheckOutcome,
  duplicationCheck: CrossFileDuplicationCheckOutcome,
  crapCheck: PilotScopedCrapCheckOutcome,
  scopedCrapEvidence: AcceptanceReceipt['scopedCrap'] | undefined,
  mkdtempCheck: PilotMkdtempConventionCheckOutcome,
  reachCheck: PropertyGeneratorReachCheckOutcome,
  shellDriveCheck: ShellEntryPointDriveCheckOutcome,
  orphanDocsCheck: OrphanDocsLandCheckOutcome,
  unreachableCheck: UnreachableStepHandlerCheckOutcome,
  multiBranchCheck: MultiBranchParserCoverageOutcome,
  perHatCheck: PerHatRolePromptEvidenceOutcome,
  multiWorktreeFixture?: MultiworktreeFixtureMetadata,
  producerCrosscheck?: ProducerCrosscheckMetadata
): PilotLandOutcome {
  // Captured before the move: if getLandedCommit() itself fails (e.g. no
  // HEAD yet), nothing has moved or been written yet either.
  const landedCommit = deps.getLandedCommit();

  // BL-1215: verify the commit actually reached origin/main BEFORE
  // anything moves or is written - a refused land here is exactly as
  // inert as every other refusal reason in this gate.
  const originLanding = checkOriginLanding(landedCommit, deps);
  if ('refusal' in originLanding) {
    return originLanding.refusal;
  }

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
  if (duplicationCheck.checked) {
    receipt.crossFileDuplicationFilesScanned = duplicationCheck.filesScanned;
  }
  if (scopedCrapEvidence) {
    receipt.scopedCrap = scopedCrapEvidence;
  }
  if (mkdtempCheck.checked) {
    receipt.mkdtempConvention = { testFilesScanned: mkdtempCheck.testFilesScanned };
  }
  if (shellDriveCheck.checked) {
    receipt.shellEntryPointDrive = {
      shellTestsScanned: shellDriveCheck.shellTestsScanned,
      entryPointsNamed: shellDriveCheck.entryPointsNamed,
    };
  }
  if (orphanDocsCheck.checked && orphanDocsCheck.docsTouched) {
    receipt.orphanedDocsCheck = { docsTouched: true };
  }
  if (unreachableCheck.checked) {
    receipt.unreachableStepHandlers = {
      stepFilesScanned: unreachableCheck.stepFilesScanned,
      patternsChecked: unreachableCheck.patternsChecked,
    };
  }
  if (multiBranchCheck.checked) {
    receipt.multiBranchParserCoverage = { parsersScanned: multiBranchCheck.parsersScanned };
  }
  if (perHatCheck.checked) {
    receipt.perHatRolePromptEvidence = { verdictsScanned: perHatCheck.verdictsScanned };
  }
  if (multiWorktreeFixture) {
    receipt.multiWorktreeFixture = multiWorktreeFixture;
  }
  if (producerCrosscheck) {
    receipt.producerCrosscheck = producerCrosscheck;
  }
  deps.writeReceipt(ticketId, receipt);

  const warnings: string[] = [];
  if (!claimsCheck.checked) {
    warnings.push("commit claims were not checked: the run's own commit history could not be resolved");
  }
  if (!duplicationCheck.checked) {
    warnings.push(
      'cross-file duplication was not checked: the run\'s touched-file history could not be resolved'
    );
  }
  if (!crapCheck.checked && extensionSrcPathsInScope(crapCheck).length === 0) {
    warnings.push(
      'scoped CRAP was not checked: the run\'s touched-file history or coverage report could not be resolved'
    );
  }
  if (!mkdtempCheck.checked) {
    warnings.push(
      'mkdtemp convention was not checked: the run\'s touched-file history could not be resolved'
    );
  }
  if (!reachCheck.checked) {
    warnings.push(
      'property generator reach was not checked: the run\'s touched-file history could not be resolved'
    );
  }
  if (!shellDriveCheck.checked) {
    warnings.push(
      'shell entry-point drive was not checked: the ticket yaml or touched-file history could not be resolved'
    );
  }
  if (!orphanDocsCheck.checked) {
    warnings.push(
      'orphaned authored docs were not checked: the touched-file history could not be resolved'
    );
  }
  if (!unreachableCheck.checked) {
    warnings.push(
      'unreachable step handlers were not checked: the feature IR or touched-file history could not be resolved'
    );
  }
  if (!multiBranchCheck.checked) {
    warnings.push(
      'multi-branch parser coverage was not checked: the touched-file history could not be resolved'
    );
  }
  if (!perHatCheck.checked) {
    warnings.push(
      'per-hat role prompt evidence was not checked: the expedite verdict tree could not be resolved'
    );
  }
  const outcome: PilotLandSuccess = { landed: true, destination: move.destination, receipt };
  if (warnings.length > 0) {
    outcome.warnings = warnings;
  }
  return outcome;
}

export async function landPilotedTicket(ticketId: string, deps: PilotAcceptanceGateDeps): Promise<PilotLandOutcome> {
  const contract = resolveContract(ticketId, deps);
  if ('refusal' in contract) {
    return contract.refusal;
  }

  const fixtureGate = requireMultiworktreeFixture(ticketId, deps);
  if ('refusal' in fixtureGate) {
    return fixtureGate.refusal;
  }

  const relandNotes = requireRelandNotes(ticketId, deps);
  if ('refusal' in relandNotes) {
    return relandNotes.refusal;
  }

  const contractRun = await runContract(ticketId, contract.featureFilePath, deps);
  if ('refusal' in contractRun) {
    return contractRun.refusal;
  }

  const executed = requireAcceptanceExecuted(ticketId, contract.featureFilePath, deps);
  if ('refusal' in executed) {
    return executed.refusal;
  }

  const requiredWiring = deps.readRequiredWiring?.(ticketId);
  const producerGate = requireProducerCrosscheck(
    ticketId,
    contract.declaration,
    requiredWiring,
    contractRun.runResult
  );
  if ('refusal' in producerGate) {
    return producerGate.refusal;
  }

  const claims = checkClaims(deps);
  if ('refusal' in claims) {
    return claims.refusal;
  }

  const duplication = checkDuplication(deps);
  if ('refusal' in duplication) {
    return duplication.refusal;
  }

  const crap = checkCrap(deps);
  if ('refusal' in crap) {
    return crap.refusal;
  }

  const crapEvidence = requireScopedCrapReceiptEvidence(ticketId, crap.crapCheck);
  if ('refusal' in crapEvidence) {
    return crapEvidence.refusal;
  }

  const mkdtemp = checkMkdtemp(deps);
  if ('refusal' in mkdtemp) {
    return mkdtemp.refusal;
  }

  const propertyReach = checkPropertyGeneratorReach(deps);
  if ('refusal' in propertyReach) {
    return propertyReach.refusal;
  }

  const shellDrive = checkShellDrive(ticketId, deps);
  if ('refusal' in shellDrive) {
    return shellDrive.refusal;
  }

  const orphanDocs = checkOrphanAuthoredDocs(deps);
  if ('refusal' in orphanDocs) {
    return orphanDocs.refusal;
  }

  const unreachable = checkUnreachableHandlers(ticketId, deps);
  if ('refusal' in unreachable) {
    return unreachable.refusal;
  }

  const multiBranch = checkMultiBranchCoverage(ticketId, deps);
  if ('refusal' in multiBranch) {
    return multiBranch.refusal;
  }

  const perHat = checkPerHatPromptEvidence(ticketId, deps);
  if ('refusal' in perHat) {
    return perHat.refusal;
  }

  const fixtureMetadata =
    deps.isLifecycleTeardownTicket(ticketId) && fixtureGate.fixture.satisfied
      ? contractRun.runResult.multiWorktreeFixture ?? fixtureGate.fixture.metadata
      : undefined;

  return moveAndRecordReceipt(
    ticketId,
    contract.declaration,
    deps,
    claims.claimsCheck,
    duplication.duplicationCheck,
    crap.crapCheck,
    crapEvidence.evidence,
    mkdtemp.mkdtempCheck,
    propertyReach.reachCheck,
    shellDrive.shellDriveCheck,
    orphanDocs.orphanDocsCheck,
    unreachable.unreachableCheck,
    multiBranch.multiBranchCheck,
    perHat.perHatCheck,
    fixtureMetadata,
    producerGate.crosscheck
  );
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
