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
} from './pilotAcceptanceGate';
import { findBacklogFilePath, markDone, BacklogMoveResult } from '../panel/backlogWriter';
import { parseBacklogYaml } from '../panel/backlogReader';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

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

export function buildDeps(repoRoot: string): PilotAcceptanceGateDeps {
  return {
    readAcceptanceDeclaration: (ticketId) => readAcceptanceDeclaration(repoRoot, ticketId),
    resolveFeatureFilePath: (declaration) => resolveFeatureFilePath(repoRoot, declaration),
    runAcceptance: (featureFilePath) => runAcceptance(repoRoot, featureFilePath),
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
