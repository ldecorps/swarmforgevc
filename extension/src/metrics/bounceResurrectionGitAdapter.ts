/**
 * BL-1211: the git-IO adapter behind bounce-resurrection detection -
 * gathers BounceResurrectionFacts from a real repo and composes the pure
 * verdicts (src/quality/bounceResurrectionVerdict.ts). Lives in
 * src/metrics/ beside bounceRevertGitAdapter.ts (src/quality/ is the
 * dependency-gate's POLICY zone, BL-259 hard gate).
 *
 * Reuses the existing bounce store (readBounceRecords) as the source of
 * truth for which commits were bounced, on which branch (`by`), for which
 * ticket - no new bookkeeping invented. "Authored back" is detected via
 * this project's own "By <role>." commit-message trailer convention
 * (workflow rules: every commit carries one) rather than any git-revert-
 * specific machinery, because the real incident this ticket answers was a
 * hand-crafted restoration commit, not a literal `git revert` - relying on
 * git's own revert trailer would have missed it exactly as the deletion-
 * diff lift check did.
 */
import { execFileSync } from 'child_process';
import { BounceRecord } from '../quality/qaBounce';
import { readBounceRecords } from './bounceStore';
import { isKnownBounceRole } from '../quality/qaBounce';
import {
  BounceResurrectionFact,
  decideRecoveryFilter,
  decideQuarantineLift,
  QuarantineLiftVerdict,
  RecoveryFilterDecision,
} from '../quality/bounceResurrectionVerdict';
import { bouncingBranchForRole } from '../quality/bounceRevertVerdict';

export type GitReader = (args: string[]) => { status: number; stdout: string };

function execGitReader(repoRoot: string): GitReader {
  return (args) => {
    try {
      return { status: 0, stdout: execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (err) {
      const status = (err as { status?: number }).status;
      return { status: typeof status === 'number' ? status : 1, stdout: '' };
    }
  };
}

function contentAt(runGit: GitReader, rev: string, filePath: string): string | null {
  const res = runGit(['show', `${rev}:${filePath}`]);
  return res.status === 0 ? res.stdout : null;
}

// Same trailer this project's own commit-message convention writes:
// "By <role>." as the LAST non-blank line of the message.
const BY_ROLE_TRAILER = /^By (\S+)\.\s*$/m;

/**
 * The pipeline-role byline of the FIRST commit (oldest first, so the
 * earliest authorization is what gets cited - stable regardless of how
 * many later commits also happen to touch the path) reachable strictly
 * after `bouncedCommit`, up to `ref`, whose OWN change to `path` results
 * in content byte-identical to `bouncedContent` AND carries a
 * "By <role>." trailer for a role OTHER than "coordinator". Deliberately
 * NOT "any commit touching the path" - the revert commit itself touches
 * the path too (changing it AWAY from the bounced content) and carries a
 * legitimate pipeline-role byline; only a commit whose OWN diff actually
 * reintroduces the bounced bytes counts as authoring the resurrection
 * back. A recovery/restore-from-sibling operation is exactly what the
 * coordinator does instead of ordinary pipeline authorship (Article 1.1),
 * so a coordinator byline is never itself an authorization.
 */
function findAuthoredBackBy(
  runGit: GitReader,
  bouncedCommit: string,
  ref: string,
  path: string,
  bouncedContent: string
): { commit: string; role: string } | null {
  const log = runGit(['log', '--format=%H', '--reverse', `${bouncedCommit}..${ref}`, '--', path]);
  if (log.status !== 0) {
    return null;
  }
  const commits = log.stdout.split('\n').filter((line) => line.length > 0);
  for (const commit of commits) {
    if (contentAt(runGit, commit, path) !== bouncedContent) {
      continue;
    }
    const msg = runGit(['log', '-1', '--format=%B', commit]);
    if (msg.status !== 0) {
      continue;
    }
    const match = BY_ROLE_TRAILER.exec(msg.stdout);
    const role = match?.[1];
    if (role && role !== 'coordinator' && isKnownBounceRole(role)) {
      return { commit, role };
    }
  }
  return null;
}

function bouncedCommitPaths(runGit: GitReader, bouncedCommit: string): string[] {
  const res = runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', '-m', '--first-parent', bouncedCommit]);
  if (res.status !== 0) {
    return [];
  }
  return res.stdout.split('\n').filter((line) => line.length > 0);
}

/**
 * One BounceResurrectionFact per (recorded bounce for this role, path that
 * bounce touched), evaluated against `candidateRef` (a sibling, for a
 * recovery; the branch tip, for a lift check). A bounce whose commit
 * cannot be resolved is skipped, not a fact - fails open per this repo's
 * own send-time-gate posture (parcel_rollback_guard_lib.bb's identical
 * choice), never wedging a recovery or a lift on unrelated git corruption.
 */
export function gatherBounceResurrectionFacts(
  targetPath: string,
  by: string,
  candidateRef: string,
  runGit?: GitReader
): BounceResurrectionFact[] {
  const git = runGit ?? execGitReader(targetPath);
  const branch = bouncingBranchForRole(by);
  const records: BounceRecord[] = readBounceRecords(targetPath).filter((r) => r.by === by);
  const facts: BounceResurrectionFact[] = [];
  for (const record of records) {
    const paths = bouncedCommitPaths(git, record.commit);
    for (const path of paths) {
      const bouncedContent = contentAt(git, record.commit, path);
      if (bouncedContent === null) {
        continue; // the bounced commit deleted this path - nothing to resurrect
      }
      const candidateContent = contentAt(git, candidateRef, path);
      const authoredBackBy = findAuthoredBackBy(git, record.commit, branch, path, bouncedContent);
      facts.push({ ticket: record.ticket, path, bouncedContent, candidateContent, authoredBackBy });
    }
  }
  return facts;
}

/**
 * Invariant 1: which of `candidatePaths` (paths a sibling-restore would
 * otherwise bring back verbatim) a recovery should actually restore -
 * every unauthorized resurrection held back, every other path present.
 */
export function filterRecoveryPaths(
  targetPath: string,
  by: string,
  siblingRef: string,
  candidatePaths: string[],
  runGit?: GitReader
): RecoveryFilterDecision[] {
  const facts = gatherBounceResurrectionFacts(targetPath, by, siblingRef, runGit).filter((f) =>
    candidatePaths.includes(f.path)
  );
  const decided = decideRecoveryFilter(facts);
  const decidedPaths = new Set(decided.map((d) => d.path));
  // Every candidate path this branch's recorded bounces never touched at
  // all is restored unchanged - only a path a bounce actually introduced
  // is ever a resurrection candidate.
  const untouched = candidatePaths.filter((p) => !decidedPaths.has(p)).map((path) => ({ path, restore: true }));
  return [...decided, ...untouched];
}

/** Invariants 2/3: can this branch's quarantine be lifted right now. */
export function quarantineLiftCheck(targetPath: string, by: string, branchRef?: string, runGit?: GitReader): QuarantineLiftVerdict {
  const branch = branchRef ?? bouncingBranchForRole(by);
  return decideQuarantineLift(gatherBounceResurrectionFacts(targetPath, by, branch, runGit));
}
