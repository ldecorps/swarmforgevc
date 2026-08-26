#!/usr/bin/env node
/**
 * BL-635: the generalised go-forward bounce recorder - record-qa-bounce.js
 * generalised so every reviewing pipeline stage (not just QA) can record
 * its own send-backs. `--by` is REQUIRED (KNOWN_BOUNCE_ROLES, the full
 * pipeline vocabulary) and is now written into BOTH durable stores: the
 * JSONL log record itself (previously only the ticket-YAML merge received
 * it - BL-608 shape #6 left the log record itself without `by`) and, as
 * before, best-effort, the ticket's own bounce_history. Writes ONLY to the
 * new `.swarmforge/bounces/<YYYY-MM>.jsonl` path (record-bounce-by-role-07);
 * readers merge the legacy qa_bounces/ path forever
 * (bounceStore.ts's readBounceRecords).
 *
 * record-qa-bounce.js (BL-454/BL-608) is left untouched - it is a separate,
 * still-tested CLI. No role prompt invokes it after this ticket (QA.prompt
 * migrates here), but its own BL-608 acceptance suite still exercises it
 * directly, so it stays exactly as it was.
 *
 * Usage: node record-bounce.js --ticket <id> --role <producingRole>
 *          --type <ticketType> --class <failureClass> --commit <hex>
 *          --by <bouncingRole> [--evidence <path>]
 */
import { BounceRecord } from '../quality/qaBounce';
import { appendBounceRecordIfNew } from '../metrics/bounceStore';
import { bounceRevertCheck } from '../metrics/bounceRevertGitAdapter';
import { BounceRevertCheckReport, bouncingBranchForRole } from '../quality/bounceRevertVerdict';
import { makeArgsGuardedMain, printJsonToStdout, resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';
import { parseArgs, USAGE, RecordBounceArgs } from './recordBounceArgs';
import { updateTicketBounceHistory } from './recordQaBounceTicket';

// Re-export for tests
export { parseArgs, RecordBounceArgs };

// BL-954 seam: tests substitute the check to drive every outcome (including
// a throw) and prove the recording is never contingent on it (invariant 3).
export const revertCheckSeam = { run: bounceRevertCheck };

// BL-954 invariant 3: whatever the check concludes - or fails to conclude -
// the bounce record above is already written. A check that cannot complete
// reports its cause and never reads as clean.
function runBounceRevertCheck(projectRoot: string, args: RecordBounceArgs): BounceRevertCheckReport {
  try {
    return revertCheckSeam.run({ repoRoot: projectRoot, commit: args.commit, by: args.by });
  } catch (err) {
    return {
      verdict: 'undeterminable',
      branch: bouncingBranchForRole(args.by),
      commit: args.commit,
      remedy: null,
      cause: `the bounce revert check itself failed: ${err instanceof Error ? err.message : String(err)}`,
      liveFiles: [],
    };
  }
}

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const { projectRoot, mainWorktreePath } = resolveCliMainWorktreeContext();
  const at = new Date().toISOString();
  const record: BounceRecord = {
    ticket: args.ticket,
    producingRole: args.producingRole,
    ticketType: args.ticketType,
    failureClass: args.failureClass,
    commit: args.commit,
    by: args.by,
    at,
  };
  // BL-689 invariant 1: a call with no inventory (args.inventory.kind is
  // 'none' or 'degraded') must write EXACTLY the record this CLI wrote
  // before this ticket - `items`/`blocked` are only ever added when the
  // inventory actually resolved. `blocked` is metadata about the inventory,
  // so it never appears without `items` alongside it.
  if (args.inventory.kind === 'ok') {
    record.items = args.inventory.items;
    record.blocked = args.blocked;
  }
  const inventoryDegradeReason = args.inventory.kind === 'degraded' ? args.inventory.reason : null;
  const recorded = appendBounceRecordIfNew(mainWorktreePath, record);

  // --evidence is the only optional flag left (--by is required at parse
  // time, so it is always present here) - absent evidence just skips the
  // best-effort ticket-record merge, same degrade posture BL-608 shipped.
  const ticketRecord =
    args.evidence !== undefined
      ? updateTicketBounceHistory(projectRoot, args.ticket, {
          at: at.slice(0, 10),
          by: args.by,
          blamed: args.producingRole,
          failureClass: args.failureClass,
          commit: args.commit,
          evidence: args.evidence,
        })
      : { updated: false, reason: 'not-attempted' };

  // BL-954: runs strictly AFTER appendBounceRecordIfNew - the record is
  // durable before the branch state is ever examined.
  const revertCheck = runBounceRevertCheck(projectRoot, args);

  printJsonToStdout({
    recorded,
    ticketRecordUpdated: ticketRecord.updated,
    ticketRecordReason: ticketRecord.reason,
    inventoryDegradeReason,
    revertCheck,
  });
});

if (require.main === module) {
  runCliMain(main);
}
