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
 *     exit 3  DEFERRED <ticket> BLOCKED_BY <blocker> CHECK <command>   (one line per open blocker)
 *   node qa-sibling-check.js defer --ticket <id> --blocked-by <id> --class <failureClass> --check "<command>" --commit <10-hex>
 *   node qa-sibling-check.js clear --ticket <id> --blocked-by <id> --commit <10-hex>
 *
 * Exit 2 is reserved for usage errors, so a caller can tell "deferred" from
 * "you typed it wrong". The tool never EXECUTES a recorded blocker command -
 * it is read from the store and printed for QA to re-run itself; executing
 * it would turn a data store into an arbitrary-command sink.
 */
import { isKnownFailureClass, decideDisposition, openBlockersForTicket, QaBounceFailureClass, SiblingDeferralRecord } from '../quality/siblingDeferral';
import { appendSiblingDeferralRecordIfNew, readSiblingDeferralRecords } from '../metrics/siblingDeferralStore';
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

export type QaSiblingCheckArgs = StatusArgs | DeferArgs | ClearArgs;

const STATUS_FLAGS = ['--ticket'] as const;
const DEFER_FLAGS = ['--ticket', '--blocked-by', '--class', '--check', '--commit'] as const;
const CLEAR_FLAGS = ['--ticket', '--blocked-by', '--commit'] as const;

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
  return null;
}

const USAGE =
  'Usage: qa-sibling-check.js status --ticket <id>\n' +
  '       qa-sibling-check.js defer --ticket <id> --blocked-by <id> --class <failureClass> --check "<command>" --commit <hex>\n' +
  '       qa-sibling-check.js clear --ticket <id> --blocked-by <id> --commit <hex>\n' +
  '  --class: compile|unit|integration|acceptance|behavior\n';

function runStatus(mainWorktreePath: string, args: StatusArgs): void {
  const records = readSiblingDeferralRecords(mainWorktreePath);
  const openBlockers = openBlockersForTicket(records, args.ticket);
  const disposition = decideDisposition(openBlockers, null);
  if (disposition.kind === 'verify') {
    console.log(`VERIFY ${args.ticket}`);
    process.exitCode = 0;
    return;
  }
  // decideDisposition is only ever called here with no observed failure, so
  // it can only return 'verify' (handled above) or 'defer' - 'bounce' needs
  // an observedFailure, which status never supplies.
  //
  // hardener note: a mutant forcing this condition to `true` is an accepted-
  // equivalent - 'verify' already returned above, and decideDisposition
  // cannot produce 'bounce' without an observedFailure (see its own
  // `if (!observedFailure) return { kind: 'defer', ... }` branch), so by this
  // line `disposition.kind` is already 'defer' on every reachable path. No
  // input reaches an externally observable difference (BL-234 precedent).
  if (disposition.kind === 'defer') {
    for (const blocker of disposition.blockers) {
      console.log(`DEFERRED ${args.ticket} BLOCKED_BY ${blocker.blockedBy} CHECK ${blocker.check}`);
    }
    process.exitCode = 3;
  }
}

function runDefer(mainWorktreePath: string, args: DeferArgs): void {
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
  } else {
    runClear(mainWorktreePath, args);
  }
}

if (require.main === module) {
  runCliMain(main);
}
