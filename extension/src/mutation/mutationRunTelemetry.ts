// BL-593: pure builder for durable mutation-run completion telemetry.
// No fs, no Stryker, no Date.now() — inject timestamps and meta for tests.

import { MutationProgressState } from './mutationProgress';

export interface MutationRunRecordMeta {
  role: string;
  worktree?: string;
  scope: string;
  incremental: boolean;
  concurrency: number;
  buildSha: string;
}

export interface MutationRunRecord {
  started_at: string;
  ended_at: string;
  elapsed_s: number;
  role: string;
  worktree?: string;
  scope: string;
  total: number;
  incremental: boolean;
  concurrency: number;
  killed: number;
  survived: number;
  no_coverage: number;
  timed_out: number;
  ignored: number;
  build_sha: string;
  aborted?: true;
}

export interface BuildMutationRunRecordOptions {
  aborted?: true;
}

function requireLoadBearingMeta(meta: MutationRunRecordMeta, total: number): void {
  if (!meta.scope || meta.scope.trim() === '') {
    throw new Error('mutation run record requires a non-empty scope');
  }
  if (!Number.isFinite(total) || total < 0) {
    throw new Error('mutation run record requires a non-negative mutant total');
  }
  if (typeof meta.incremental !== 'boolean') {
    throw new Error('mutation run record requires an incremental flag');
  }
}

export function buildMutationRunRecord(
  state: MutationProgressState,
  endedAtMs: number,
  meta: MutationRunRecordMeta,
  options: BuildMutationRunRecordOptions = {}
): MutationRunRecord {
  requireLoadBearingMeta(meta, state.total);
  const elapsedSeconds = Math.max(0, Math.round((endedAtMs - state.startedAtMs) / 1000));
  const record: MutationRunRecord = {
    started_at: new Date(state.startedAtMs).toISOString(),
    ended_at: new Date(endedAtMs).toISOString(),
    elapsed_s: elapsedSeconds,
    role: meta.role,
    scope: meta.scope,
    total: state.total,
    incremental: meta.incremental,
    concurrency: meta.concurrency,
    killed: state.killed,
    survived: state.survived,
    no_coverage: state.noCoverage,
    timed_out: state.timedOut,
    ignored: state.ignored,
    build_sha: meta.buildSha,
  };
  if (meta.worktree !== undefined) {
    record.worktree = meta.worktree;
  }
  if (options.aborted) {
    record.aborted = true;
  }
  return record;
}

export const STRYKER_INCREMENTAL_ENV = 'STRYKER_INCREMENTAL';
export const SWARMFORGE_BUILD_SHA_ENV = 'SWARMFORGE_BUILD_SHA';
export const SWARMFORGE_WORKTREE_ENV = 'SWARMFORGE_WORKTREE';

export function resolveMutationRunMeta(
  env: NodeJS.ProcessEnv,
  role: string,
  defaults: { scope?: string; concurrency?: number } = {}
): MutationRunRecordMeta {
  const scope = env.STRYKER_MUTATE_FILE ?? defaults.scope ?? 'out/**/*.js';
  const rawConcurrency = env.MUTATION_CONCURRENCY ?? String(defaults.concurrency ?? 1);
  const concurrency = Number(rawConcurrency);
  const incrementalRaw = env[STRYKER_INCREMENTAL_ENV];
  const incremental =
    incrementalRaw === '1' || incrementalRaw === 'true' || incrementalRaw === 'yes';
  const buildSha = env[SWARMFORGE_BUILD_SHA_ENV] ?? 'unknown';
  const worktree = env[SWARMFORGE_WORKTREE_ENV];
  return {
    role,
    ...(worktree ? { worktree } : {}),
    scope,
    incremental,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? Math.floor(concurrency) : 1,
    buildSha,
  };
}

export function isCompletedFullRunRecord(record: MutationRunRecord): boolean {
  return record.aborted !== true;
}
