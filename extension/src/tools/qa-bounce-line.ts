#!/usr/bin/env node
/**
 * BL-454: prints ONE plain-text line/section - the bounce tally - for
 * briefing_email_lib.bb (a Babashka script with no way to import compiled
 * TS) to shell out to and fold into the daily briefing, the same shell-out
 * convention every other briefing section already uses
 * (suite-duration-line.js, not-done-count-line.js, ...). Prints nothing
 * (empty stdout, exit 0) when there are no recorded bounces yet -
 * briefing_email_lib.bb's append-content-block already treats a blank block
 * as "nothing to append," never a fabricated zero-bounce line.
 *
 * BL-635: generalised from a QA-only line to report who BOUNCED as well as
 * whose work bounced - the durable log now carries any reviewing role's
 * send-backs (record-bounce.js), not only QA's (the legacy
 * record-qa-bounce.js writer this line used to read exclusively). Reads the
 * MERGED log (readBounceRecords: the new .swarmforge/bounces/ path plus the
 * legacy .swarmforge/qa_bounces/ one, forever) so the 53 pre-BL-635 records
 * still count, attributed as unattributed rather than silently folded into
 * QA (they predate `by` on the JSONL line entirely).
 *
 * Usage: node qa-bounce-line.js
 */
import { computeQaBounceTally, computeBounceTallyByBouncingRole, QaBounceRoleTally, QaBounceTally } from '../quality/qaBounce';
import { readBounceRecords } from '../metrics/qaBounceStore';
import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

function formatRoleCounts(counts: QaBounceRoleTally[]): string {
  return counts.map(({ role, count }) => `${role} x${count}`).join(', ');
}

export function formatBounceLine(byBouncingRole: QaBounceRoleTally[], tally: QaBounceTally): string {
  const byType = Object.entries(tally.byTicketType)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => `${type} x${count}`)
    .join(', ');
  return (
    `Bounces: ${tally.total} total - by bouncing role: ${formatRoleCounts(byBouncingRole)} - ` +
    `whose work: ${formatRoleCounts(tally.byRole)} - by ticket type: ${byType}`
  );
}

export function main(): void {
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  const records = readBounceRecords(mainWorktreePath);
  if (records.length === 0) {
    return;
  }
  console.log(formatBounceLine(computeBounceTallyByBouncingRole(records), computeQaBounceTally(records)));
}

if (require.main === module) {
  runCliMain(main);
}
