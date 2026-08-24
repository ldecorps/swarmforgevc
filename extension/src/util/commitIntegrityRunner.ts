import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { findBacklogFilePath } from '../panel/backlogWriter';

const execFileAsync = promisify(execFile);

/** Path to the pinned commit-integrity CLI (BL-419) inside a target repo. */
export function commitIntegrityCliPath(targetPath: string): string {
  return path.join(targetPath, 'swarmforge', 'scripts', 'commit_integrity_cli.bb');
}

// Shared by commitExpediteWrites (telegram-front-desk-bot.ts, BL-490/BL-538)
// and commitEpicReorderWrites (bridgeServer.ts, BL-572): both durably commit
// one or more already-written backlog files through the same locked
// commit_integrity_cli.bb, never a hand-rolled `git commit` that would race
// the roles committing to main. Degrades to false (never throws) on a
// missing bb/CLI or a non-zero exit.
export async function runCommitIntegrity(targetPath: string, relPaths: string[], message: string): Promise<boolean> {
  try {
    const args = [
      commitIntegrityCliPath(targetPath),
      targetPath,
      '--message',
      message,
      ...relPaths.flatMap((relPath) => ['--path', relPath]),
    ];
    const { stdout } = await execFileAsync('bb', args);
    // `?? '{}'` satisfies Array.prototype.pop()'s general `T | undefined` return type - unreachable
    // here since String.prototype.split always returns a non-empty array (even '' splits to ['']),
    // so .pop() on it always returns a defined string. A malformed/empty last line still reaches
    // JSON.parse and throws, caught by this function's own try/catch below - never this fallback.
    const result = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}

// BL-892: shared by every automated human_approval writer (Expedite,
// paused-pager Approve, Telegram Approve/Reject/Amend) - resolves the
// SINGLE ticket file's current on-disk location (post-any-promote, so a
// promoted ticket commits from its FINAL path) and pathspec-commits it
// through the same locked commit_integrity_cli.bb every other writer here
// uses. A ticket that no longer resolves (moved/deleted mid-flight) is
// reported as a commit failure, never a silent no-op success.
// BL-892 / BL-1091: shared by every automated human_approval writer. Resolves
// the ticket's current on-disk location (post-any-promote) and pathspec-commits
// it — plus any extra paths (e.g. the rename source) — through the locked
// commit_integrity_cli.bb. A ticket that no longer resolves is a commit
// failure, never a silent no-op success.
export async function commitApprovalWrites(
  targetPath: string,
  backlogId: string,
  message: string,
  extraAbsPaths: string[] = []
): Promise<boolean> {
  const filePath = findBacklogFilePath(targetPath, backlogId);
  if (!filePath) {
    return false;
  }
  const relPaths = [path.relative(targetPath, filePath)];
  for (const abs of extraAbsPaths) {
    const rel = path.relative(targetPath, abs);
    if (rel && !relPaths.includes(rel)) {
      relPaths.push(rel);
    }
  }
  return runCommitIntegrity(targetPath, relPaths, message);
}
