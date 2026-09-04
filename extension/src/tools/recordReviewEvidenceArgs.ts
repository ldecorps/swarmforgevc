/**
 * BL-1362: argument parsing for record-review-evidence, split out so the CLI's
 * own main() stays the thin wrapper the engineering rules ask for and the
 * parsing is testable with no process at all.
 */
import { EvidenceItem } from './reviewEvidenceRecord';

export interface RecordReviewEvidenceArgs {
  ticket: string;
  role: string;
  none: boolean;
  items: EvidenceItem[];
  /** Optional override, so a test pins the date without stubbing the clock. */
  date?: string;
}

export const USAGE = `Usage:
  record-review-evidence.js --ticket <BL-id> --role <reviewing role> --none
  record-review-evidence.js --ticket <BL-id> --role <reviewing role> \\
      --item '{"command":"...","commit":"...","excerpt":"...","class":"unit",
               "expected":"...","blamed":"...","remediation":"..."}' [--item ...]

Records one Article 4.4 evidence file under backlog/evidence/, commits THAT
path alone, and prints the commit for the role to forward (BL-536).

The verdict is yours: --none records an explicit clean sweep, one or more
--item flags record the inventory D1..Dn. Supplying neither is refused - a
pass with no verdict is not finished, and the review-forward evidence gate
would refuse the forward anyway.
`;

// Split out of parseArgs (BL-1362 hardener, CRAP): --item's own two-branch
// validation (unparseable JSON, or parseable but not an object) was folded
// into the main argv loop, pushing its cyclomatic complexity to 13 - a
// SINGLE-return helper carries that branching on its own, complexity 3, and
// leaves the loop's own dispatch smaller as a side effect.
function parseItemFlag(value: string): EvidenceItem | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  return parsed as EvidenceItem;
}

interface RawFlag {
  flag: string;
  value: string;
}

// The TOKENIZING half: walk argv into `--none` plus an ordered {flag,value}
// list, refusing a flag with nothing after it. Knows nothing about which
// flags are valid - that is applyFlag's question, below - so this stays a
// three-branch loop regardless of how many flags the CLI ever grows to.
function collectFlags(argv: string[]): { none: boolean; pairs: RawFlag[] } | null {
  let none = false;
  const pairs: RawFlag[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--none') {
      none = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) {
      return null;
    }
    i += 1;
    pairs.push({ flag, value });
  }
  return { none, pairs };
}

// The APPLYING half: one recognized flag, mutating the builder in place.
// Returns false on an unrecognized flag or an --item that failed its own
// validation - the caller treats either as "parseArgs refuses", uniformly.
function applyFlag(builder: RecordReviewEvidenceArgs, flag: string, value: string): boolean {
  if (flag === '--ticket') builder.ticket = value;
  else if (flag === '--role') builder.role = value;
  else if (flag === '--date') builder.date = value;
  else if (flag === '--item') {
    const item = parseItemFlag(value);
    if (!item) return false;
    builder.items.push(item);
  } else return false;
  return true;
}

export function parseArgs(argv: string[]): RecordReviewEvidenceArgs | null {
  const collected = collectFlags(argv);
  if (!collected) return null;

  const builder: RecordReviewEvidenceArgs = { ticket: '', role: '', none: collected.none, items: [], date: undefined };
  for (const { flag, value } of collected.pairs) {
    if (!applyFlag(builder, flag, value)) return null;
  }

  if (!builder.ticket || !builder.role) {
    return null;
  }
  return builder;
}
