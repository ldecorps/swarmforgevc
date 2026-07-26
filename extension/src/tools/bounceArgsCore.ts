/**
 * BL-635 cleanup: the flag-parsing/validation core shared by
 * record-qa-bounce.js (BL-608, QA-only, locked contract) and
 * record-bounce.js (BL-635, the generalised any-role recorder). Both CLIs
 * accept the identical flag grammar and the identical five required fields
 * (ticket/role/type/class/commit); only the `by` field's requiredness and
 * valid vocabulary differ between them, so `by` validation stays in each
 * CLI's own args module while everything else lives here once.
 */
import { isKnownFailureClass, isKnownProducingRole, isKnownTicketType, QaBounceFailureClass, QaBounceProducingRole, QaBounceTicketType } from '../quality/qaBounce';

export const FLAG_NAMES = ['--ticket', '--role', '--type', '--class', '--commit', '--by', '--evidence'] as const;
export type FlagName = (typeof FLAG_NAMES)[number];

const TICKET_PATTERN = /^BL-\d+$/i;
const EVIDENCE_PATTERN = /^backlog\/evidence\/[^/]+\.md$/;

// Pure - parses `--flag value` pairs (any order) into a lookup, or null on
// any unrecognized flag / a flag with no following value.
export function parseFlags(argv: string[]): Partial<Record<FlagName, string>> | null {
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

export function isValid<T extends string>(value: string | undefined, predicate: (v: string) => v is T): value is T {
  return !!value && predicate(value);
}

function isValidTicket(value: string | undefined): value is string {
  return !!value && TICKET_PATTERN.test(value);
}

export function isValidEvidence(value: string | undefined): value is string {
  return !!value && EVIDENCE_PATTERN.test(value);
}

export interface CoreBounceFields {
  ticket: string;
  producingRole: QaBounceProducingRole;
  ticketType: QaBounceTicketType;
  failureClass: QaBounceFailureClass;
  commit: string;
}

// The five fields both CLIs require identically. `by` is deliberately NOT
// here: recordQaBounceArgs.ts keeps it QA-only/optional while
// recordBounceArgs.ts makes it required over the full pipeline vocabulary,
// so each validates it in its own file.
export function validatedCoreFields(flags: Partial<Record<FlagName, string>>): CoreBounceFields | null {
  const { '--ticket': ticket, '--role': producingRole, '--type': ticketType, '--class': failureClass, '--commit': commit } = flags;
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
  return { ticket: ticket.toUpperCase(), producingRole, ticketType, failureClass, commit };
}
