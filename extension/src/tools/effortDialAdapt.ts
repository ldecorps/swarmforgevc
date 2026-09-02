/**
 * BL-1317 Adapt tier: the pure decision for how a seat's reasoning effort
 * moves in response to an OUTCOME signal.
 *
 * BL-236 shipped the Suggest tier and explicitly deferred Adapt. BL-1316 set
 * the CLAIM-TIME baseline from the held ticket's mutation_cost. This module is
 * Adapt, and it moves only around that baseline:
 *
 *   - a bounce (evidence of under-thinking) climbs ONE notch;
 *   - a clean completion drops one notch only once a whole streak of them has
 *     accumulated, and never below the BL-1316 baseline for the held ticket.
 *
 * The asymmetry is deliberate and is declared invariant 2 - the same descent
 * -ladder hysteresis BL-545 uses. Escalating is cheap and evidence-driven; the
 * cost of thinking too little is a bounced parcel, while the cost of thinking
 * too much is only tokens. So a single signal may climb, but only sustained
 * evidence may descend.
 *
 * PURE. No IO, no respawn, no file write. The caller applies the decision the
 * same way BL-1316's claim-time apply does - in memory / on respawn - so
 * declared invariant 1 holds: Adapt never rewrites the pack conf on disk.
 *
 * SINGLE POLICY, ACROSS A LANGUAGE BOUNDARY. The ladder below is mirrored by
 * seat_difficulty_lib.bb's `cost-rank` (low 0, medium 1, high 2), because the
 * Babashka consumer (handoff_lib.bb::record-effort-adapt!) records the outcome
 * signal. A comment claiming the two agree is not a gate - see
 * swarmforge/scripts/test/test_bl1317_effort_ladder_parity.sh, which asserts
 * both literals agree (the constant-across-a-language-boundary rule, BL-897).
 */

/** The effort ladder, weakest first. Mirrors seat_difficulty_lib.bb cost-rank. */
export const ADAPT_EFFORT_LADDER: readonly string[] = ['low', 'medium', 'high'];

/**
 * Clean completions required before a single notch may be given back.
 * Asymmetric with the one-signal climb by design (invariant 2).
 */
export const ADAPT_DEFAULT_CLEAN_STREAK = 3;

export type AdaptSignal = 'bounce' | 'clean';

export interface AdaptEffortInput {
  /** False for a backend with no reasoning-effort lever - decides nothing. */
  backendHasLever: boolean;
  /** The effort the seat is running at now. */
  priorEffort?: string;
  /** BL-1316's claim-time effort for the held ticket: the floor. */
  baselineEffort?: string;
  signal?: string;
  /** Consecutive clean completions at the current effort, including this one. */
  cleanStreak?: number;
  cleanStreakRequired?: number;
}

export interface AdaptEffortDecision {
  /** True only when the effort actually CHANGES - nothing to write otherwise. */
  apply: boolean;
  /** The effort to run at. Undefined when the backend has no lever at all. */
  effort?: string;
  reason: string;
}

function rankOf(effort: string | undefined): number {
  return effort === undefined ? -1 : ADAPT_EFFORT_LADDER.indexOf(effort);
}

export function decideAdaptEffort(input: AdaptEffortInput): AdaptEffortDecision {
  const { backendHasLever, priorEffort, baselineEffort, signal } = input;

  // BL-1316 invariant 2, carried forward: a backend with no lever is never
  // sent an effort at all, so no unsupported flag can be built from this.
  if (!backendHasLever) {
    return { apply: false, reason: 'backend has no reasoning-effort lever' };
  }

  const prior = rankOf(priorEffort);
  if (prior === -1) {
    // Fail closed rather than guess: an effort token this ladder does not
    // know is not a rung, and inventing one would write a flag the backend
    // may not accept.
    return { apply: false, effort: priorEffort, reason: `unknown prior effort ${String(priorEffort)}` };
  }

  // An absent baseline is treated as the CURRENT effort, never as the bottom
  // rung. Reading "no baseline" as low would let a clean streak drag a
  // high-cost seat all the way down, which is exactly the floor invariant 2
  // exists to hold.
  const floor = rankOf(baselineEffort) === -1 ? prior : rankOf(baselineEffort);

  if (signal === 'bounce') {
    const next = Math.min(prior + 1, ADAPT_EFFORT_LADDER.length - 1);
    if (next === prior) {
      return { apply: false, effort: priorEffort, reason: 'already at the top of the ladder' };
    }
    return { apply: true, effort: ADAPT_EFFORT_LADDER[next], reason: 'bounce: climbing one notch' };
  }

  if (signal === 'clean') {
    const required = input.cleanStreakRequired ?? ADAPT_DEFAULT_CLEAN_STREAK;
    const streak = input.cleanStreak ?? 0;
    if (streak < required) {
      return { apply: false, effort: priorEffort, reason: `clean streak ${streak}/${required}` };
    }
    const next = Math.max(prior - 1, floor);
    if (next === prior) {
      return { apply: false, effort: priorEffort, reason: 'already at the claim-time baseline' };
    }
    return { apply: true, effort: ADAPT_EFFORT_LADDER[next], reason: 'clean streak met: dropping one notch' };
  }

  return { apply: false, effort: priorEffort, reason: `unknown signal ${String(signal)}` };
}
