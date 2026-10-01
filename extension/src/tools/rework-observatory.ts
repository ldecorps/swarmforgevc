#!/usr/bin/env node
/**
 * BL-430 (epic BL-429 slice 1 - OBSERVE): read-only CLI that computes the
 * rolling QA-bounce/rework rate over a trailing window, attributed by role
 * and ticket-class against a trailing baseline, and persists it for the
 * diagnosis slice (BL-431) to read. Moves no knob, changes no promotion
 * behaviour - a pure observation layer over data the pipeline already
 * records (backward handoffs, QA bounce evidence, each ticket's own
 * mutation_cost).
 *
 * Usage: node rework-observatory.js
 */
import { resolveCliMainWorktreeContext, loadRoles, runCliMain } from './swarm-metrics';
import { RoleWorktree, NO_SAMPLE_PLACEHOLDER } from '../metrics/swarmMetrics';
import { computeReworkSignal, ReworkSignal } from '../metrics/reworkObservatory';
import { loadCompletedTicketRecords } from '../metrics/reworkObservatorySource';
import { persistReworkSignal } from '../metrics/reworkObservatoryStore';

export const WINDOW_DAYS = 14;
export const BASELINE_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

// Soft roles.tsv load for consumers that only have a target path (emit-
// throttle CLI, tests without a packed swarm) - missing/unreadable roles
// degrade to "no live handoff attribution", never a crash; evidence-based
// bounce counting on main still works with an empty roles list.
export function loadRoleWorktreesOrEmpty(targetPath: string): RoleWorktree[] {
  try {
    return loadRoles(targetPath).map((r) => ({ role: r.role, worktreePath: r.worktreePath }));
  } catch {
    return [];
  }
}

// BL-430 refresh seam used by BL-431 (briefing verdict) and BL-432 (throttle
// emit) so neither diagnoses a stale observatory snapshot. Returns the fresh
// signal; persists it the same way the standalone rework-observatory CLI does.
export function refreshReworkSignal(
  targetPath: string,
  nowMs: number = Date.now(),
  roles?: RoleWorktree[]
): ReworkSignal {
  return runObservatory(targetPath, roles ?? loadRoleWorktreesOrEmpty(targetPath), nowMs).signal;
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// Pure: the human-readable line, kept separate from the persisted JSON so
// either can change shape independently.
export function formatReworkSignal(signal: ReworkSignal, windowDays: number): string {
  if (!signal.hasSample) {
    return `Rework rate (${windowDays}d): ${NO_SAMPLE_PLACEHOLDER} no sample`;
  }
  const baseline = signal.baselineRate === null ? NO_SAMPLE_PLACEHOLDER : formatPercent(signal.baselineRate);
  const concentration = [
    signal.topRole ? `role ${signal.topRole}` : null,
    signal.topTicketClass ? `class ${signal.topTicketClass}` : null,
  ]
    .filter((v): v is string => v !== null)
    .join(', ');
  const concentrationSuffix = concentration ? ` — concentrated in ${concentration}` : '';
  return `Rework rate (${windowDays}d): ${formatPercent(signal.reworkRate as number)} (baseline ${baseline}, n=${signal.sampleCount})${concentrationSuffix}`;
}

export interface ObservatoryRunResult {
  signal: ReworkSignal;
  summaryLine: string;
}

export function runObservatory(targetPath: string, roles: RoleWorktree[], nowMs: number): ObservatoryRunResult {
  const windowStartMs = nowMs - WINDOW_DAYS * DAY_MS;
  const baselineStartMs = windowStartMs - BASELINE_WINDOW_DAYS * DAY_MS;

  const records = loadCompletedTicketRecords(targetPath, roles);
  const signal = computeReworkSignal(records, windowStartMs, nowMs, baselineStartMs);

  persistReworkSignal(targetPath, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: new Date(nowMs).toISOString(),
    windowDays: WINDOW_DAYS,
    baselineWindowDays: BASELINE_WINDOW_DAYS,
    signal,
  });

  return { signal, summaryLine: formatReworkSignal(signal, WINDOW_DAYS) };
}

export async function main(): Promise<void> {
  const { mainWorktreePath, roleWorktrees } = resolveCliMainWorktreeContext();
  const result = runObservatory(mainWorktreePath, roleWorktrees, Date.now());
  console.log(result.summaryLine);
}

if (require.main === module) {
  runCliMain(main);
}
