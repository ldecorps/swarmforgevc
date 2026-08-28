/**
 * BL-1211: the pure verdict logic for "did a bounced-and-removed commit's
 * content come back with no pipeline-role commit standing behind it".
 * No git IO here (src/quality/ is the dependency-gate's POLICY zone,
 * BL-259 hard gate, same split as bounceRevertVerdict.ts) - the adapter
 * that gathers BounceResurrectionFacts from a real repo is
 * src/metrics/bounceResurrectionGitAdapter.ts.
 *
 * The 2026-08-28 amendment is load-bearing here: byte-identity to what a
 * bounce revert removed is the TRIGGER that demands a recorded
 * authorization, never the refusal itself. A commit reachable after the
 * bounced commit, on the SAME branch, touching the SAME path, whose
 * message carries this project's own "By <role>." trailer for a real
 * pipeline role (never "coordinator" - Article 1.1: coordinator commits
 * no code in the ordinary pipeline; a recovery/restore-from-sibling
 * operation is exactly what it does instead) is that record. Its absence
 * is what makes a resurrection unauthorized, regardless of how the
 * content got there.
 */
export interface BounceResurrectionFact {
  ticket: string;
  path: string;
  /** Content the bounced commit introduced at `path` (null if it deleted the path). */
  bouncedContent: string | null;
  /** Content under consideration - the sibling's, for a recovery; the branch tip's, for a lift check. */
  candidateContent: string | null;
  /** The pipeline-role byline of a commit, after the bounced commit, that touched `path` - or null if none exists. */
  authoredBackBy: { commit: string; role: string } | null;
}

/**
 * Pure: true only when the candidate content is BYTE-IDENTICAL to what the
 * bounce introduced AND nothing has authored it back since. Content that
 * differs (a genuine re-fix, scenario 04) is never a finding regardless of
 * authorship - identity is the precondition for asking the question at all.
 */
export function isUnauthorizedResurrection(fact: BounceResurrectionFact): boolean {
  return (
    fact.bouncedContent !== null &&
    fact.candidateContent !== null &&
    fact.candidateContent === fact.bouncedContent &&
    fact.authoredBackBy === null
  );
}

export interface RecoveryFilterDecision {
  path: string;
  /** false when this path is an unauthorized resurrection and must be held back from the recovery. */
  restore: boolean;
}

/** Pure: invariant 1 - a recovery holds back only paths that are unauthorized resurrections. */
export function decideRecoveryFilter(facts: BounceResurrectionFact[]): RecoveryFilterDecision[] {
  return facts.map((fact) => ({ path: fact.path, restore: !isUnauthorizedResurrection(fact) }));
}

export interface QuarantineLiftVerdict {
  granted: boolean;
  /** Present only when refused - every ticket whose bounced content came back unauthorized. */
  refusedTickets: string[];
  /** Present only when refused - every offending path, across all refused tickets. */
  refusedPaths: string[];
  /** Present only when granted BECAUSE of an authorization - cites what authorized it, for scenario 05. */
  authorizedBy: { commit: string; role: string }[];
}

/**
 * Pure: invariant 2/3 combined. A deletion-diff-clean branch still refuses
 * if ANY fact is an unauthorized resurrection - the lift check must be
 * able to fail on content that CAME BACK, not only on content that went
 * missing. Every refusal names its ticket (never a bare "refused").
 */
export function decideQuarantineLift(facts: BounceResurrectionFact[]): QuarantineLiftVerdict {
  const unauthorized = facts.filter(isUnauthorizedResurrection);
  const authorized = facts.filter((f) => f.authoredBackBy !== null);
  if (unauthorized.length > 0) {
    return {
      granted: false,
      refusedTickets: [...new Set(unauthorized.map((f) => f.ticket))],
      refusedPaths: unauthorized.map((f) => f.path),
      authorizedBy: [],
    };
  }
  return {
    granted: true,
    refusedTickets: [],
    refusedPaths: [],
    authorizedBy: authorized.map((f) => f.authoredBackBy as { commit: string; role: string }),
  };
}
