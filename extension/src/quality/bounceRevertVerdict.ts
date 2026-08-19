/**
 * BL-954: the pure verdict logic for whether a recorded bounce's
 * BL-490/BL-495 revert actually happened. No git IO here - see
 * bounceRevertCheck.ts for the adapter that gathers BounceRevertFacts from a
 * real repo. Kept separate so the decision (content wins, ancestry is not
 * even an input; already-on-main is a breach-report exception; an
 * unresolvable commit/branch is undeterminable, never silently clean) can be
 * tested and read without any git process in the picture.
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
