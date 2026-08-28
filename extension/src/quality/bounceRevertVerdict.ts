/**
 * BL-954: the pure verdict logic for whether a recorded bounce's
 * BL-490/BL-495 revert actually happened. No git IO here - the adapter that
 * gathers BounceRevertFacts from a real repo is
 * src/metrics/bounceRevertGitAdapter.ts, OUTSIDE this directory:
 * src/quality/ is the dependency-gate's POLICY zone (no-io-from-policy,
 * BL-259 hard gate - the architect bounce this parcel answers), same split
 * as coChange.ts vs gitHistoryAdapter.ts. Kept separate so the decision
 * (content wins, ancestry is not even an input; already-on-main is a
 * breach-report exception; an unresolvable commit/branch is undeterminable,
 * never silently clean) can be tested and read without any git process in
 * the picture. `ancestorOfMain` is the adapter's already-published fact -
 * true when the commit is an ancestor of EITHER local main or origin/main
 * (either ref can be the stale one, BL-891).
 */
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
  /**
   * BL-1208: true only when the adapter positively established that the
   * bounced commit's content at this path already existed, byte-identical,
   * at an earlier point in the SAME branch's own history before this
   * commit's immediate parent lost it - a restoration, not authorship.
   * Optional (absent/undefined on every pre-BL-1208 caller) so the default
   * is always "not established" - never inferred from liveness alone.
   */
  restoredFromEarlierHistory?: boolean;
}

export interface BounceRevertFacts {
  commit: string;
  branch: string;
  commitResolves: boolean;
  branchResolves: boolean;
  ancestorOfMain: boolean;
  files: BounceRevertFileFact[];
}

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
  const liveFiles = facts.files.filter((f) => f.tipMatchesBounced && f.bouncedDiffersFromParent);
  if (liveFiles.length > 0) {
    // BL-1208 invariant 1: a destructive remedy is offered only where the
    // check positively established AUTHORSHIP, never merely liveness. When
    // every live path was restored (not authored), withhold the remedy -
    // but invariant 2: this NEVER becomes a clean verdict; the finding and
    // every live path are still reported unchanged, whatever is decided
    // about the remedy.
    const anyAuthored = liveFiles.some((f) => !f.restoredFromEarlierHistory);
    return {
      ...base,
      verdict: 'violation',
      liveFiles: liveFiles.map((f) => f.path),
      remedy: anyAuthored ? `on ${facts.branch}: git revert --no-edit ${facts.commit}` : null,
    };
  }
  return { ...base, verdict: 'clean' };
}
