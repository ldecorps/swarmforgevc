#!/usr/bin/env node
/**
 * BL-454: the go-forward writer - appends one structured QA-bounce record
 * (ticket, producing role, ticket type, failure class, commit, timestamp) to
 * the durable .swarmforge/qa_bounces/<YYYY-MM>.jsonl log. QA runs this right
 * after it hand-writes a backlog/evidence/<task>-bounce-<date>.md file, with
 * the same fields it already has in hand - the live production trigger for
 * the writer, wired into swarmforge/roles/QA.prompt by the specifier. Every
 * field is validated against its closed set before anything is written
 * (engineering's Gherkin load-bearing-column rule) - an unrecognized value
 * is a usage error, never recorded raw.
 *
 * Usage: node record-qa-bounce.js --ticket <id> --role <producingRole>
 *          --type <ticketType> --class <failureClass> --commit <hex>
 * Flag contract matches swarmforge/roles/QA.prompt's own caller exactly.
 */
import { isKnownFailureClass, isKnownProducingRole, isKnownTicketType, QaBounceRecord } from '../quality/qaBounce';
import { appendQaBounceRecordIfNew } from '../quality/qaBounceStore';
import { makeArgsGuardedMain, printJsonToStdout, resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

const TICKET_PATTERN = /^BL-\d+$/i;

const FLAG_NAMES = ['--ticket', '--role', '--type', '--class', '--commit'] as const;
type FlagName = (typeof FLAG_NAMES)[number];

// Pure - parses `--flag value` pairs (any order) into a lookup, or null on
// any unrecognized flag / a flag with no following value.
function parseFlags(argv: string[]): Partial<Record<FlagName, string>> | null {
  const flags: Partial<Record<FlagName, string>> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!FLAG_NAMES.includes(flag as FlagName) || value === undefined) {
      return null;
    }
    flags[flag as FlagName] = value;
  }
  return flags;
}

export function parseArgs(argv: string[]): Omit<QaBounceRecord, 'at'> | null {
  const flags = parseFlags(argv);
  if (!flags) {
    return null;
  }
  const { '--ticket': ticket, '--role': producingRole, '--type': ticketType, '--class': failureClass, '--commit': commit } = flags;
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
  'Usage: record-qa-bounce.js --ticket <id> --role <producingRole> --type <ticketType> --class <failureClass> --commit <hex>\n' +
  `  --role: coder|cleaner|architect|hardender|documenter\n` +
  `  --type: feature|bug|defect|chore|docs|enhancement|epic\n` +
  `  --class: compile|unit|integration|acceptance|behavior\n`;

export const main = makeArgsGuardedMain(parseArgs, USAGE, async (args) => {
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  const record: QaBounceRecord = { ...args, at: new Date().toISOString() };
  const recorded = appendQaBounceRecordIfNew(mainWorktreePath, record);
  printJsonToStdout({ recorded });
});

if (require.main === module) {
  runCliMain(main);
}
