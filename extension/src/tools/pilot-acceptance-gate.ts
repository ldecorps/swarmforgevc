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
  CommitClaimsCheckOutcome,
} from './pilotAcceptanceGate';
import { evaluateCommitClaims } from './commitClaimCheck';
import { findBacklogFilePath, markDone, BacklogMoveResult } from '../panel/backlogWriter';
import { parseBacklogYaml } from '../panel/backlogReader';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

// The run's own commits are judged against `main`, never HEAD alone (BL-729
// invariant 1 - a commit's verdict must not depend on what a sibling branch
// contains) and never a hardcoded default-branch guess.
const CLAIM_CHECK_BASE_BRANCH = 'main';

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
  const item = parseBacklogYaml(fs.readFileSync(filePath, 'utf8'));
  return item?.acceptance;
}

// async so a synchronous require() failure (missing/uncompiled
// runnerAdapter.js) surfaces as a rejected promise like every other outcome
// here, rather than a synchronous throw callers awaiting this would miss.
export async function runAcceptance(repoRoot: string, featureFilePath: string): Promise<AcceptanceRunResult> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { runPipeline } = require(path.join(repoRoot, 'specs', 'pipeline', 'runnerAdapter.js'));
  const outDir = path.join(repoRoot, 'specs', 'pipeline', 'generated');
  const stepsModulePath = path.join(repoRoot, 'specs', 'pipeline', 'steps', 'index.js');
  return runPipeline(featureFilePath, outDir, stepsModulePath);
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

export interface RunCommit {
  sha: string;
  message: string;
  patchText: string;
}

// stdin/stderr are ignored (stdout still 'pipe', so encoding:'utf8' keeps
// returning a string): every call site below is inside resolveRunCommits'
// own try/catch, an EXPECTED fails-open path (BL-729), not a crash - git's
// own "fatal: ..." text on stderr would otherwise leak straight to the
// terminal a human is watching, for a condition the gate already handles.
const GIT_CLAIM_CHECK_STDIO: ['ignore', 'pipe', 'ignore'] = ['ignore', 'pipe', 'ignore'];

// One commit's full judgeable patch text: the unified diff (added, removed
// and context lines) plus the changed-path list, concatenated - BL-729's
// "own patch text" is these two views combined, not either alone (a rename
// can leave a path visible only in the name-only list, not the hunk body).
function readCommitPatch(repoRoot: string, sha: string): string {
  const diff = execFileSync('git', ['show', '--format=', sha], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: GIT_CLAIM_CHECK_STDIO,
  });
  const changedPaths = execFileSync(
    'git',
    ['diff-tree', '--no-commit-id', '--name-only', '-r', sha],
    { cwd: repoRoot, encoding: 'utf8', stdio: GIT_CLAIM_CHECK_STDIO }
  );
  return `${diff}\n${changedPaths}`;
}

// The run's own non-merge commits, oldest first (so a refusal names the
// first offending commit, not the tip - BL-729 scenario 02): everything
// reachable from HEAD but not from CLAIM_CHECK_BASE_BRANCH. Returns
// undefined - never throws - when the range or a commit's patch cannot be
// resolved, which is the gate's fails-OPEN signal, not a CLI crash.
export function resolveRunCommits(repoRoot: string): RunCommit[] | undefined {
  try {
    const mergeBase = execFileSync(
      'git',
      ['merge-base', CLAIM_CHECK_BASE_BRANCH, 'HEAD'],
      { cwd: repoRoot, encoding: 'utf8', stdio: GIT_CLAIM_CHECK_STDIO }
    ).trim();
    const revListOutput = execFileSync(
      'git',
      ['rev-list', '--no-merges', '--reverse', `${mergeBase}..HEAD`],
      { cwd: repoRoot, encoding: 'utf8', stdio: GIT_CLAIM_CHECK_STDIO }
    );
    const shas = revListOutput
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return shas.map((sha) => ({
      sha,
      message: execFileSync('git', ['log', '-1', '--format=%B', sha], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: GIT_CLAIM_CHECK_STDIO,
      }),
      patchText: readCommitPatch(repoRoot, sha),
    }));
  } catch {
    return undefined;
  }
}

// The real git-backed implementation wired into PilotAcceptanceGateDeps.checkCommitClaims
// (required_wiring) - resolves the run's own commits, then delegates the
// per-commit judging entirely to the pure evaluateCommitClaims (commitClaimCheck.ts),
// never reimplementing that loop here.
export function checkCommitClaims(repoRoot: string): CommitClaimsCheckOutcome {
  const commits = resolveRunCommits(repoRoot);
  if (!commits) {
    return { checked: false };
  }
  return { checked: true, ...evaluateCommitClaims(commits) };
}

export function buildDeps(repoRoot: string): PilotAcceptanceGateDeps {
  return {
    readAcceptanceDeclaration: (ticketId) => readAcceptanceDeclaration(repoRoot, ticketId),
    resolveFeatureFilePath: (declaration) => resolveFeatureFilePath(repoRoot, declaration),
    runAcceptance: (featureFilePath) => runAcceptance(repoRoot, featureFilePath),
    checkCommitClaims: () => checkCommitClaims(repoRoot),
    moveTicketToDone: (ticketId) => moveTicketToDone(repoRoot, ticketId),
    writeReceipt: (ticketId, receipt) => writeReceipt(repoRoot, ticketId, receipt),
    getLandedCommit: () => getLandedCommit(repoRoot),
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
