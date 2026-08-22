/**
 * BL-954: the git-IO adapter behind the bounce revert check - gathers
 * BounceRevertFacts from a real repo and composes the pure verdict
 * (src/quality/bounceRevertVerdict.ts). Lives in src/metrics/ beside
 * gitHistoryAdapter.ts because src/quality/ is the dependency-gate's POLICY
 * zone (no-io-from-policy, BL-259 hard gate) - the architect bounce D1 this
 * file answers.
 *
 * Two gathering rules with their own bounce provenance:
 * - Touched files use `diff-tree -m --first-parent` (D2): the bare
 *   invocation is BLIND to merge commits - empty output, so a bounced MERGE
 *   commit (routine in this repo's practice) read as 'clean' no matter what
 *   the bouncing branch held, the exact silent-clean BL-954 exists to close.
 * - Already-published means an ancestor of EITHER local `main` OR
 *   `origin/main` (D3): the two refs diverge in both directions across
 *   worktrees (BL-891 measured 8/22), and a stale local `main` would
 *   otherwise turn a genuinely published commit into a 'violation' carrying
 *   a revert instruction for published history - invariant 2's forbidden
 *   outcome.
 */
import { execFileSync } from 'child_process';
import {
  BounceRevertCheckReport,
  BounceRevertFacts,
  bouncingBranchForRole,
  decideBounceRevertVerdict,
} from '../quality/bounceRevertVerdict';

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

function isAncestorOf(runGit: GitReader, commit: string, ref: string): boolean {
  return runGit(['merge-base', '--is-ancestor', commit, ref]).status === 0;
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
  const ancestorOfMain =
    isAncestorOf(runGit, opts.commit, 'main') || isAncestorOf(runGit, opts.commit, 'origin/main');
  // -m --first-parent: a bare diff-tree is blind to merge commits (empty
  // output -> silent 'clean', D2). First-parent side is the branch the merge
  // landed ON, so the listed paths are what the bounced commit introduced
  // there.
  const touched = runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', '-m', '--first-parent', opts.commit])
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
