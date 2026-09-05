#!/usr/bin/env node
/**
 * BL-1364: headless turn-profile producer — walks role transcripts via
 * BL-664's transcriptWalker, folds them through buildTurnProfileSeries (which
 * until this ticket had no production caller at all) and appends the window to
 * .swarmforge/telemetry/turn-profile-series.jsonl. Idempotent: re-running over
 * the same transcripts records nothing new.
 *
 * Usage: node run-turn-profile-producer.js
 */
import { runTurnProfileProducer } from '../metrics/turnProfileProducer';
import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

export function formatTurnProfileResult(result: {
  recorded: number;
  updated: number;
  stages: string[];
  complete: boolean;
}): string {
  if (!result.complete) {
    return 'INCOMPLETE window has unreadable transcripts; no stage reports a share';
  }
  if (result.stages.length === 0) {
    return 'SKIPPED no classified turns in the window';
  }
  const verb = result.recorded === 1 ? 'RECORDED' : 'UPDATED';
  return `${verb} turn profile for ${result.stages.length} stage(s): ${result.stages.join(', ')}`;
}

export function main(): void {
  const { projectRoot, roleWorktrees } = resolveCliMainWorktreeContext();
  const result = runTurnProfileProducer({ repoRoot: projectRoot, roleWorktrees });
  console.log(formatTurnProfileResult(result));
}

if (require.main === module) {
  runCliMain(main);
}
