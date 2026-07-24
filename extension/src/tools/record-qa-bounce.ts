#!/usr/bin/env node
/**
 * BL-454: the go-forward writer - appends one structured QA-bounce record
 * (ticket, producing role, ticket type, failure class, commit, timestamp) to
 * the durable .swarmforge/qa_bounces/<YYYY-MM>.jsonl log. QA runs this right
 * after it hand-writes a backlog/evidence/<task>-bounce-<date>.md file.
 *
 * BL-608: also best-effort merges a matching `bounce_history:` entry onto
 * the ticket's OWN backlog/active/<id>-*.yaml record, in the CURRENT
 * worktree (never the specifier/coordinator's main checkout the JSONL write
 * uses) - the caller commits the YAML edit alongside its evidence file, so
 * it rides the normal merge chain to main. This is deliberately best-effort:
 * a missing/unwritable/unparseable ticket record never fails the bounce.
 *
 * `--by`/`--evidence` are OPTIONAL flags: the live swarmforge/roles/QA.prompt
 * invocation now passes both on every bounce (BL-608 architect send-back #1 -
 * the flags must reach the one wired live caller or updateTicketBounceHistory()
 * is never exercised in production). They stay optional at the CLI/parseArgs
 * level purely as a best-effort degrade path for any OTHER caller that omits
 * them: omitting either (or both) keeps the original BL-454 behavior exactly
 * (the JSONL append), and simply skips the ticket-record merge - never a usage
 * error, never a functional regression.
 *
 * Usage: node record-qa-bounce.js --ticket <id> --role <producingRole>
 *          --type <ticketType> --class <failureClass> --commit <hex>
 *          [--by <bouncingRole> --evidence <path>]
 */
import { QaBounceRecord } from '../quality/qaBounce';
import { appendQaBounceRecordIfNew } from '../metrics/qaBounceStore';
import { makeArgsGuardedMain, printJsonToStdout, resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';
import { parseArgs, USAGE, RecordQaBounceArgs } from './recordQaBounceArgs';
import { updateTicketBounceHistory } from './recordQaBounceTicket';

// Re-export for backward compatibility with existing tests
export { parseArgs, RecordQaBounceArgs };

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const { projectRoot, mainWorktreePath } = resolveCliMainWorktreeContext();
  const at = new Date().toISOString();
  const record: QaBounceRecord = {
    ticket: args.ticket,
    producingRole: args.producingRole,
    ticketType: args.ticketType,
    failureClass: args.failureClass,
    commit: args.commit,
    at,
  };
  const recorded = appendQaBounceRecordIfNew(mainWorktreePath, record);

  // --by/--evidence are optional (see file header) - absent means the
  // caller predates BL-608's two-flag addition, so the ticket-record merge
  // is skipped entirely rather than attempted with placeholder values.
  const ticketRecord =
    args.by !== undefined && args.evidence !== undefined
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
