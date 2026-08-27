#!/usr/bin/env node
/**
 * BL-431 (epic BL-429 slice 2 - DIAGNOSE + ESCALATE): the briefing-line CLI
 * that surfaces reworkDiagnosis.ts's verdict through the same shell-out
 * convention every other briefing section already uses (Babashka has no way
 * to import compiled TS) - reads BL-430's persisted rework-rate signal
 * (reworkObservatoryStore.ts, written by rework-observatory.js) unchanged,
 * so the briefing can never disagree with the CLI/holistic-UI reading of
 * the same signal. Prints nothing (empty stdout, exit 0) when there is no
 * verdict - briefing_email_lib.bb's append-content-block already treats a
 * blank block as "nothing to append," never a fabricated no-issue line.
 *
 * Usage: node suboptimality-verdict-line.js
 */
import { readReworkSignal } from '../metrics/reworkObservatoryStore';
import { diagnoseReworkSignal, SuboptimalityVerdict } from '../metrics/reworkDiagnosis';
import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function formatSuboptimalityVerdictLine(verdict: SuboptimalityVerdict): string {
  return (
    `Suboptimality verdict: rework rate ${formatPercent(verdict.reworkRate)} ` +
    `(baseline ${formatPercent(verdict.baselineRate)}) - likely cause: ${verdict.likelyCause}. ` +
    `Recommended: ${verdict.recommendedAction} [${verdict.disposition}].`
  );
}

export function main(): void {
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  const signal = readReworkSignal(mainWorktreePath);
  if (signal === null) {
    return;
  }
  const verdict = diagnoseReworkSignal(signal);
  if (verdict === null) {
    return;
  }
  console.log(formatSuboptimalityVerdictLine(verdict));
}

if (require.main === module) {
  runCliMain(main);
}
