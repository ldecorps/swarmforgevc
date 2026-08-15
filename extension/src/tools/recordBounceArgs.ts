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
import { BounceInventoryItem, BounceRecord, BounceRole, KNOWN_FAILURE_CLASSES, isKnownBounceRole, isValidBounceInventoryItem } from '../quality/qaBounce';
import { FLAG_NAMES, isValid, isValidEvidence, parseFlagPairs, validatedCoreFields } from './bounceArgsCore';

// BL-689: --items/--blocked are LOCAL to this CLI's own flag grammar, never
// added to bounceArgsCore.ts's shared FLAG_NAMES/parseFlags - those are also
// used by recordQaBounceArgs.ts (the legacy record-qa-bounce.js CLI, left
// untouched by this ticket). Widening the shared list would have silently
// changed that CLI's own contract too (an unrecognized flag it used to
// reject as a usage error would start being accepted and ignored).
const RECORD_BOUNCE_FLAG_NAMES = [...FLAG_NAMES, '--items', '--blocked'] as const;
type RecordBounceFlagName = (typeof RECORD_BOUNCE_FLAG_NAMES)[number];

export type BounceInventoryDegradeReason = 'unparseable' | 'empty' | 'invalid-item';

export type BounceInventoryResolution =
  | { kind: 'none' }
  | { kind: 'ok'; items: BounceInventoryItem[] }
  | { kind: 'degraded'; reason: BounceInventoryDegradeReason };

// BL-689: pure, never throws - malformed JSON, a non-array, an empty array,
// or an item that fails the closed-set item validator all resolve to a
// named degrade reason rather than propagating an exception into main()
// (engineering.prompt Guardrails: an optional JSON flag must catch its own
// parse errors). Absent --items entirely is 'none', distinct from every
// degrade reason - a call that never asked for an inventory is not a
// rejected one.
export function resolveBounceInventory(raw: string | undefined): BounceInventoryResolution {
  if (raw === undefined) {
    return { kind: 'none' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'degraded', reason: 'unparseable' };
  }
  if (!Array.isArray(parsed)) {
    return { kind: 'degraded', reason: 'invalid-item' };
  }
  if (parsed.length === 0) {
    return { kind: 'degraded', reason: 'empty' };
  }
  if (!parsed.every(isValidBounceInventoryItem)) {
    return { kind: 'degraded', reason: 'invalid-item' };
  }
  return { kind: 'ok', items: parsed };
}

// BL-689: --blocked is metadata about the inventory, so an absent or
// malformed value (never negative, never non-integer) degrades to 0 rather
// than rejecting the whole invocation - the same "never lose the bounce"
// posture as --items, for a flag whose only job is a count.
export function resolveBlockedCount(raw: string | undefined): number {
  if (raw === undefined) {
    return 0;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export interface RecordBounceArgs extends Omit<BounceRecord, 'at' | 'by' | 'items' | 'blocked'> {
  by: BounceRole;
  evidence?: string;
  inventory: BounceInventoryResolution;
  blocked: number;
}

type RequiredFields = Omit<RecordBounceArgs, 'evidence' | 'inventory' | 'blocked'>;

function validatedRequiredFields(flags: Partial<Record<RecordBounceFlagName, string>>): RequiredFields | null {
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

// evidence is the only field whose PRESENCE gates a usage error - a
// malformed --items/--blocked never does (resolved separately below into a
// degrade reason, per BL-689's "never lose the bounce" posture).
function validatedFields(flags: Partial<Record<RecordBounceFlagName, string>>): RecordBounceArgs | null {
  const required = validatedRequiredFields(flags);
  if (!required) {
    return null;
  }
  const { '--evidence': evidence, '--items': items, '--blocked': blocked } = flags;
  if (evidence !== undefined && !isValidEvidence(evidence)) {
    return null;
  }
  return { ...required, evidence, inventory: resolveBounceInventory(items), blocked: resolveBlockedCount(blocked) };
}

export function parseArgs(argv: string[]): RecordBounceArgs | null {
  const flags = parseFlagPairs(argv, RECORD_BOUNCE_FLAG_NAMES);
  return flags ? validatedFields(flags) : null;
}

export const USAGE =
  'Usage: record-bounce.js --ticket <id> --role <producingRole> --type <ticketType> --class <failureClass>\n' +
  '         --commit <hex> --by <bouncingRole> [--evidence <path>] [--items <json>] [--blocked <n>]\n' +
  `  --role: coder|cleaner|architect|hardender|documenter\n` +
  `  --type: feature|bug|defect|chore|docs|enhancement|epic\n` +
  `  --class: ${KNOWN_FAILURE_CLASSES.join('|')}\n` +
  `  --by (required): specifier|coder|cleaner|architect|hardender|documenter|QA\n` +
  `  --evidence (optional): backlog/evidence/<file>.md\n` +
  `  --items (optional): JSON array of {id, class, blamed, pointer} - a malformed value degrades\n` +
  `                       to the single-item bounce (never lost), printing a degrade reason\n` +
  `  --blocked (optional, default 0): number of checks this pass could not run\n`;
