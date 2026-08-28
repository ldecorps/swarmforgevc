#!/usr/bin/env node
/**
 * BL-727: the pilot's ONLY landing path for a ticket. Resolves the ticket's
 * declared `acceptance:` to a feature file, executes it through the
 * project's existing acceptance pipeline (specs/pipeline/runnerAdapter.js -
 * never a second Gherkin/step-matching implementation, BL-727 invariant 2),
 * and moves the yaml to backlog/done/ with a receipt only when it is green.
 * Refuses - and writes nothing - on an unmatched step, a failing scenario,
 * or an absent / inline-only / missing-file acceptance declaration.
 *
 * Usage: node pilot-acceptance-gate.js <TICKET-ID>
 * Exit code: 0 when landed, 1 when refused (the refusal is still printed as
 * JSON on stdout, never only a stack trace).
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  landPilotedTicket,
  resolveFeatureFilePath,
  PilotAcceptanceGateDeps,
  PilotLandOutcome,
  AcceptanceRunResult,
  AcceptanceReceipt,
  OriginMainLandingCheckOutcome,
} from './pilotAcceptanceGate';
import {
  parseProducerCrosscheckFromEnv,
  PRODUCER_CROSSCHECK_ENV,
} from './producerCrosscheckAcceptance';
import {
  assessMultiworktreeFixture,
  extractHandoffdRootsFromPs,
  isLifecycleTeardownTicket,
} from './multiworktreeAcceptanceFixture';
import { resolveRunCommits, checkCommitClaims, checkCrossFileDuplication, checkScopedCrap, checkMkdtempConvention, checkPropertyGeneratorReach, checkShellEntryPointDrive, checkOrphanedAuthoredDocs, checkUnreachableStepHandlers, checkMultiBranchParserCoverage, checkPerHatRolePromptEvidence, RunCommit } from './commitClaimGitReader';
import { findBacklogFilePath, markDone, BacklogMoveResult } from '../panel/backlogWriter';
import { parseBacklogYaml } from '../panel/backlogReader';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

export { resolveRunCommits, checkCommitClaims, checkCrossFileDuplication, checkScopedCrap, checkMkdtempConvention, checkPropertyGeneratorReach, checkShellEntryPointDrive, checkOrphanedAuthoredDocs, checkUnreachableStepHandlers, checkMultiBranchParserCoverage, checkPerHatRolePromptEvidence, RunCommit };

// Exported (like this codebase's other tools/ CLIs) so it runs in-process
// under coverage instead of only via the compiled CLI's subprocess.
export function parseArgs(argv: string[]): { ticketId: string } | null {
  const [ticketId] = argv;
  return ticketId ? { ticketId } : null;
}

// No .swarmforge/roles.tsv dependency (unlike swarm-metrics.ts) - a pilot
// worktree (.worktrees/expedite-<ticket>) is not guaranteed to carry one,
// and this gate has to run there.
export function resolveRepoRoot(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
}

export function readAcceptanceDeclaration(repoRoot: string, ticketId: string): string | undefined {
  const filePath = findBacklogFilePath(repoRoot, ticketId);
  if (!filePath) {
    return undefined;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const item = parseBacklogYaml(content);
  return item?.acceptance;
}

export function readTicketNotes(repoRoot: string, ticketId: string): string | undefined {
  const filePath = findBacklogFilePath(repoRoot, ticketId);
  if (!filePath) {
    return undefined;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const item = parseBacklogYaml(content);
  return item?.notes;
}

export function acceptanceReceiptExists(repoRoot: string, ticketId: string): boolean {
  const receiptPath = path.join(repoRoot, '.swarmforge', 'expedite', ticketId, 'acceptance-receipt.json');
  try {
    return fs.statSync(receiptPath).isFile();
  } catch {
    return false;
  }
}

function readRequiredWiring(repoRoot: string, ticketId: string): string[] | undefined {
  const filePath = findBacklogFilePath(repoRoot, ticketId);
  if (!filePath) {
    return undefined;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const blockMatch = content.match(/^required_wiring:\s*\n((?:[ \t]+-[^\n]*\n?)*)/m);
  if (!blockMatch) {
    return undefined;
  }
  const entries = blockMatch[1]
    .split('\n')
    .map((line) => line.replace(/^\s*-\s*/, '').replace(/#.*$/, '').trim())
    .filter((line) => line.length > 0);
  return entries.length > 0 ? entries : undefined;
}

