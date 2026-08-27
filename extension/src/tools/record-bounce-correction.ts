#!/usr/bin/env node
/**
 * BL-990: corrects a misattributed bounce.
 *
 * A bounce charged to the wrong role used to be permanent - record-bounce.js
 * only appends, and the only correction available was a human-readable note
 * that no consumer reads. This writes a CORRECTION RECORD to the same
 * append-only JSONL store, superseding the named bounce without editing or
 * deleting the original line: the store is an audit trail, and the fact that
 * a misattribution happened is itself the evidence that this class of defect
 * exists.
 *
 * Correcting a bounce is a TELEMETRY act, never a routing one - the parcel's
 * disposition is untouched, and this CLI touches no mailbox.
 */
import { BounceCorrection } from '../quality/qaBounce';
import { appendBounceCorrectionIfNew } from '../metrics/bounceStore';
import { makeArgsGuardedMain, printJsonToStdout, resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';
import { parseArgs, USAGE, RecordBounceCorrectionArgs } from './recordBounceCorrectionArgs';

// Re-export for tests
export { parseArgs, RecordBounceCorrectionArgs };

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  const correction: BounceCorrection = {
    kind: 'bounce-correction',
    ticket: args.ticket,
    commit: args.commit,
    at: new Date().toISOString(),
    by: args.by,
    reason: args.reason,
    ...(args.evidence === undefined ? {} : { evidence: args.evidence }),
  };
  const recorded = appendBounceCorrectionIfNew(mainWorktreePath, correction);
  printJsonToStdout({ recorded, ticket: args.ticket, commit: args.commit });
});

if (require.main === module) {
  runCliMain(main);
}
