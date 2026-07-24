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
 * BL-608: also best-effort merges a matching `bounce_history:` entry onto
 * the ticket's OWN backlog/active/<id>-*.yaml record, in the CURRENT
 * worktree (never the specifier/coordinator's main checkout the JSONL write
 * uses) - the caller commits the YAML edit alongside its evidence file, so
 * it rides the normal merge chain to main. This is deliberately best-effort:
 * a missing/unwritable/unparseable ticket record never fails the bounce.
 *
 * `--by`/`--evidence` are OPTIONAL flags, deliberately: the live
 * swarmforge/roles/QA.prompt invocation still calls this CLI with only the
 * original five flags until the documenter lands the two-flag addition
 * there. Omitting either (or both) keeps the original BL-454 behavior
 * exactly (the JSONL append), and simply skips the ticket-record merge -
 * never a usage error, never a functional regression for the existing
 * wired caller.
 *
 * Usage: node record-qa-bounce.js --ticket <id> --role <producingRole>
 *          --type <ticketType> --class <failureClass> --commit <hex>
 *          [--by <bouncingRole> --evidence <path>]
 * Flag contract matches swarmforge/roles/QA.prompt's own caller exactly.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  isKnownBouncingRole,
  isKnownFailureClass,
  isKnownProducingRole,
  isKnownTicketType,
  QaBounceBouncingRole,
  QaBounceRecord,
} from '../quality/qaBounce';
import { appendQaBounceRecordIfNew } from '../metrics/qaBounceStore';
import { BounceHistoryEntry, mergeBounceHistoryEntry } from '../quality/bounceHistory';
import { makeArgsGuardedMain, printJsonToStdout, resolveCliMainWorktreeContext, runCliMain } from './swarm-metrics';

const TICKET_PATTERN = /^BL-\d+$/i;
const EVIDENCE_PATTERN = /^backlog\/evidence\/[^/]+\.md$/;

const FLAG_NAMES = ['--ticket', '--role', '--type', '--class', '--commit', '--by', '--evidence'] as const;
type FlagName = (typeof FLAG_NAMES)[number];

export interface RecordQaBounceArgs extends Omit<QaBounceRecord, 'at'> {
  by?: QaBounceBouncingRole;
  evidence?: string;
}

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

// Present AND passes the closed-set predicate - split out (as a genuine type
// predicate, so callers keep TS's narrowing) so validatedFields below doesn't
// repeat the same "!value || !predicate(value)" clause five times, keeping
// its own branch count at or below the project's CRAP threshold.
function isValid<T extends string>(value: string | undefined, predicate: (v: string) => v is T): value is T {
  return !!value && predicate(value);
}

function isValidTicket(value: string | undefined): value is string {
  return !!value && TICKET_PATTERN.test(value);
}

function isValidEvidence(value: string | undefined): value is string {
  return !!value && EVIDENCE_PATTERN.test(value);
}

function validatedFields(flags: Partial<Record<FlagName, string>>): RecordQaBounceArgs | null {
  const {
    '--ticket': ticket,
    '--role': producingRole,
    '--type': ticketType,
    '--class': failureClass,
    '--commit': commit,
    '--by': by,
    '--evidence': evidence,
  } = flags;
  if (!isValidTicket(ticket)) {
    return null;
  }
  if (!isValid(producingRole, isKnownProducingRole)) {
    return null;
  }
  if (!isValid(ticketType, isKnownTicketType)) {
    return null;
  }
  if (!isValid(failureClass, isKnownFailureClass)) {
    return null;
  }
  if (!commit) {
    return null;
  }
  // Optional: present-but-invalid is a usage error (still validated against
  // the closed set / path shape); absent is fine - see the file header.
  if (by !== undefined && !isValid(by, isKnownBouncingRole)) {
    return null;
  }
  if (evidence !== undefined && !isValidEvidence(evidence)) {
    return null;
  }
  return { ticket: ticket.toUpperCase(), producingRole, ticketType, failureClass, commit, by, evidence };
}

export function parseArgs(argv: string[]): RecordQaBounceArgs | null {
  const flags = parseFlags(argv);
  return flags ? validatedFields(flags) : null;
}

const USAGE =
  'Usage: record-qa-bounce.js --ticket <id> --role <producingRole> --type <ticketType> --class <failureClass>\n' +
  '         --commit <hex> [--by <bouncingRole> --evidence <path>]\n' +
  `  --role: coder|cleaner|architect|hardender|documenter\n` +
  `  --type: feature|bug|defect|chore|docs|enhancement|epic\n` +
  `  --class: compile|unit|integration|acceptance|behavior\n` +
  `  --by (optional): QA\n` +
  `  --evidence (optional): backlog/evidence/<file>.md\n`;

// Locates the ticket's own backlog/active/<TICKET>-*.yaml in the CURRENT
// worktree - never a glob into another worktree's checkout.
function findActiveTicketYamlPath(projectRoot: string, ticket: string): string | null {
  const activeDir = path.join(projectRoot, 'backlog', 'active');
  let files: string[];
  try {
    files = fs.readdirSync(activeDir);
  } catch {
    return null;
  }
  const match = files.find((f) => f.startsWith(`${ticket}-`) && f.endsWith('.yaml'));
  return match ? path.join(activeDir, match) : null;
}

// Best-effort, never blocking (BL-608 shape #6): any failure to find, read,
// merge, or write the ticket's own record is reported as a reason, never
// thrown.
function updateTicketBounceHistory(
  projectRoot: string,
  ticket: string,
  entry: BounceHistoryEntry
): { updated: boolean; reason: string } {
  try {
    const ticketPath = findActiveTicketYamlPath(projectRoot, ticket);
    if (!ticketPath) {
      return { updated: false, reason: 'not-found' };
    }
    const text = fs.readFileSync(ticketPath, 'utf8');
    const result = mergeBounceHistoryEntry(text, entry);
    if (!result.updated) {
      return { updated: false, reason: result.reason };
    }
    fs.writeFileSync(ticketPath, result.text, 'utf8');
    return { updated: true, reason: result.reason };
  } catch (error) {
    return { updated: false, reason: error instanceof Error ? error.message : 'unknown-error' };
  }
}

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
