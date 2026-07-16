#!/usr/bin/env node
/**
 * BL-454: the go-forward writer - appends one structured QA-bounce record
 * (ticket, producing role, ticket type, failure class, commit, timestamp) to
 * the durable .swarmforge/qa_bounces/<YYYY-MM>.jsonl log. QA runs this right
 * after it hand-writes a backlog/evidence/<task>-bounce-<date>.md file, with
 * the same fields it already has in hand - the live production trigger for
 * the writer (wired into swarmforge/roles/QA.prompt by the specifier, in the
 * same parcel). Every field is validated against its closed set before
 * anything is written (engineering's Gherkin load-bearing-column rule) - an
 * unrecognized value is a usage error, never recorded raw.
 *
 * Usage: node record-qa-bounce.js <ticket> <producingRole> <ticketType> <failureClass> <commit>
 */
import { isKnownFailureClass, isKnownProducingRole, isKnownTicketType, QaBounceRecord } from '../quality/qaBounce';
import { appendQaBounceRecordIfNew } from '../quality/qaBounceStore';
import { makeArgsGuardedMain, printJsonToStdout, resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

const TICKET_PATTERN = /^BL-\d+$/i;

export function parseArgs(argv: string[]): Omit<QaBounceRecord, 'at'> | null {
  const [ticket, producingRole, ticketType, failureClass, commit] = argv;
  if (!ticket || !TICKET_PATTERN.test(ticket)) {
    return null;
  }
  if (!producingRole || !isKnownProducingRole(producingRole)) {
    return null;
  }
  if (!ticketType || !isKnownTicketType(ticketType)) {
    return null;
  }
  if (!failureClass || !isKnownFailureClass(failureClass)) {
    return null;
  }
  if (!commit) {
    return null;
  }
  return { ticket: ticket.toUpperCase(), producingRole, ticketType, failureClass, commit };
}

const USAGE =
  'Usage: record-qa-bounce.js <ticket> <producingRole> <ticketType> <failureClass> <commit>\n' +
  `  producingRole: coder|cleaner|architect|hardender|documenter\n` +
  `  ticketType: feature|bug|defect|chore|docs|enhancement|epic\n` +
  `  failureClass: compile|unit|integration|acceptance|behavior\n`;

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  const record: QaBounceRecord = { ...args, at: new Date().toISOString() };
  const recorded = appendQaBounceRecordIfNew(mainWorktreePath, record);
  printJsonToStdout({ recorded });
});

if (require.main === module) {
  runCliMain(main);
}
