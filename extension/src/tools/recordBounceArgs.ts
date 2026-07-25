/**
 * BL-635: flag parsing and validation for the generalised record-bounce
 * CLI. Same contract as recordQaBounceArgs.ts (BL-608) except `--by` is now
 * REQUIRED (a usage error, nothing written, if absent) and validated
 * against the full pipeline role vocabulary (KNOWN_BOUNCE_ROLES) instead of
 * QA alone - every reviewing stage records its own send-backs now.
 */
import {
  isKnownBounceRole,
  isKnownFailureClass,
  isKnownProducingRole,
  isKnownTicketType,
  BounceRecord,
  BounceRole,
} from '../quality/qaBounce';

const TICKET_PATTERN = /^BL-\d+$/i;
const EVIDENCE_PATTERN = /^backlog\/evidence\/[^/]+\.md$/;

const FLAG_NAMES = ['--ticket', '--role', '--type', '--class', '--commit', '--by', '--evidence'] as const;
type FlagName = (typeof FLAG_NAMES)[number];

export interface RecordBounceArgs extends Omit<BounceRecord, 'at' | 'by'> {
  by: BounceRole;
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

type RequiredFields = Omit<RecordBounceArgs, 'evidence'>;

function validatedRequiredFields(flags: Partial<Record<FlagName, string>>): RequiredFields | null {
  const {
    '--ticket': ticket,
    '--role': producingRole,
    '--type': ticketType,
    '--class': failureClass,
    '--commit': commit,
    '--by': by,
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
  if (!isValid(by, isKnownBounceRole)) {
    return null;
  }
  return { ticket: ticket.toUpperCase(), producingRole, ticketType, failureClass, commit, by };
}

// evidence is the only optional field; present-but-invalid is a usage
// error, absent is fine.
function validatedFields(flags: Partial<Record<FlagName, string>>): RecordBounceArgs | null {
  const required = validatedRequiredFields(flags);
  if (!required) {
    return null;
  }
  const { '--evidence': evidence } = flags;
  if (evidence !== undefined && !isValidEvidence(evidence)) {
    return null;
  }
  return { ...required, evidence };
}

export function parseArgs(argv: string[]): RecordBounceArgs | null {
  const flags = parseFlags(argv);
  return flags ? validatedFields(flags) : null;
}

export const USAGE =
  'Usage: record-bounce.js --ticket <id> --role <producingRole> --type <ticketType> --class <failureClass>\n' +
  '         --commit <hex> --by <bouncingRole> [--evidence <path>]\n' +
  `  --role: coder|cleaner|architect|hardender|documenter\n` +
  `  --type: feature|bug|defect|chore|docs|enhancement|epic\n` +
  `  --class: compile|unit|integration|acceptance|behavior\n` +
  `  --by (required): specifier|coder|cleaner|architect|hardender|documenter|QA\n` +
  `  --evidence (optional): backlog/evidence/<file>.md\n`;
