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

export function parseArgs(argv: string[]): RecordReviewEvidenceArgs | null {
  let ticket = '';
  let role = '';
  let none = false;
  let date: string | undefined;
  const items: EvidenceItem[] = [];

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
    if (flag === '--ticket') ticket = value;
    else if (flag === '--role') role = value;
    else if (flag === '--date') date = value;
    else if (flag === '--item') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return null;
      }
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      items.push(parsed as EvidenceItem);
    } else return null;
  }

  if (!ticket || !role) {
    return null;
  }
  return { ticket, role, none, items, date };
}
