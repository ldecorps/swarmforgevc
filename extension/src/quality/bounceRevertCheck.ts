/**
 * BL-954: verification that a recorded bounce's BL-490/BL-495 revert
 * actually happened. The constitution requires the bouncing role to remove
 * the bounced commit's CONTENT from its own review branch in the same step
 * as the bounce - confirmed by content, never by ancestry, with one
 * exception: a commit already an ancestor of main is reported as a breach
 * and never reverted. Nothing checked any of this until BL-954; both
 * BL-935 architect bounces skipped the revert and the content rode to main
 * unnoticed.
 *
 * The check REPORTS - it never blocks or performs the revert itself
 * (ticket constraints: an agent silently rewriting its own branch on a
 * heuristic is worse than the skipped step). Verdicts:
 *   - 'violation':      bounced content is live at the bouncing branch tip
 *                       (some touched path matches the bounced version AND
 *                       the bounced version differs from its parent) -
 *                       remedy carries the revert command.
 *   - 'clean':          no touched path still holds the bounced version.
 *   - 'breach-report':  the bounced commit is already an ancestor of main;
 *                       per the constitution's exception the remedy is
 *                       ALWAYS null here - published history is never to
 *                       be reverted (invariant 2).
 *   - 'undeterminable': the commit or the branch cannot be resolved; the
 *                       cause names which. Never silently read as clean
 *                       (invariant 3).
 *
 * This file is the git adapter: it gathers BounceRevertFacts from a real
 * repo and hands them to the pure decision in bounceRevertVerdict.ts, which
 * has no git IO of its own.
 */
import { execFileSync } from 'child_process';
import {
  BounceRevertCheckReport,
  BounceRevertFacts,
  BounceRevertVerdict,
  BounceRevertFileFact,
  bouncingBranchForRole,
  decideBounceRevertVerdict,
} from './bounceRevertVerdict';

export { BounceRevertVerdict, BounceRevertCheckReport, BounceRevertFileFact, BounceRevertFacts, bouncingBranchForRole, decideBounceRevertVerdict };

/** stdout on success (status 0), null content on failure - never throws. */
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

function resolves(runGit: GitReader, rev: string): boolean {
  return runGit(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).status === 0;
}

/** File content at rev:path, or null when the path is absent there. */
function contentAt(runGit: GitReader, rev: string, filePath: string): string | null {
  const res = runGit(['show', `${rev}:${filePath}`]);
  return res.status === 0 ? res.stdout : null;
}

export function gatherBounceRevertFacts(
  opts: { commit: string; by: string },
  runGit: GitReader
): BounceRevertFacts {
  const branch = bouncingBranchForRole(opts.by);
  const commitResolves = resolves(runGit, opts.commit);
  const branchResolves = resolves(runGit, branch);
  if (!commitResolves || !branchResolves) {
    return { commit: opts.commit, branch, commitResolves, branchResolves, ancestorOfMain: false, files: [] };
  }
  const ancestorOfMain = runGit(['merge-base', '--is-ancestor', opts.commit, 'main']).status === 0;
  const touched = runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', opts.commit])
    .stdout.split('\n')
    .filter((line) => line.length > 0);
  const files = touched.map((filePath) => {
    const bounced = contentAt(runGit, opts.commit, filePath);
    const parent = contentAt(runGit, `${opts.commit}^`, filePath);
    const tip = contentAt(runGit, branch, filePath);
    return { path: filePath, tipMatchesBounced: tip === bounced, bouncedDiffersFromParent: bounced !== parent };
  });
  return { commit: opts.commit, branch, commitResolves, branchResolves, ancestorOfMain, files };
}

export function bounceRevertCheck(opts: { repoRoot: string; commit: string; by: string; runGit?: GitReader }): BounceRevertCheckReport {
  const runGit = opts.runGit ?? execGitReader(opts.repoRoot);
  return decideBounceRevertVerdict(gatherBounceRevertFacts({ commit: opts.commit, by: opts.by }, runGit));
}
