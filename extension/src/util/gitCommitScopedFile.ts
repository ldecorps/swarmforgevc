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
