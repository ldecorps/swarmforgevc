#!/usr/bin/env node
/**
 * BL-454: prints ONE plain-text line/section - the QA-bounce tally, ranking
 * roles by how often their work bounces from QA and breaking bounces down by
 * ticket type - for briefing_email_lib.bb (a Babashka script with no way to
 * import compiled TS) to shell out to and fold into the daily briefing, the
 * same shell-out convention every other briefing section already uses
 * (suite-duration-line.js, not-done-count-line.js, ...). Reuses
 * computeQaBounceTally unchanged, fed by the SAME durable log
 * record-qa-bounce.js/backfill-qa-bounces.js write. Prints nothing (empty
 * stdout, exit 0) when there are no recorded bounces yet -
 * briefing_email_lib.bb's append-content-block already treats a blank block
 * as "nothing to append," never a fabricated zero-bounce line.
 *
 * Usage: node qa-bounce-line.js
 */
import { computeQaBounceTally, QaBounceTally } from '../quality/qaBounce';
import { readQaBounceRecords } from '../quality/qaBounceStore';
import { resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

export function formatQaBounceLine(tally: QaBounceTally): string {
  const byRole = tally.byRole.map(({ role, count }) => `${role} x${count}`).join(', ');
  const byType = Object.entries(tally.byTicketType)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => `${type} x${count}`)
    .join(', ');
  return `QA bounces: ${tally.total} total - by role: ${byRole} - by ticket type: ${byType}`;
}

export function main(): void {
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  const records = readQaBounceRecords(mainWorktreePath);
  if (records.length === 0) {
    return;
  }
  console.log(formatQaBounceLine(computeQaBounceTally(records)));
}

if (require.main === module) {
  runCliMain(main);
}
