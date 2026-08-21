/**
 * BL-990: flag parsing and validation for the bounce-correction CLI.
 *
 * Deliberately its OWN flag grammar rather than an extra verb bolted onto
 * recordBounceArgs.ts: a correction names a bounce (ticket + commit) and
 * explains itself, and shares none of the recorder's attribution fields.
 * Folding it in would have meant every one of those fields becoming
 * conditionally-required, which is exactly the shape that lets a
 * half-specified call through.
 *
 * `--reason` is REQUIRED and must be non-blank. An unexplained retraction is
 * indistinguishable from metric-gaming and this store feeds a live
 * experiment, so a reasonless call is a usage error that writes nothing.
 */
import { BounceRole, KNOWN_BOUNCE_ROLES, isKnownBounceRole } from '../quality/qaBounce';

const FLAG_NAMES = ['--ticket', '--commit', '--reason', '--by', '--evidence'] as const;
type FlagName = (typeof FLAG_NAMES)[number];

export interface RecordBounceCorrectionArgs {
  ticket: string;
  commit: string;
  reason: string;
  by: BounceRole;
  evidence?: string;
}

// Same posture as bounceArgsCore's parseFlagPairs: an unrecognized flag, or
// a flag with no value, is a usage error rather than something silently
// ignored - a typo'd flag must never look like a successful call.
function parseFlagPairs(argv: string[]): Partial<Record<FlagName, string>> | null {
  const flags: Partial<Record<FlagName, string>> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i] as FlagName;
    const value = argv[i + 1];
    if (!FLAG_NAMES.includes(name) || value === undefined) {
      return null;
    }
    flags[name] = value;
  }
  return flags;
}

function isNonBlank(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseArgs(argv: string[]): RecordBounceCorrectionArgs | null {
  const flags = parseFlagPairs(argv);
  if (!flags) {
    return null;
  }
  const { '--ticket': ticket, '--commit': commit, '--reason': reason, '--by': by, '--evidence': evidence } = flags;
  if (!isNonBlank(ticket) || !isNonBlank(commit) || !isNonBlank(reason) || !isNonBlank(by)) {
    return null;
  }
  if (!isKnownBounceRole(by)) {
    return null;
  }
  if (evidence !== undefined && !isNonBlank(evidence)) {
    return null;
  }
  return {
    ticket,
    commit,
    reason: reason.trim(),
    by,
    ...(evidence === undefined ? {} : { evidence }),
  };
}

export const USAGE =
  'Usage: record-bounce-correction.js --ticket <id> --commit <hex> --reason <text>\n' +
  '         --by <role> [--evidence <path>]\n' +
  '  Supersedes a recorded bounce whose attribution was wrong. Append-only:\n' +
  '  the original line is never edited or deleted, and every consumer of the\n' +
  '  store stops counting it against the role it named.\n' +
  `  --by (required): ${KNOWN_BOUNCE_ROLES.join('|')}\n` +
  '  --reason (required, non-blank): why the attribution was wrong\n' +
  '  --evidence (optional): backlog/evidence/<file>.md\n';
