import { execFileSync } from 'child_process';

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
export function isFileCommitted(targetPath: string, filePath: string): boolean {
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
