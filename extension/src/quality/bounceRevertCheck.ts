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
 */
import { execFileSync } from 'child_process';

export type BounceRevertVerdict = 'clean' | 'violation' | 'breach-report' | 'undeterminable';

export interface BounceRevertCheckReport {
  verdict: BounceRevertVerdict;
  branch: string;
  commit: string;
  /** The revert command to run on the bouncing branch; only for 'violation'. */
  remedy: string | null;
  /** Which obstacle stopped the check; only for 'undeterminable'. */
  cause: string | null;
  /** Touched paths whose bounced content is live at the branch tip. */
  liveFiles: string[];
}

export interface BounceRevertFileFact {
  path: string;
  tipMatchesBounced: boolean;
  bouncedDiffersFromParent: boolean;
}

export interface BounceRevertFacts {
  commit: string;
  branch: string;
  commitResolves: boolean;
  branchResolves: boolean;
  ancestorOfMain: boolean;
  files: BounceRevertFileFact[];
}

/** stdout on success (status 0), null content on failure - never throws. */
export type GitReader = (args: string[]) => { status: number; stdout: string };

/** Every reviewing role bounces from its swarmforge-<role> review branch. */
export function bouncingBranchForRole(by: string): string {
  return `swarmforge-${by}`;
}

/**
 * The pure verdict. Content decides (invariant 1): a path is live iff the
 * tip holds the bounced version AND the bounced commit actually changed it
 * - a path the commit never touched proves nothing. Ancestry of the
 * bouncing branch is not even an input.
 */
export function decideBounceRevertVerdict(facts: BounceRevertFacts): BounceRevertCheckReport {
  const base = { branch: facts.branch, commit: facts.commit, remedy: null, cause: null, liveFiles: [] as string[] };
  if (!facts.commitResolves) {
    return { ...base, verdict: 'undeterminable', cause: `the bounced commit ${facts.commit} cannot be resolved` };
  }
  if (!facts.branchResolves) {
    return { ...base, verdict: 'undeterminable', cause: `the bouncing branch ${facts.branch} cannot be resolved` };
  }
  if (facts.ancestorOfMain) {
    return { ...base, verdict: 'breach-report' };
  }
  const liveFiles = facts.files.filter((f) => f.tipMatchesBounced && f.bouncedDiffersFromParent).map((f) => f.path);
  if (liveFiles.length > 0) {
    return {
      ...base,
      verdict: 'violation',
      liveFiles,
      remedy: `on ${facts.branch}: git revert --no-edit ${facts.commit}`,
    };
  }
  return { ...base, verdict: 'clean' };
}

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
