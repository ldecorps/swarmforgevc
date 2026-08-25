#!/usr/bin/env node
/**
 * BL-532: the CLI QA runs to disposition a batch parcel before spending a
 * verification pass on it - status/defer/clear over the sibling-deferral
 * store. `main` stays a thin wrapper over exported helpers (engineering.
 * prompt's CLI rule).
 *
 * Usage:
 *   node qa-sibling-check.js status --ticket <id>
 *     exit 0  VERIFY <ticket>
 *     exit 3  DEFERRED <ticket> BLOCKED_BY <blocker> CHECK <command>        (one line per still-open blocker)
 *     exit 4  RELEASABLE <ticket> BLOCKED_BY <blocker> CLOSED_AT <path>     (one line per closed blocker; BL-861)
 *   node qa-sibling-check.js defer --ticket <id> --blocked-by <id> --class <failureClass> --check "<command>" --commit <10-hex>
 *     exit 0  {"recorded": true|false}
 *     exit 4  REFUSED: --check reads the blocker's own path under backlog/active/ (BL-861 - that
 *             path moves to backlog/done/ the moment the blocker closes, exactly when the
 *             recorded check should be releasing the sibling)
 *   node qa-sibling-check.js clear --ticket <id> --blocked-by <id> --commit <10-hex>
 *   node qa-sibling-check.js list
 *     exit 0  NONE
 *     exit 4  RELEASABLE <ticket> BLOCKED_BY <blocker> CLOSED_AT <path>     (one line per closed
 *             blocker of every stranded ticket - BL-861: released in fact, still deferred on
 *             paper, discoverable without naming the ticket in advance)
 *
 * Exit 2 is reserved for usage errors, so a caller can tell "deferred"/
 * "releasable" from "you typed it wrong". The tool never EXECUTES a recorded
 * blocker command - it is read from the store and printed for QA to re-run
 * itself; executing it would turn a data store into an arbitrary-command sink.
 */
import { checkReadsBlockerActivePath, isKnownFailureClass, QaBounceFailureClass, SiblingDeferralRecord } from '../quality/siblingDeferral';
import { KNOWN_FAILURE_CLASSES } from '../quality/qaBounce';
import { appendSiblingDeferralRecordIfNew } from '../metrics/siblingDeferralStore';
import { computeTicketDeferralStatus, listStrandedDeferrals } from '../metrics/siblingDeferralStatus';
import { printJsonToStdout, resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

const TICKET_PATTERN = /^BL-\d+$/i;

function isValidTicket(value: string | undefined): value is string {
  return !!value && TICKET_PATTERN.test(value);
}

interface StatusArgs {
  command: 'status';
  ticket: string;
}

interface DeferArgs {
  command: 'defer';
  ticket: string;
  blockedBy: string;
  failureClass: QaBounceFailureClass;
  check: string;
  commit: string;
}

interface ClearArgs {
  command: 'clear';
  ticket: string;
  blockedBy: string;
  commit: string;
}

// BL-861: no ticket named in advance - lists every deferral released in
// fact but still deferred on paper (stranded).
interface ListArgs {
  command: 'list';
}

export type QaSiblingCheckArgs = StatusArgs | DeferArgs | ClearArgs | ListArgs;

const STATUS_FLAGS = ['--ticket'] as const;
const DEFER_FLAGS = ['--ticket', '--blocked-by', '--class', '--check', '--commit'] as const;
const CLEAR_FLAGS = ['--ticket', '--blocked-by', '--commit'] as const;
const LIST_FLAGS = [] as const;

// Pure - parses `--flag value` pairs (any order) into a lookup, or null on
// any unrecognized flag / a flag with no following value.
//
// hardener note: a mutant forcing `value === undefined` to `false` (so a
// trailing flag with no value is silently accepted rather than refused here)
// is an accepted-equivalent for every caller in this file. A dangling flag
// only arises as the argv's final, odd-length pair, so its `value` is
// undefined for exactly one recognized flag key; that key is always one of
// this module's own required fields (ticket/blockedBy/class/check/commit),
// and every parse*Args function already rejects an undefined/falsy value for
// each of its required fields downstream. Removing this short-circuit just
// moves the rejection one call deeper - it never lets a malformed invocation
// through (BL-234 precedent).
function parseFlags(argv: string[], allowed: readonly string[]): Record<string, string> | null {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!allowed.includes(flag) || value === undefined) {
      return null;
    }
    flags[flag] = value;
  }
  return flags;
}

function parseStatusArgs(rest: string[]): StatusArgs | null {
  const flags = parseFlags(rest, STATUS_FLAGS);
  if (!flags || !isValidTicket(flags['--ticket'])) {
    return null;
  }
  return { command: 'status', ticket: flags['--ticket'].toUpperCase() };
}

// Split out of parseDeferArgs for the same CRAP-budget reason
// siblingDeferralStore.ts's own hasSiblingDeferralRecordShape /
// hasKnownSiblingDeferralValues split documents - a single six-term `||`
// chain inline pushed parseDeferArgs's cyclomatic complexity (and thus CRAP,
// which collapses to complexity at 100% coverage) past the <= 6 threshold.
function hasValidDeferFields(ticket: string, blockedBy: string, failureClass: string, check: string, commit: string): failureClass is QaBounceFailureClass {
  return isValidTicket(ticket) && isValidTicket(blockedBy) && !!failureClass && isKnownFailureClass(failureClass) && !!check && !!commit;
}

