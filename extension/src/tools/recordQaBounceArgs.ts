/**
 * BL-608: flag parsing and validation for record-qa-bounce CLI.
 */
import {
  isKnownBouncingRole,
  isKnownFailureClass,
  isKnownProducingRole,
  isKnownTicketType,
  QaBounceBouncingRole,
  QaBounceRecord,
} from '../quality/qaBounce';

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
  // Optional: present-but-invalid is a usage error; absent is fine.
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

export const USAGE =
  'Usage: record-qa-bounce.js --ticket <id> --role <producingRole> --type <ticketType> --class <failureClass>\n' +
  '         --commit <hex> [--by <bouncingRole> --evidence <path>]\n' +
  `  --role: coder|cleaner|architect|hardender|documenter\n` +
  `  --type: feature|bug|defect|chore|docs|enhancement|epic\n` +
  `  --class: compile|unit|integration|acceptance|behavior\n` +
  `  --by (optional): QA\n` +
  `  --evidence (optional): backlog/evidence/<file>.md\n`;
