import { execFileSync } from 'child_process';
import { existsSync } from 'fs';

// Shared by commitCostHealthSidecar (costHealthSidecar.ts) and
// commitTopicRecord (blTopicStore.ts): both commit exactly one file into an
// already-checked-out repo, scoped so no other dirty state in the worktree
// is swept in, and fail open (never throw) so the caller's own write always
// succeeds regardless of whether this particular commit does — including
// the "nothing to commit" case (e.g. an identical re-run).
export function commitScopedFile(targetPath: string, filePath: string, commitMessage: string): boolean {
  try {
    execFileSync('git', ['-C', targetPath, 'add', '--', filePath], { stdio: 'ignore' });
    execFileSync('git', ['-C', targetPath, 'commit', '-m', commitMessage, '--', filePath], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// BL-331 architect bounce: "verified" must mean DURABLY serialised, never
// merely "present in a working-tree file" - commitScopedFile's own commit
// step can fail (network/lock/disk issue) AFTER its write already
// succeeded (CommitFailureReporter's whole reason for existing), leaving a
// record that reads back correctly right now but is lost on a fresh
// checkout/git clean/disk failure until a LATER successful commit lands.
// A caller gating an irreversible action (BL-331's topic delete) on
// "verified" must check the file has no uncommitted changes at all, not
// just that its content parses - `git status --porcelain` for exactly this
// one path is empty only when the working tree matches what is actually
// committed. Fails CLOSED (false = "not confirmed committed") on any git
// error, e.g. not a repo at all - never assume durability it cannot prove.
//
// BL-390 hardening: `git status --porcelain -- <path>` prints nothing for a
// path that is simply ABSENT (never written, never tracked) - the exact
// same empty output as a path that IS committed with no pending changes.
// Left unguarded, that collapses "durable" and "never existed" into one
// return value, in direct contradiction of this function's own fail-closed
// contract above. No current caller triggers it (every caller here writes
// the file via atomicWrite before checking it - blTopicStore.ts's
// appendMessage/commitTopicRecord, repair-bl-topic-records.ts), so this is
// a latent trap rather than a live defect, but it sits directly upstream of
// BL-390's own new no-op guard (commitTopicRecord's early
// `if (isFileCommitted(...)) return true`), so a future check-before-write
// caller would silently skip minting any commit at all. Check existence
// first so a missing file can never read as "already durable".
export function isFileCommitted(targetPath: string, filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }
  try {
    const status = execFileSync('git', ['-C', targetPath, 'status', '--porcelain', '--', filePath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return status.trim().length === 0;
  } catch {
    return false;
  }
}
