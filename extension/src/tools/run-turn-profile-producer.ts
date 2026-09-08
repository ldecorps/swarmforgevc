#!/usr/bin/env node
/**
 * BL-1364: headless turn-profile producer — walks role transcripts via
 * BL-664's transcriptWalker, folds them through buildTurnProfileSeries (which
 * until this ticket had no production caller at all) and appends the window to
 * .swarmforge/telemetry/turn-profile-series.jsonl. Idempotent: re-running over
 * the same transcripts records nothing new.
 *
 * BL-1476: a tick reads only transcripts changed since the last completed
 * tick (a persisted per-transcript summary store) and stops at its own
 * deadline, same posture as handoffd.bb's activity-feed-tick-deadline-ms
 * (BL-1454) - read from the OS env here rather than in handoffd.bb, since
 * this CLI is the one process that already knows its own summary-store I/O
 * cost; a misconfigured override can only make the tick MORE conservative,
 * never less (clamped to a quarter of SUPERVISOR_IN_SWEEP_BUDGET_MS).
 *
 * Usage: node run-turn-profile-producer.js
 */
import { runTurnProfileProducer } from '../metrics/turnProfileProducer';
import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

const DEFAULT_TICK_DEADLINE_MS = 30000;
const DEFAULT_SWEEP_BUDGET_MS = 225000;

function positiveEnvMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function resolveTurnProfileTickDeadlineMs(): number {
  return Math.min(
    positiveEnvMs('TURN_PROFILE_TICK_DEADLINE_MS', DEFAULT_TICK_DEADLINE_MS),
    Math.floor(positiveEnvMs('SUPERVISOR_IN_SWEEP_BUDGET_MS', DEFAULT_SWEEP_BUDGET_MS) / 4)
  );
}

export function formatTurnProfileResult(result: {
  recorded: number;
  updated: number;
  stages: string[];
  complete: boolean;
  read: number;
  listed: number;
  partial: boolean;
}): string {
  const readOfListed = `read ${result.read} of ${result.listed}`;
  if (result.partial) {
    return `PARTIAL ${readOfListed}; no window recorded this tick`;
  }
  if (!result.complete) {
    return `INCOMPLETE window has unreadable transcripts; no stage reports a share (${readOfListed})`;
  }
  if (result.stages.length === 0) {
    return `SKIPPED no classified turns in the window (${readOfListed})`;
  }
  const verb = result.recorded === 1 ? 'RECORDED' : 'UPDATED';
  return `${verb} turn profile for ${result.stages.length} stage(s): ${result.stages.join(', ')} (${readOfListed})`;
}

export function main(): void {
  const { projectRoot, roleWorktrees } = resolveCliMainWorktreeContext();
  const result = runTurnProfileProducer({
    repoRoot: projectRoot,
    roleWorktrees,
    deadlineMs: resolveTurnProfileTickDeadlineMs(),
  });
  console.log(formatTurnProfileResult(result));
}

if (require.main === module) {
  runCliMain(main);
}