export function listLinkedWorktreePaths(repoRoot: string): string[] {
  const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  return out
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim());
}

export function probeHandoffdRootsFromPs(): string[] {
  const out = execFileSync('ps', ['-eo', 'args='], { encoding: 'utf8' });
  return extractHandoffdRootsFromPs(out);
}

// async so a synchronous require() failure (missing/uncompiled
// runnerAdapter.js) surfaces as a rejected promise like every other outcome
// here, rather than a synchronous throw callers awaiting this would miss.
export async function runAcceptance(
  repoRoot: string,
  featureFilePath: string,
  fixtureAssessment?: ReturnType<typeof assessMultiworktreeFixture>
): Promise<AcceptanceRunResult> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { runPipeline } = require(path.join(repoRoot, 'specs', 'pipeline', 'runnerAdapter.js'));
  const outDir = path.join(repoRoot, 'specs', 'pipeline', 'generated');
  const stepsModulePath = path.join(repoRoot, 'specs', 'pipeline', 'steps', 'index.js');
  const prevFixture = process.env.SWARMFORGE_MULTIWORKTREE_FIXTURE;
  const prevCrosscheck = process.env[PRODUCER_CROSSCHECK_ENV];
  delete process.env[PRODUCER_CROSSCHECK_ENV];
  if (fixtureAssessment?.satisfied) {
    process.env.SWARMFORGE_MULTIWORKTREE_FIXTURE = JSON.stringify(fixtureAssessment.metadata);
  } else {
    delete process.env.SWARMFORGE_MULTIWORKTREE_FIXTURE;
  }
  try {
    const pipelineResult = await runPipeline(featureFilePath, outDir, stepsModulePath);
    const result: AcceptanceRunResult = { ...pipelineResult };
    if (fixtureAssessment?.satisfied) {
      result.multiWorktreeFixture = fixtureAssessment.metadata;
    }
    const crosscheck = parseProducerCrosscheckFromEnv(process.env[PRODUCER_CROSSCHECK_ENV]);
    if (crosscheck) {
      result.producerCrosscheck = crosscheck;
    }
    return result;
  } finally {
    if (prevCrosscheck === undefined) {
      delete process.env[PRODUCER_CROSSCHECK_ENV];
    } else {
      process.env[PRODUCER_CROSSCHECK_ENV] = prevCrosscheck;
    }
    if (prevFixture === undefined) {
      delete process.env.SWARMFORGE_MULTIWORKTREE_FIXTURE;
    } else {
      process.env.SWARMFORGE_MULTIWORKTREE_FIXTURE = prevFixture;
    }
  }
}

export function moveTicketToDone(repoRoot: string, ticketId: string): BacklogMoveResult {
  return markDone(repoRoot, ticketId);
}

export function writeReceipt(repoRoot: string, ticketId: string, receipt: AcceptanceReceipt): void {
  const dir = path.join(repoRoot, '.swarmforge', 'expedite', ticketId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'acceptance-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', 'utf8');
}

export function getLandedCommit(repoRoot: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
}

