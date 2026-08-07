#!/usr/bin/env node
/**
 * BL-819: the coordinator-owned ticket lifecycle ledger's write CLI. Reads
 * the five already-shipping instruments for ONE ticket
 * (leanLedgerCompose.ts), idempotently appends whatever is new to
 * .swarmforge/lean/<yyyy-MM-dd>.jsonl, and refreshes that ticket's
 * per-ticket snapshot - the callable unit invoked at the handoff and close
 * points that already exist (done_with_current_task.bb,
 * commit_integrity_cli.bb), same shelling convention handoffd.bb already
 * uses for emit-cost-health-sidecar.js.
 *
 * Usage: node lean-ledger-record.js --ticket <id> [--target <path>]
 */
import { loadRoles, resolveProjectRoot, printJsonToStdout, makeArgsGuardedMain, runCliMain } from './swarm-metrics';
import { composeAllLeanLedgerEvents } from '../metrics/leanLedgerCompose';
import { appendLeanLedgerEventIfNew, writeLeanLedgerSnapshotFor } from '../metrics/leanLedgerStore';
import { parseArgs, USAGE, LeanLedgerRecordArgs } from './leanLedgerRecordArgs';

// Re-export for tests
export { parseArgs, LeanLedgerRecordArgs };

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const targetPath = args.target ?? resolveProjectRoot(process.cwd());
  const roles = loadRoles(targetPath);
  const events = composeAllLeanLedgerEvents(targetPath, roles, args.ticket);

  let appended = 0;
  for (const event of events) {
    if (appendLeanLedgerEventIfNew(targetPath, event)) {
      appended++;
    }
  }
  const snapshot = writeLeanLedgerSnapshotFor(targetPath, args.ticket);
  printJsonToStdout({ ticket: args.ticket, composed: events.length, appended, snapshot });
});

if (require.main === module) {
  runCliMain(main);
}
