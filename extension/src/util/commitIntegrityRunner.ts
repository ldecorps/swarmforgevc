import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { findBacklogFilePath } from '../panel/backlogWriter';

const execFileAsync = promisify(execFile);

/** Path to the pinned commit-integrity CLI (BL-419) inside a target repo. */
export function commitIntegrityCliPath(targetPath: string): string {
  return path.join(targetPath, 'swarmforge', 'scripts', 'commit_integrity_cli.bb');
}

// BL-1475: the CLI's own JSON result, parsed - `reason: 'landed-elsewhere'`
// is a SUCCESS (another writer's commit already carried this call's
// intended content, verified against HEAD), never a failure. `stderr` is
// git's own stderr from the final failed attempt (only present on a real
// failure) - never discarded, so a caller that surfaces failures to a
// human (the front desk) can name the real reason instead of a generic one.
export interface CommitIntegrityResult {
  success: boolean;
  reason?: string;
  sha?: string;
  stderr?: string;
}

function parseCommitIntegrityResult(stdout: string): CommitIntegrityResult {
  try {
    // `?? '{}'` satisfies Array.prototype.pop()'s general `T | undefined` return type - unreachable
    // here since String.prototype.split always returns a non-empty array (even '' splits to ['']),
    // so .pop() on it always returns a defined string. A malformed/empty last line still reaches
    // JSON.parse and throws, caught by this function's own try/catch below - never this fallback.
    const result = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as {
      success?: boolean;
      reason?: string;
      sha?: string;
      stderr?: string;
    };
    return { success: result.success === true, reason: result.reason, sha: result.sha, stderr: result.stderr };
  } catch {
    return { success: false };
  }
}

// A non-zero CLI exit rejects execFileAsync, but Node still attaches the
// child's own stdout to the error - the CLI always prints its JSON line
// before exiting non-zero, so a genuine failure's :reason/:stderr is still
// recoverable here for diagnostics. `success` is forced false regardless of
// what that JSON claims: a non-zero exit is NEVER a success, even when
// stdout carries a stale/malformed success:true. Extracted out of
// runCommitIntegrityDetailed's own body so that function's CRAP reflects
// its own logic rather than this error-unwrapping's.
//
// `err && typeof err === 'object' && 'stdout' in err` and the `?? ''`
// fallback for `err.stdout` are typeof/nullish guards over `unknown` - the
// TypeScript catch-clause type, not a real production shape. The only
// caller is `await execFileAsync(...)` (util.promisify of child_process's
// execFile), and empirically every rejection it can produce - a non-zero
// exit, ENOENT (missing bb), a `timeout` kill, and a signal kill - already
// attaches a defined string `stdout` (verified '' on ENOENT/signal, never
// undefined). So every branch these guards could reject on is unreachable
// through this call site; each is an equivalent mutant of the BL-1081
// !x/typeof-guard class (Hardener Order lesson), same reasoning as the
// pre-existing `?? '{}'` fallback in parseCommitIntegrityResult above.
function commitIntegrityFailureFromError(err: unknown): CommitIntegrityResult {
  const stdout = err && typeof err === 'object' && 'stdout' in err ? String((err as { stdout?: string }).stdout ?? '') : '';
  return stdout ? { ...parseCommitIntegrityResult(stdout), success: false } : { success: false };
}

async function runCommitIntegrityDetailed(targetPath: string, relPaths: string[], message: string): Promise<CommitIntegrityResult> {
  const args = [
    commitIntegrityCliPath(targetPath),
    targetPath,
    '--message',
    message,
    ...relPaths.flatMap((relPath) => ['--path', relPath]),
  ];
  try {
    const { stdout } = await execFileAsync('bb', args);
    return parseCommitIntegrityResult(stdout);
  } catch (err) {
    return commitIntegrityFailureFromError(err);
  }
}

// Shared by commitExpediteWrites (telegram-front-desk-bot.ts, BL-490/BL-538)
// and commitEpicReorderWrites (bridgeServer.ts, BL-572): both durably commit
// one or more already-written backlog files through the same locked
// commit_integrity_cli.bb, never a hand-rolled `git commit` that would race
// the roles committing to main. Degrades to false (never throws) on a
// missing bb/CLI or a non-zero exit.
export async function runCommitIntegrity(targetPath: string, relPaths: string[], message: string): Promise<boolean> {
  const result = await runCommitIntegrityDetailed(targetPath, relPaths, message);
  return result.success;
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

// BL-1475: returns the richer CommitIntegrityResult (never a bare boolean)
// so a caller that needs to distinguish "landed elsewhere" (durable, but
// via ANOTHER writer's commit racing this one on the lock) from a genuine
// failure - and name that writer's sha, or git's own stderr on a real
// failure - can (the front desk's own PollAdapters wiring). A caller that
// only ever needed success/failure (the pager Approve route, the
// durability property tests) reads `.success` - this stays the ONE
// locate-and-commit path every automated human_approval writer shares,
// never a second, drifting one (BL-892's own invariant).
export async function commitApprovalWrites(
  targetPath: string,
  backlogId: string,
  message: string,
  extraAbsPaths: string[] = []
): Promise<CommitIntegrityResult> {
  const filePath = findBacklogFilePath(targetPath, backlogId);
  if (!filePath) {
    return { success: false };
  }
  return runCommitIntegrityDetailed(targetPath, uniqueRelPaths(targetPath, [filePath, ...extraAbsPaths]), message);
}
