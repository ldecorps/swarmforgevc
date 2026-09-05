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

// BL-1368: the ONE byline every commit that records a HUMAN decision
// carries. It used to be the literal `By coder.` at each writer, which made
// the most consequential commit class in the repo assert something false:
// every agent commits as `t <t@t>`, so the role byline is the only
// attribution a reader has, and on 2026-09-03 QA correctly read `By coder.`
// on an approval flip as an agent self-flipping a human's answer. It named
// the decider truthfully only by accident - never. One exported constant,
// composed by every writer, so the two halves of the fix cannot drift apart
// and leave a surviving `By coder.` to mislead the next reader.
export const HUMAN_DECISION_BYLINE = 'By the human, recorded by the front desk.';

/** Compose a commit message for a decision only a human can make (BL-1368). */
export function humanDecisionCommitMessage(subject: string): string {
  return `${subject}\n\n${HUMAN_DECISION_BYLINE}`;
}

// BL-892 / BL-1091: shared by every automated human_approval writer (Expedite,
// paused-pager Approve, Telegram Approve/Reject/Amend). Resolves the ticket's
// current on-disk location (post-any-promote) and pathspec-commits it — plus
// any extra abs paths (e.g. the rename source) — through the locked
// commit_integrity_cli.bb. A ticket that no longer resolves is a commit
// failure, never a silent no-op success.
function uniqueRelPaths(targetPath: string, absPaths: string[]): string[] {
  const relPaths: string[] = [];
  for (const abs of absPaths) {
    const rel = path.relative(targetPath, abs);
    if (rel && !relPaths.includes(rel)) {
      relPaths.push(rel);
    }
  }
  return relPaths;
}

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
  return runCommitIntegrity(targetPath, uniqueRelPaths(targetPath, [filePath, ...extraAbsPaths]), message);
}
