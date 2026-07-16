#!/usr/bin/env node
/**
 * BL-432 (epic BL-429 slice 3 - ACT, the mandatory wiring slice): turns
 * BL-431's rework diagnosis into a persisted throttle recommendation the
 * coordinator's promotion path can apply as an EFFECTIVE cap = min(configured,
 * recommended) - closing the observe (BL-430) -> diagnose (BL-431) -> act loop
 * Article 3.5 already sanctions but nothing previously automated.
 *
 * Shelled out to from swarmforge/scripts/effective_backlog_depth_cli.bb at
 * EVERY promotion decision (Babashka has no way to import compiled TS) - the
 * same shell-to-node-and-degrade-on-failure pattern handoffd.bb already uses
 * for its other emit-*.js CLIs. Computed FRESH on every call rather than on a
 * periodic sweep: a promotion decision needs the current diagnosis, not one
 * that might be stale between coordinator wake-ups.
 *
 * needs_human-style safety contract (BL-429): only a 'lower the intake
 * throttle' verdict (no concentrated, attributable cause - the epic's ONE
 * sanctioned auto-tunable knob) ever produces a non-null recommendation;
 * every escalate-only verdict recommends nothing here, exactly like no
 * verdict at all.
 *
 * Usage: node emit-throttle-recommendation.js <target-repo-path>
 */
import * as fs from 'fs';
import * as path from 'path';
import { readReworkSignal } from '../metrics/reworkObservatoryStore';
import { diagnoseReworkSignal, classifyThrottleSeverity, recommendedCapForSeverity, ThrottleSeverity } from '../metrics/reworkDiagnosis';
import { atomicWrite, atomicAppend } from '../util/atomicWrite';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

export interface EmitThrottleRecommendationArgs {
  targetRepoPath: string;
}

export function parseArgs(argv: string[]): EmitThrottleRecommendationArgs | null {
  const [targetRepoPath] = argv;
  return targetRepoPath ? { targetRepoPath } : null;
}

function coordinatorStateDir(targetRepoPath: string): string {
  return path.join(targetRepoPath, '.swarmforge', 'coordinator');
}

export function throttleRecommendationPath(targetRepoPath: string): string {
  return path.join(coordinatorStateDir(targetRepoPath), 'throttle-recommendation.json');
}

export function throttleChangeLogPath(targetRepoPath: string): string {
  return path.join(coordinatorStateDir(targetRepoPath), 'throttle-changes.jsonl');
}

export interface ThrottleRecommendation {
  recommendedCap: number | null;
  severity: ThrottleSeverity | null;
  reworkRate: number | null;
  baselineRate: number | null;
  updated_at: string;
}

// Pure given the signal - the SAME diagnose -> classify -> map pipeline
// reworkDiagnosis.ts's own exports already establish, composed here once
// rather than re-derived at each call site (this CLI's main() and its own
// tests both need the identical composition).
export function computeThrottleRecommendation(targetRepoPath: string, nowMs: number = Date.now()): ThrottleRecommendation {
  const signal = readReworkSignal(targetRepoPath);
  const verdict = signal ? diagnoseReworkSignal(signal) : null;
  const severity = classifyThrottleSeverity(verdict);
  return {
    recommendedCap: recommendedCapForSeverity(severity),
    severity,
    reworkRate: verdict?.reworkRate ?? null,
    baselineRate: verdict?.baselineRate ?? null,
    updated_at: new Date(nowMs).toISOString(),
  };
}

function readPriorRecommendation(targetRepoPath: string): ThrottleRecommendation | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(throttleRecommendationPath(targetRepoPath), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export interface ThrottleChangeLogEntry {
  ts: string;
  from: number | null;
  to: number | null;
  reason: string;
}

function describeChangeReason(rec: ThrottleRecommendation): string {
  if (rec.severity === 'severe') {
    return `severe rework diagnosis (rate ${rec.reworkRate} vs baseline ${rec.baselineRate}) - freezing intake`;
  }
  if (rec.severity === 'degraded') {
    return `degraded rework diagnosis (rate ${rec.reworkRate} vs baseline ${rec.baselineRate}) - stabilizing to one`;
  }
  return 'rework diagnosis cleared - restoring the configured cap';
}

// Acceptance scenario 05: every CHANGE to the recommended cap is logged - a
// call whose recommendation is unchanged from the last persisted one (the
// common case: most ticks are steady-state) writes no log line at all, only
// the recommendation file itself (idempotent refresh, never spam). The FIRST
// ever call (no persisted file yet) compares against null, matching "no
// recommendation" - so a swarm that has never thrown a diagnosis logs
// nothing on its very first tick either.
export function emitThrottleRecommendation(targetRepoPath: string, nowMs: number = Date.now()): ThrottleRecommendation {
  const recommendation = computeThrottleRecommendation(targetRepoPath, nowMs);
  const priorCap = readPriorRecommendation(targetRepoPath)?.recommendedCap ?? null;
  if (priorCap !== recommendation.recommendedCap) {
    const entry: ThrottleChangeLogEntry = {
      ts: recommendation.updated_at,
      from: priorCap,
      to: recommendation.recommendedCap,
      reason: describeChangeReason(recommendation),
    };
    atomicAppend(throttleChangeLogPath(targetRepoPath), JSON.stringify(entry) + '\n');
  }
  atomicWrite(throttleRecommendationPath(targetRepoPath), JSON.stringify(recommendation));
  return recommendation;
}

export const main = makeArgsGuardedMain(
  parseArgs,
  'Usage: node emit-throttle-recommendation.js <target-repo-path>\n',
  async (args) => {
    printJsonToStdout(emitThrottleRecommendation(args.targetRepoPath));
  }
);

if (require.main === module) {
  runCliMain(main);
}
