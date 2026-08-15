#!/usr/bin/env node
/**
 * BL-897: the one full-history backlog `git log` walk a briefing send
 * needs, run at most once per UTC day and shared via a machine-local
 * snapshot (metrics/lifecycleSnapshot.ts) every other briefing-section CLI
 * reads instead of re-deriving lifecycles itself (costHealthSidecar.ts,
 * briefing-digest-line.ts, render-briefing-burndown.ts). Idempotent within
 * a day: a fresh (today's) snapshot already on disk is reused, not
 * re-walked, so calling this unconditionally on every daemon tick is safe.
 *
 * Usage: node emit-lifecycle-snapshot.js
 * Prints {"path": "...", "walked": true|false} to stdout.
 */
import { runGitLog, deriveTicketLifecycles } from '../metrics/gitHistoryAdapter';
import { lifecycleSnapshotPath, readLifecycleSnapshot, writeLifecycleSnapshot } from '../metrics/lifecycleSnapshot';
import { resolveProjectRoot, printJsonToStdout, runCliMain } from './swarm-metrics';

export interface EnsureLifecycleSnapshotResult {
  path: string;
  walked: boolean;
}

export interface EnsureLifecycleSnapshotOptions {
  runGitLogFn?: typeof runGitLog;
}

// runGitLogFn is an injected seam (constitution: prefer an injected
// function over a *_FORCE_RESULT env bypass) so a test can count/assert
// exactly one walk without needing a real git fixture repo.
export function ensureLifecycleSnapshot(
  projectRoot: string,
  nowMs: number = Date.now(),
  { runGitLogFn = runGitLog }: EnsureLifecycleSnapshotOptions = {}
): EnsureLifecycleSnapshotResult {
  const filePath = lifecycleSnapshotPath(projectRoot);
  if (readLifecycleSnapshot(filePath, nowMs) !== null) {
    return { path: filePath, walked: false };
  }
  const records = [...deriveTicketLifecycles(runGitLogFn(projectRoot, 'backlog')).values()];
  writeLifecycleSnapshot(projectRoot, records, nowMs);
  return { path: filePath, walked: true };
}

export function main(): void {
  const projectRoot = resolveProjectRoot(process.cwd());
  const result = ensureLifecycleSnapshot(projectRoot);
  printJsonToStdout(result);
}

if (require.main === module) {
  runCliMain(main);
}
