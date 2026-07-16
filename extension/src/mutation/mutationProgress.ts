// BL-132: durable, structured mutation-run progress. Pure state/record
// logic only - no fs, no Date.now() - so it is testable without a real
// Stryker run or a real clock. The IO/Stryker-lifecycle adapters that call
// this live in mutationProgressFile.ts and mutationProgressReporter.ts.
//
// BL-446: also tracks `killed`, alongside the existing survived/timedOut
// counters, so a completed run's kill count is available for
// mutationGateHealth.ts's health verdict without a second pass over
// Stryker's mutant results.

import { classifyMutationGateHealth, MutationGateHealth } from './mutationGateHealth';

export interface MutationProgressState {
  total: number;
  tested: number;
  killed: number;
  survived: number;
  timedOut: number;
  startedAtMs: number;
}

export interface MutationProgressRecord {
  file?: string;
  tested: number;
  total: number;
  percent: number;
  killed: number;
  survived: number;
  timedOut: number;
  elapsed_s: number;
  eta_s: number | null;
  updated_at: string;
  status: 'running' | 'done';
  // BL-446: only meaningful once the run is complete - undefined while
  // 'running', since a mid-run zero-kill count is expected (most mutants
  // haven't been tested yet) and would misreport as suspect.
  health?: MutationGateHealth;
}

export function initMutationProgressState(total: number, startedAtMs: number): MutationProgressState {
  return { total, tested: 0, killed: 0, survived: 0, timedOut: 0, startedAtMs };
}

export function recordMutantTested(state: MutationProgressState, status: string): MutationProgressState {
  return {
    ...state,
    tested: state.tested + 1,
    killed: state.killed + (status === 'Killed' ? 1 : 0),
    survived: state.survived + (status === 'Survived' ? 1 : 0),
    timedOut: state.timedOut + (status === 'Timeout' ? 1 : 0),
  };
}

export interface BuildProgressRecordOptions {
  file?: string;
  status?: 'running' | 'done';
}

// eta_s is a simple average-pace projection (elapsed / tested * remaining) -
// the same shape Stryker's own progress reporter uses internally, applied
// here to plain mutant counts rather than duration-weighted ticks, since
// that internal weighting isn't part of Stryker's public Reporter API.
export function buildProgressRecord(
  state: MutationProgressState,
  nowMs: number,
  options: BuildProgressRecordOptions = {}
): MutationProgressRecord {
  const elapsedSeconds = Math.max(0, (nowMs - state.startedAtMs) / 1000);
  const percent = state.total > 0 ? Math.round((state.tested / state.total) * 100) : 0;
  let etaSeconds: number | null;
  if (state.total <= 0 || state.tested === 0) {
    etaSeconds = null;
  } else if (state.tested >= state.total) {
    etaSeconds = 0;
  } else {
    etaSeconds = Math.round((elapsedSeconds / state.tested) * (state.total - state.tested));
  }

  const status = options.status ?? 'running';
  return {
    file: options.file,
    tested: state.tested,
    total: state.total,
    percent,
    killed: state.killed,
    survived: state.survived,
    timedOut: state.timedOut,
    elapsed_s: Math.round(elapsedSeconds),
    eta_s: etaSeconds,
    updated_at: new Date(nowMs).toISOString(),
    status,
    health: status === 'done' ? classifyMutationGateHealth(state.killed, state.survived) : undefined,
  };
}
