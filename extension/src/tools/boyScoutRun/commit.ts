/**
 * BL-1015 — committing exactly the paths a run edited, and the message that
 * explains why. Split out of `boyScoutRun.ts` (BL-485 mutation-site size).
 */

import { defaultGateSpawn } from './gates';
import type { Envelope, GateResult, GateSpawn } from './types';

/**
 * The paths among `paths` that git does not already track — the only ones that
 * have to be staged before a partial commit can name them.
 *
 * `-z` because git quotes paths with unusual characters in its default output
 * and a quoted name would never match the path we asked about, which would
 * silently reclassify a tracked file as created.
 */
function untrackedAmong(root: string, paths: string[], spawn: GateSpawn): string[] {
  const listed = spawn('git', ['ls-files', '-z', '--', ...paths], root);
  if (listed.status !== 0 || listed.error) {
    // Cannot tell tracked from created. Stage all of them, exactly as this
    // function did before — and, because the whole set is then this run's own
    // staging, be prepared to take all of it back.
    return [...paths];
  }
  const tracked = new Set((listed.output ?? '').split('\0').filter((entry) => entry.length > 0));
  return paths.filter((relPath) => !tracked.has(relPath));
}

/**
 * Takes back exactly the staging this function did, and nothing else. A path
 * that was untracked before `git add` is untracked again afterwards.
 *
 * Reports whether it worked rather than throwing: it only ever runs on a path
 * that is already failing, and swallowing the original error to report a
 * cleanup error would hide the reason the commit was refused.
 */
function unstage(root: string, paths: string[], spawn: GateSpawn): boolean {
  if (paths.length === 0) return true;
  const reset = spawn('git', ['reset', '--quiet', '--', ...paths], root);
  return reset.status === 0 && !reset.error;
}

function leftStagedWarning(unstaged: boolean, paths: string[]): string {
  return unstaged ? '' : ` (WARNING: could not unstage ${paths.join(', ')} — the index may still hold them)`;
}

/**
 * Commits EXACTLY the paths this run edited, and nothing else.
 *
 * `git add -A` would be shorter and is wrong twice over. It would sweep
 * whatever else happened to be dirty in the checkout into a commit whose
 * message claims it cleaned one debt item — the house rule that an approval
 * authorizes only its own ticket's work, breached by an autonomous committer
 * that nobody is watching. And the run's own proposal file lives under
 * `.swarmforge/`, so `-A` would commit the instruction alongside the result.
 *
 * `git commit -- <paths>` is a partial commit taken through a temporary index,
 * so unrelated content that was ALREADY staged stays staged and uncommitted
 * rather than riding along.
 *
 * BL-1015 architect send-back #1, D1: staging is now the NARROWEST thing that
 * makes the partial commit possible, and it is undone when the commit does not
 * happen. This used to `git add` every path unconditionally, so a commit that
 * failed afterwards — a pre-commit hook refusing, a disk full, a signing
 * failure — left the new content sitting in the real index while
 * `boyScoutRun`'s `restore()` put the old content back on disk, or deleted a
 * created file that the index still held staged as added. Reverting file
 * CONTENT cannot reach the index, so invariant 1's "never partially applied"
 * was true of the working tree and false of the repository.
 *
 * Two changes close it. Only paths git does not already track are staged at
 * all — a tracked path goes straight into `git commit -- <path>`, whose
 * temporary index cannot diverge the real one. And whatever this function did
 * stage is unstaged again on either failure, so a failed commit leaves the
 * index exactly as it found it.
 *
 * A non-zero status from either is still thrown, never swallowed: "the commit
 * did not happen" and "the cleanup was committed" are opposite facts, and
 * `boyScoutRun` restores the tree on a throw.
 */
export function commitEdits(
  root: string,
  message: string,
  paths: string[],
  spawn: GateSpawn = defaultGateSpawn
): void {
  if (paths.length === 0) {
    // Not "commit nothing": an empty pathspec is the state in which a caller
    // reaches for `-A` to recover, which is the thing this function exists to
    // make impossible.
    throw new Error('refusing to commit with no paths: a boy scout commit names the files it cleaned');
  }
  const created = untrackedAmong(root, paths, spawn);
  if (created.length > 0) {
    const add = spawn('git', ['add', '--', ...created], root);
    if (add.status !== 0 || add.error) {
      // `git add` over several paths can stage some before failing on another.
      const unstaged = unstage(root, created, spawn);
      throw new Error(
        `git add failed: ${add.error?.message ?? add.output ?? ''}${leftStagedWarning(unstaged, created)}`
      );
    }
  }
  const commit = spawn('git', ['commit', '-m', message, '--', ...paths], root);
  if (commit.status !== 0 || commit.error) {
    const unstaged = unstage(root, created, spawn);
    throw new Error(
      `git commit failed: ${commit.error?.message ?? commit.output ?? ''}${leftStagedWarning(unstaged, created)}`
    );
  }
}

export function buildCommitMessage(result: {
  subject: string | null;
  summary: string | null;
  measured: Envelope;
  envelope: Envelope;
  gate: GateResult | null;
}): string {
  const gates = result.gate?.ran.join(', ') || 'none';
  return [
    `BL-1015 boy scout: ${result.summary ?? 'cleanup'}`,
    '',
    `Cleaned the top-ranked debt item from the Boy Scout scan: ${result.subject}.`,
    `Envelope: ${result.measured.files} file(s), ${result.measured.lines} line(s) ` +
      `of ${result.envelope.files}/${result.envelope.lines}.`,
    `Gates passed before commit: ${gates}.`,
  ].join('\n');
}
