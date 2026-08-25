// BL-1045: how long a ticket has been in backlog/hold/, derived from GIT.
//
// Not file mtime: it is rewritten by clones, worktree operations and
// checkouts, and this repo has already been bitten by trusting it. A ticket
// parked twelve days ago would read as parked today after any of them - which
// would defeat the one fact this section exists to show. The commit that
// ADDED the file at its hold/ path is what does not move.
//
// Split into a pure query builder, a pure parser, and a thin runner taking an
// injected git seam, so the whole derivation is testable without a repository.

const HOLD_DIR = 'backlog/hold';

/** A bare filename only: no separators, no traversal, no empties. */
function assertPlainFilename(filename: string): void {
  if (!filename.trim() || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new Error(`heldSince: "${filename}" is not a plain filename inside ${HOLD_DIR}`);
  }
}

export function heldSinceGitArgs(filename: string): string[] {
  assertPlainFilename(filename);
  // --diff-filter=A with no rename detection: the park moves active/ -> hold/,
  // which reads as an ADD at the hold/ path. That is exactly the instant the
  // hold began, and it survives every later edit to the file.
  return ['log', '--diff-filter=A', '--format=%at', '-1', '--', `${HOLD_DIR}/${filename}`];
}

/**
 * The first epoch-seconds line of git's output as epoch ms. Anything that is
 * not a positive integer - no output, a blank line, an error string - is
 * undefined, which the board renders as "age unknown" rather than as a guessed
 * date. Absence must never read as "parked just now".
 */
export function parseHeldSinceMs(stdout: string): number | undefined {
  const first = stdout.split('\n').map((line) => line.trim()).find((line) => line.length > 0);
  if (first === undefined || !/^[0-9]+$/.test(first)) {
    return undefined;
  }
  const seconds = Number.parseInt(first, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

export type HeldSinceGitRunner = (args: string[]) => string;

/**
 * Best effort by design: a repository without history, a file that git has
 * never seen, or git being unavailable leaves the age unknown. A board that
 * refused to render because one hold date could not be resolved would be
 * strictly worse than the invisibility this ticket is fixing.
 */
export function readHeldSinceMsFor(filename: string, runGit: HeldSinceGitRunner): number | undefined {
  try {
    return parseHeldSinceMs(runGit(heldSinceGitArgs(filename)));
  } catch {
    return undefined;
  }
}
