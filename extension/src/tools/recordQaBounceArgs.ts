/**
 * BL-608: flag parsing and validation for record-qa-bounce CLI.
 * BL-635 cleanup: the flag grammar and the five core fields
 * (ticket/role/type/class/commit) are identical to recordBounceArgs.ts's own
 * contract, so that shared logic now lives once in bounceArgsCore.ts. Only
 * `by` (optional, QA-only here) and `evidence` stay local, since `by` is the
 * one field the two CLIs genuinely disagree on.
 */
import { isKnownBouncingRole, QaBounceBouncingRole, QaBounceRecord } from '../quality/qaBounce';
import { FlagName, isValid, isValidEvidence, parseFlags, validatedCoreFields } from './bounceArgsCore';

export interface RecordQaBounceArgs extends Omit<QaBounceRecord, 'at'> {
  by?: QaBounceBouncingRole;
  evidence?: string;
}

type OptionalFields = Pick<RecordQaBounceArgs, 'by' | 'evidence'>;

// Optional: present-but-invalid is a usage error; absent is fine.
function validatedOptionalFields(flags: Partial<Record<FlagName, string>>): OptionalFields | null {
  const { '--by': by, '--evidence': evidence } = flags;
  if (by !== undefined && !isValid(by, isKnownBouncingRole)) {
    return null;
  }
  if (evidence !== undefined && !isValidEvidence(evidence)) {
    return null;
  }
  return { by, evidence };
}

function validatedFields(flags: Partial<Record<FlagName, string>>): RecordQaBounceArgs | null {
  const required = validatedCoreFields(flags);
  if (!required) {
    return null;
  }
  const optional = validatedOptionalFields(flags);
  if (!optional) {
    return null;
  }
  return { ...required, ...optional };
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
