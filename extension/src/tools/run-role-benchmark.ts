#!/usr/bin/env node
/**
 * BL-340 slice 1: real, end-to-end entry point for the coder-role
 * benchmark harness. Wires the real Claude CLI executor and a real
 * node:test quality evaluator (extension/src/benchmark/*) to the pinned
 * task fixture, runs every configured model, ranks the result, and writes
 * + commits the report as a git artifact (docs/benchmarks/<date>.json) via
 * the same atomicWrite + commitScopedFile sidecar pattern
 * notify/costHealthSidecar.ts already established.
 *
 * Usage: node run-role-benchmark.js <fixture-dir> <models-file>
 *          <repetitions> <quality-threshold> <target-repo-path>
 *
 * <models-file> is a JSON array of BenchmarkModelConfig
 * ({id, provider, model, label?}).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createClaudeCliExecutor } from '../benchmark/claudeCliExecutor';
import { createNodeTestQualityEvaluator } from '../benchmark/nodeTestQualityEvaluator';
import { loadTaskSpec } from '../benchmark/taskFixture';
import { runBenchmark } from '../benchmark/runBenchmark';
import { writeBenchmarkReport, commitBenchmarkReport } from '../benchmark/reportArtifact';
import { BenchmarkModelConfig, BenchmarkReport, ModelExecutor, QualityEvaluator, TaskSpec } from '../benchmark/types';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

export interface RunRoleBenchmarkArgs {
  fixtureDir: string;
  modelsFile: string;
  repetitions: number;
  qualityThreshold: number;
  targetPath: string;
}

const USAGE = 'Usage: run-role-benchmark.js <fixture-dir> <models-file> <repetitions> <quality-threshold> <target-repo-path>\n';

function hasAllRequiredArgs(fixtureDir: string, modelsFile: string, repetitionsRaw: string, qualityThresholdRaw: string, targetPath: string): boolean {
  return Boolean(fixtureDir && modelsFile && repetitionsRaw && qualityThresholdRaw && targetPath);
}

function parseValidatedNumbers(repetitionsRaw: string, qualityThresholdRaw: string): { repetitions: number; qualityThreshold: number } | null {
  const repetitions = Number(repetitionsRaw);
  const qualityThreshold = Number(qualityThresholdRaw);
  if (!Number.isFinite(repetitions) || repetitions < 1 || !Number.isFinite(qualityThreshold)) {
    return null;
  }
  return { repetitions, qualityThreshold };
}

// Pure - same "CLI main() stays a thin dispatcher over a testable pure
// helper" split every other tools/ CLI in this codebase follows.
export function parseArgs(argv: string[]): RunRoleBenchmarkArgs | null {
  const [fixtureDir, modelsFile, repetitionsRaw, qualityThresholdRaw, targetPath] = argv;
  if (!hasAllRequiredArgs(fixtureDir, modelsFile, repetitionsRaw, qualityThresholdRaw, targetPath)) {
    return null;
  }
  const numbers = parseValidatedNumbers(repetitionsRaw, qualityThresholdRaw);
  if (!numbers) {
    return null;
  }
  return { fixtureDir, modelsFile, ...numbers, targetPath };
}

// Pure - the same "extract even a one-line derivation into a named,
// tested export" CLI main()-thin-wrapper rule this codebase's other
// tools/ CLIs follow (an inline one-liner inside main() is coverage-
// invisible there, however small - BL-256's own CRAP-gap lesson).
export function reportDateKey(report: Pick<BenchmarkReport, 'generatedAtIso'>): string {
  return report.generatedAtIso.slice(0, 10);
}

// Injectable seam for main()'s own orchestration - the only piece of this
// CLI that was genuinely untestable in-process before this fix, since its
// real deps (executor, evaluator) spawn a REAL `claude` CLI subprocess per
// trial and commitReport makes a REAL git commit. A unit test supplies
// fakes for exactly these, exercising the SAME sequencing main() runs
// (load task -> parse models -> run the benchmark -> write + commit +
// print the report) without ever touching a real subprocess or git -
// same "keep main() a thin dispatcher, push logic into a testable
// exported function" split recruiter-run.ts/bakeoff-run.ts already
// established.
export interface RunRoleBenchmarkDeps {
  loadTask: (fixtureDir: string) => TaskSpec;
  readModels: (modelsFile: string) => BenchmarkModelConfig[];
  mkScratchRoot: () => string;
  nowIso: () => string;
  executor: ModelExecutor;
  evaluator: QualityEvaluator;
  writeReport: typeof writeBenchmarkReport;
  commitReport: typeof commitBenchmarkReport;
  print: (data: unknown) => void;
}

export async function runRoleBenchmarkCli(args: RunRoleBenchmarkArgs, deps: RunRoleBenchmarkDeps): Promise<void> {
  const task = deps.loadTask(args.fixtureDir);
  const models = deps.readModels(args.modelsFile);
  const scratchRoot = deps.mkScratchRoot();

  const report = await runBenchmark({
    task,
    models,
    repetitions: args.repetitions,
    qualityThreshold: args.qualityThreshold,
    generatedAtIso: deps.nowIso(),
    deps: {
      executor: deps.executor,
      evaluator: deps.evaluator,
      scratchRoot,
    },
  });

  const dateIso = reportDateKey(report);
  const filePath = deps.writeReport(args.targetPath, report, dateIso);
  deps.commitReport(args.targetPath, filePath, report.taskId, dateIso);
  deps.print(report);
}

function defaultDeps(): RunRoleBenchmarkDeps {
  return {
    loadTask: loadTaskSpec,
    readModels: (modelsFile) => JSON.parse(fs.readFileSync(modelsFile, 'utf8')) as BenchmarkModelConfig[],
    mkScratchRoot: () => fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-benchmark-')),
    nowIso: () => new Date().toISOString(),
    executor: createClaudeCliExecutor(),
    evaluator: createNodeTestQualityEvaluator(),
    writeReport: writeBenchmarkReport,
    commitReport: commitBenchmarkReport,
    print: printJsonToStdout,
  };
}

export const main = makeArgsGuardedMain(parseArgs, USAGE, (args) => runRoleBenchmarkCli(args, defaultDeps()));

if (require.main === module) {
  runCliMain(main);
}
