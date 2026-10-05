#!/usr/bin/env node
/**
 * BL-1981: records a human's answer onto the currently open throttle-hold
 * episode (Article 3.5's 2026-10-05 amendment - a cleared signal holds
 * the cap until a human releases it). A release restores the configured
 * cap once the live signal itself clears; a keep holds the cap at the
 * value given, bounded by the same never-raise min as any other
 * recommendation. Refuses (exit non-zero) when no episode is open - there
 * is nothing for this answer to apply to.
 *
 * Usage: node release-intake-throttle.js <project-root> --by <who>
 *        (--release | --keep <N>) [--reason <text>]
 */
import * as fs from 'fs';
import {
  throttleRecommendationPath,
  throttleChangeLogPath,
  heldCapForEpisode,
  ThrottleRecommendation,
  ThrottleChangeLogEntry,
} from './emit-throttle-recommendation';
import { atomicWrite, atomicAppend } from '../util/atomicWrite';
import { makeArgsGuardedMain, printJsonToStdout, runCliMain } from './swarm-metrics';

export type ReleaseIntakeThrottleAnswer = { kind: 'release' } | { kind: 'keep'; value: number };

export interface ReleaseIntakeThrottleArgs {
  targetRepoPath: string;
  by: string;
  answer: ReleaseIntakeThrottleAnswer;
  reason?: string;
}

// Exported (same "CLI main() run only via execFileSync is coverage-
// invisible" lesson this codebase's other CLIs already established) so
// the branch logic is exercised in-process, not only through the compiled
// CLI's own subprocess test.
export function parseArgs(argv: string[]): ReleaseIntakeThrottleArgs | null {
  const [targetRepoPath, ...rest] = argv;
  if (!targetRepoPath) {
    return null;
  }
  let by: string | undefined;
  let release = false;
  let keepValue: number | undefined;
  let reason: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--by') {
      by = rest[i + 1];
      i += 1;
    } else if (token === '--release') {
      release = true;
    } else if (token === '--keep') {
      keepValue = Number(rest[i + 1]);
      i += 1;
    } else if (token === '--reason') {
      reason = rest[i + 1];
      i += 1;
    }
  }
  if (!by) {
    return null;
  }
  if (release && keepValue !== undefined) {
    return null; // mutually exclusive
  }
  if (release) {
    return { targetRepoPath, by, answer: { kind: 'release' }, reason };
  }
  if (keepValue !== undefined && Number.isFinite(keepValue)) {
    return { targetRepoPath, by, answer: { kind: 'keep', value: keepValue }, reason };
  }
  return null;
}

function readRecommendation(targetRepoPath: string): ThrottleRecommendation | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(throttleRecommendationPath(targetRepoPath), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// Records args.answer onto the currently open episode, durably. Throws
// (never a silent no-op) when no episode is open - requirement 5's own
// "refuses with a message saying so and exits non-zero", surfaced by
// runCliMain's own fatal-error reporting in main() below.
export function recordThrottleRelease(args: ReleaseIntakeThrottleArgs, nowMs: number = Date.now()): ThrottleRecommendation {
  const rec = readRecommendation(args.targetRepoPath);
  if (!rec || !rec.episode) {
    throw new Error('no open throttle episode to answer - nothing to release or keep');
  }
  const atIso = new Date(nowMs).toISOString();
  const answer =
    args.answer.kind === 'release'
      ? { kind: 'release' as const, by: args.by, at: atIso, reason: args.reason }
      : { kind: 'keep' as const, value: args.answer.value, by: args.by, at: atIso, reason: args.reason };
  const episode = { ...rec.episode, answer };
  const heldCap = heldCapForEpisode(episode);
  const updated: ThrottleRecommendation = { ...rec, episode, heldCap };

  const priorHeldCap = heldCapForEpisode(rec.episode);
  const logLine =
    answer.kind === 'release' ? `release recorded by "${args.by}"` : `keep at ${answer.value} recorded by "${args.by}"`;
  const entry: ThrottleChangeLogEntry = { ts: atIso, from: priorHeldCap, to: heldCap, reason: logLine };
  atomicAppend(throttleChangeLogPath(args.targetRepoPath), JSON.stringify(entry) + '\n');
  atomicWrite(throttleRecommendationPath(args.targetRepoPath), JSON.stringify(updated));
  return updated;
}

export const main = makeArgsGuardedMain(
  parseArgs,
  'Usage: node release-intake-throttle.js <project-root> --by <who> (--release | --keep <N>) [--reason <text>]\n',
  async (args) => {
    printJsonToStdout(recordThrottleRelease(args));
  }
);

if (require.main === module) {
  runCliMain(main);
}
