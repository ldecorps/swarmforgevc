/**
 * BL-635: flag parsing and validation for the generalised record-bounce
 * CLI. Same contract as recordQaBounceArgs.ts (BL-608) except `--by` is now
 * REQUIRED (a usage error, nothing written, if absent) and validated
 * against the full pipeline role vocabulary (KNOWN_BOUNCE_ROLES) instead of
 * QA alone - every reviewing stage records its own send-backs now.
 * BL-635 cleanup: the flag grammar and the five core fields
 * (ticket/role/type/class/commit) are shared with recordQaBounceArgs.ts via
 * bounceArgsCore.ts - only `by` (required, wider vocabulary here) is
 * validated locally.
 */
import { isKnownBounceRole, BounceRecord, BounceRole } from '../quality/qaBounce';
import { FlagName, isValid, isValidEvidence, parseFlags, validatedCoreFields } from './bounceArgsCore';

export interface RecordBounceArgs extends Omit<BounceRecord, 'at' | 'by'> {
  by: BounceRole;
  evidence?: string;
}

type RequiredFields = Omit<RecordBounceArgs, 'evidence'>;

function validatedRequiredFields(flags: Partial<Record<FlagName, string>>): RequiredFields | null {
  const core = validatedCoreFields(flags);
  if (!core) {
    return null;
  }
  const { '--by': by } = flags;
  if (!isValid(by, isKnownBounceRole)) {
    return null;
  }
  return { ...core, by };
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
  `  --class: compile|unit|integration|acceptance|behavior|invariant-unencoded|spec-gap\n` +
  `  --by (required): specifier|coder|cleaner|architect|hardender|documenter|QA\n` +
  `  --evidence (optional): backlog/evidence/<file>.md\n`;