function parseDeferArgs(rest: string[]): DeferArgs | null {
  const flags = parseFlags(rest, DEFER_FLAGS);
  if (!flags) {
    return null;
  }
  const { '--ticket': ticket, '--blocked-by': blockedBy, '--class': failureClass, '--check': check, '--commit': commit } = flags;
  if (!hasValidDeferFields(ticket, blockedBy, failureClass, check, commit)) {
    return null;
  }
  return { command: 'defer', ticket: ticket.toUpperCase(), blockedBy: blockedBy.toUpperCase(), failureClass, check, commit };
}

function parseClearArgs(rest: string[]): ClearArgs | null {
  const flags = parseFlags(rest, CLEAR_FLAGS);
  if (!flags) {
    return null;
  }
  const { '--ticket': ticket, '--blocked-by': blockedBy, '--commit': commit } = flags;
  if (!isValidTicket(ticket) || !isValidTicket(blockedBy) || !commit) {
    return null;
  }
  return { command: 'clear', ticket: ticket.toUpperCase(), blockedBy: blockedBy.toUpperCase(), commit };
}

function parseListArgs(rest: string[]): ListArgs | null {
  const flags = parseFlags(rest, LIST_FLAGS);
  return flags ? { command: 'list' } : null;
}

export function parseArgs(argv: string[]): QaSiblingCheckArgs | null {
  const [command, ...rest] = argv;
  if (command === 'status') {
    return parseStatusArgs(rest);
  }
  if (command === 'defer') {
    return parseDeferArgs(rest);
  }
  if (command === 'clear') {
    return parseClearArgs(rest);
  }
  if (command === 'list') {
    return parseListArgs(rest);
  }
  return null;
}

const USAGE =
  'Usage: qa-sibling-check.js status --ticket <id>\n' +
  '       qa-sibling-check.js defer --ticket <id> --blocked-by <id> --class <failureClass> --check "<command>" --commit <hex>\n' +
  '       qa-sibling-check.js clear --ticket <id> --blocked-by <id> --commit <hex>\n' +
  '       qa-sibling-check.js list\n' +
  `  --class: ${KNOWN_FAILURE_CLASSES.join('|')}\n`;

function printReleasableLines(report: { ticket: string; closedBlockers: { blockedBy: string; closedAt: string }[] }): void {
  for (const blocker of report.closedBlockers) {
    console.log(`RELEASABLE ${report.ticket} BLOCKED_BY ${blocker.blockedBy} CLOSED_AT ${blocker.closedAt}`);
  }
}

function runStatus(mainWorktreePath: string, args: StatusArgs): void {
  const report = computeTicketDeferralStatus(mainWorktreePath, args.ticket);
  if (report.kind === 'verify') {
    console.log(`VERIFY ${args.ticket}`);
    process.exitCode = 0;
    return;
  }
  if (report.kind === 'releasable') {
    printReleasableLines(report);
    process.exitCode = 4;
    return;
  }
  // report.kind === 'deferred': at least one blocker's ticket is still open.
  for (const blocker of report.openBlockers) {
    console.log(`DEFERRED ${args.ticket} BLOCKED_BY ${blocker.blockedBy} CHECK ${blocker.check}`);
  }
  process.exitCode = 3;
}

function runDefer(mainWorktreePath: string, args: DeferArgs): void {
  if (checkReadsBlockerActivePath(args.check, args.blockedBy)) {
    process.stderr.write(
      `REFUSED: --check reads ${args.blockedBy}'s own path under backlog/active/ - closing ${args.blockedBy} ` +
        `moves that file to backlog/done/, so the recorded check would stop being runnable at exactly the ` +
        `moment it should release ${args.ticket}. Record a check that does not depend on ${args.blockedBy}'s ticket path.\n`
    );
    process.exitCode = 4;
    return;
  }
  const record: SiblingDeferralRecord = {
    ticket: args.ticket,
    blockedBy: args.blockedBy,
    action: 'defer',
    failureClass: args.failureClass,
    check: args.check,
    commit: args.commit,
    at: new Date().toISOString(),
  };
  const recorded = appendSiblingDeferralRecordIfNew(mainWorktreePath, record);
  printJsonToStdout({ recorded });
}

function runList(mainWorktreePath: string): void {
  const stranded = listStrandedDeferrals(mainWorktreePath);
  if (stranded.length === 0) {
    console.log('NONE');
    process.exitCode = 0;
    return;
  }
  for (const report of stranded) {
    printReleasableLines(report);
  }
  process.exitCode = 4;
}

function runClear(mainWorktreePath: string, args: ClearArgs): void {
  const record: SiblingDeferralRecord = {
    ticket: args.ticket,
    blockedBy: args.blockedBy,
    action: 'clear',
    commit: args.commit,
    at: new Date().toISOString(),
  };
  const recorded = appendSiblingDeferralRecordIfNew(mainWorktreePath, record);
  printJsonToStdout({ recorded });
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }
  const { mainWorktreePath } = resolveCliMainWorktreeContext();
  if (args.command === 'status') {
    runStatus(mainWorktreePath, args);
  } else if (args.command === 'defer') {
    runDefer(mainWorktreePath, args);
  } else if (args.command === 'clear') {
    runClear(mainWorktreePath, args);
  } else {
    runList(mainWorktreePath);
  }
}

if (require.main === module) {
  runCliMain(main);
}