// BL-1215: fetches origin/main fresh (a stale local remote-tracking ref
// would otherwise report a genuinely-landed commit as missing) then checks
// ancestry. Both the fetch and the ancestry check fail CLOSED - any git
// failure here (no remote configured, network down, an unresolvable
// commit) is `reachable: false`, never treated as "nothing to check
// against" the way the fails-open checks elsewhere in this file do.
export function checkOriginMainLanding(repoRoot: string, commit: string): OriginMainLandingCheckOutcome {
  try {
    execFileSync('git', ['fetch', 'origin', 'main'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return { reachable: false, reason: `origin/main could not be fetched: ${(err as Error).message}` };
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'origin/main'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { reachable: true };
  } catch {
    return { reachable: false, reason: `${commit} is not an ancestor of origin/main` };
  }
}

export function buildDeps(repoRoot: string): PilotAcceptanceGateDeps {
  let cachedFixture = assessMultiworktreeFixture(repoRoot, listLinkedWorktreePaths(repoRoot), probeHandoffdRootsFromPs());
  let executedFeaturePath: string | undefined;
  return {
    readAcceptanceDeclaration: (ticketId) => readAcceptanceDeclaration(repoRoot, ticketId),
    readRequiredWiring: (ticketId) => readRequiredWiring(repoRoot, ticketId),
    readTicketNotes: (ticketId) => readTicketNotes(repoRoot, ticketId),
    acceptanceReceiptExists: (ticketId) => acceptanceReceiptExists(repoRoot, ticketId),
    resolveFeatureFilePath: (declaration) => resolveFeatureFilePath(repoRoot, declaration),
    isLifecycleTeardownTicket: (ticketId) =>
      isLifecycleTeardownTicket(readAcceptanceDeclaration(repoRoot, ticketId), readRequiredWiring(repoRoot, ticketId)),
    assessMultiworktreeFixture: () => cachedFixture,
    runAcceptance: (featureFilePath) => runAcceptance(repoRoot, featureFilePath, cachedFixture),
    recordAcceptanceExecution: (featureFilePath) => {
      executedFeaturePath = featureFilePath;
    },
    readAcceptanceExecution: () => executedFeaturePath,
    checkCommitClaims: () => checkCommitClaims(repoRoot),
    checkCrossFileDuplication: () => checkCrossFileDuplication(repoRoot),
    checkScopedCrap: () => checkScopedCrap(repoRoot),
    checkMkdtempConvention: () => checkMkdtempConvention(repoRoot),
    checkPropertyGeneratorReach: () => checkPropertyGeneratorReach(repoRoot),
    checkShellEntryPointDrive: (ticketId) => checkShellEntryPointDrive(repoRoot, ticketId),
    checkOrphanedAuthoredDocs: () => checkOrphanedAuthoredDocs(repoRoot),
    checkUnreachableStepHandlers: (ticketId) => checkUnreachableStepHandlers(repoRoot, ticketId),
    checkMultiBranchParserCoverage: (ticketId) => checkMultiBranchParserCoverage(repoRoot, ticketId),
    checkPerHatRolePromptEvidence: (ticketId) => checkPerHatRolePromptEvidence(repoRoot, ticketId),
    moveTicketToDone: (ticketId) => moveTicketToDone(repoRoot, ticketId),
    writeReceipt: (ticketId, receipt) => writeReceipt(repoRoot, ticketId, receipt),
    getLandedCommit: () => getLandedCommit(repoRoot),
    checkOriginMainLanding: (commit) => checkOriginMainLanding(repoRoot, commit),
    now: () => new Date().toISOString(),
  };
}

export function runGate(ticketId: string, repoRoot: string): Promise<PilotLandOutcome> {
  return landPilotedTicket(ticketId, buildDeps(repoRoot));
}

export const main = makeArgsGuardedMain(
  parseArgs,
  'Usage: node pilot-acceptance-gate.js <TICKET-ID>\n',
  async ({ ticketId }) => {
    const repoRoot = resolveRepoRoot(process.cwd());
    const outcome = await runGate(ticketId, repoRoot);
    printJsonToStdout(outcome);
    if (!outcome.landed) {
      process.exitCode = 1;
    }
  }
);

if (require.main === module) {
  runCliMain(main);
}
