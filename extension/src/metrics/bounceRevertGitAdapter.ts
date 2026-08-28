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

/**
 * BL-1208: true when `filePath`'s bounced content already existed,
 * byte-identical, at some commit STRICTLY BEFORE the bounced commit's own
 * immediate parent - i.e., the branch's own history held this exact
 * content before it was lost, and the bounced commit put it back rather
 * than authoring it new. Only ever called when the immediate parent
 * lacked the path at all (gatherBounceRevertFacts's own precondition) -
 * a file merely EDITED (present in both parent and bounced) is never a
 * restoration candidate by this check; only an add-back is.
 *
 * Deliberately scoped to the BOUNCED BRANCH'S OWN history, never a
 * sibling branch's tip: a sibling branch could coincidentally hold
 * identical content for reasons that have nothing to do with this
 * commit's own provenance (two roles independently authoring the same
 * trivial fix), which would launder a genuine violation into a false
 * withheld remedy - invariant 2's forbidden outcome. The branch's own
 * prior history is the one signal that is provably about THIS content's
 * OWN past on THIS branch, not a coincidence elsewhere.
 */
function existedIdenticallyBeforeLoss(
  runGit: GitReader,
  commit: string,
  filePath: string,
  bouncedContent: string
): boolean {
  const log = runGit(['log', '--format=%H', `${commit}^`, '--', filePath]);
  if (log.status !== 0) {
    return false;
  }
  const priorCommits = log.stdout.split('\n').filter((line) => line.length > 0);
  return priorCommits.some((priorCommit) => contentAt(runGit, priorCommit, filePath) === bouncedContent);
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
    // BL-1208: only an add-back (bounced present, parent absent) is even a
    // candidate for "restored rather than authored" - gating the extra git
    // IO here keeps it off every ordinary edit/delete case.
    const restoredFromEarlierHistory =
      bounced !== null && parent === null && existedIdenticallyBeforeLoss(runGit, opts.commit, filePath, bounced);
    return {
      path: filePath,
      tipMatchesBounced: tip === bounced,
      bouncedDiffersFromParent: bounced !== parent,
      restoredFromEarlierHistory,
    };
  });
  return { commit: opts.commit, branch, commitResolves, branchResolves, ancestorOfMain, files };
}

export function bounceRevertCheck(opts: { repoRoot: string; commit: string; by: string; runGit?: GitReader }): BounceRevertCheckReport {
  const runGit = opts.runGit ?? execGitReader(opts.repoRoot);
  return decideBounceRevertVerdict(gatherBounceRevertFacts({ commit: opts.commit, by: opts.by }, runGit));
}
