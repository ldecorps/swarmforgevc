/**
 * BL-1015 — measuring a proposal against the declared envelope. Pure policy:
 * no filesystem, no subprocess. Split out of `boyScoutRun.ts` (BL-485
 * mutation-site size); the line-diffing itself lives in `./lineDiff` (BL-485
 * again — the LCS algorithm is a separate concern from envelope policy).
 */

import type { Envelope, EnvelopeDimension, FileEdit } from './types';
import type { CurrentContent } from './types';
import { countChangedLines } from './lineDiff';

export { countChangedLines } from './lineDiff';

/**
 * Every dimension that blew, not just the first — a report naming only "too
 * many files" for a cleanup that is also four times too long would send the
 * reader off to fix the wrong half.
 *
 * The limit is INCLUSIVE: exactly 3 files and exactly 120 lines is inside the
 * envelope (feature scenario 02 pins that boundary from both sides).
 */
export function exceedsEnvelope(measured: Envelope, envelope: Envelope): EnvelopeDimension[] {
  const over: EnvelopeDimension[] = [];
  if (measured.files > envelope.files) over.push('files');
  if (measured.lines > envelope.lines) over.push('lines');
  return over;
}

/**
 * One edit per path, last one winning. A proposal that names the same file
 * twice describes ONE changed file, and counting it twice would refuse a
 * cleanup that git would call well inside the envelope.
 */
export function normalizeEdits(edits: FileEdit[]): FileEdit[] {
  const byPath = new Map<string, FileEdit>();
  for (const edit of edits) byPath.set(edit.path, edit);
  return [...byPath.values()];
}

/**
 * The size the repository would actually record. An edit that changes nothing
 * is not a changed file — including it would let a proposal pad its file count
 * with no-ops, or report "cleaned" for a run that changed nothing.
 */
export function measureProposal(edits: FileEdit[], currentOf: CurrentContent): Envelope {
  let files = 0;
  let lines = 0;
  for (const edit of normalizeEdits(edits)) {
    const changed = countChangedLines(currentOf(edit.path), edit.after);
    if (changed === 0) continue;
    files += 1;
    lines += changed;
  }
  return { files, lines };
}
