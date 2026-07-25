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
 * (qaBounceStore.ts's readBounceRecords).
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
import { appendBounceRecordIfNew } from '../metrics/qaBounceStore';
import { makeArgsGuardedMain, printJsonToStdout, resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';
import { parseArgs, USAGE, RecordBounceArgs } from './recordBounceArgs';
import { updateTicketBounceHistory } from './recordQaBounceTicket';

// Re-export for tests
export { parseArgs, RecordBounceArgs };

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

  printJsonToStdout({ recorded, ticketRecordUpdated: ticketRecord.updated, ticketRecordReason: ticketRecord.reason });
});

if (require.main === module) {
  runCliMain(main);
}
