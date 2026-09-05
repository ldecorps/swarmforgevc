#!/usr/bin/env node
/**
 * BL-1365: headless ritual-ledger producer — classifies the window's commits
 * by path area and records each class's volume and subject dominance to
 * .swarmforge/telemetry/ritual-ledger.json.
 *
 * This is the "independent cadence" invariant 1 asks for: the ledger accrues
 * whether or not a ceremony ever reads it, so a shift that closes no ceremony
 * delays adjudication and loses no measurement.
 *
 * Usage: node run-ritual-ledger-producer.js
 */
import { runRitualLedgerProducer } from '../metrics/ritualLedgerProducer';
import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

export function formatRitualLedgerResult(result: { commitsScanned: number; classes: string[] }): string {
  if (result.commitsScanned === 0) {
    return 'EMPTY no commits in the window; ledger recorded with no classes';
  }
  return `RECORDED ${result.commitsScanned} commit(s) across ${result.classes.length} ritual class(es): ${result.classes.join(', ')}`;
}

export function main(): void {
  const { projectRoot } = resolveCliMainWorktreeContext();
  const result = runRitualLedgerProducer({ repoRoot: projectRoot, nowIso: new Date().toISOString() });
  console.log(formatRitualLedgerResult(result));
}

if (require.main === module) {
  runCliMain(main);
}
