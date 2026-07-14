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
import { BenchmarkModelConfig } from '../benchmark/types';
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

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const task = loadTaskSpec(args.fixtureDir);
  const models = JSON.parse(fs.readFileSync(args.modelsFile, 'utf8')) as BenchmarkModelConfig[];
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-benchmark-'));

  const report = await runBenchmark({
    task,
    models,
    repetitions: args.repetitions,
    qualityThreshold: args.qualityThreshold,
    generatedAtIso: new Date().toISOString(),
    deps: {
      executor: createClaudeCliExecutor(),
      evaluator: createNodeTestQualityEvaluator(),
      scratchRoot,
    },
  });

  const dateIso = report.generatedAtIso.slice(0, 10);
  const filePath = writeBenchmarkReport(args.targetPath, report, dateIso);
  commitBenchmarkReport(args.targetPath, filePath, report.taskId, dateIso);
  printJsonToStdout(report);
});

if (require.main === module) {
  runCliMain(main);
}
