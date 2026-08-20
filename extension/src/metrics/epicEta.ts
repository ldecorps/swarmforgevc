// BL-591: the pure epic-ETA estimator behind the reorder screen's per-tile
// readout. Display-and-estimate only - it changes no scheduling, promotes
// nothing, gates no build.
//
// Pure and total by contract (invariant 3): for every input - zero
// velocity, zero children, empty window included - it returns a typed
// state and never throws, and no NaN or Infinity ever reaches the state
// feed. The impure halves (git-derived completion events, pack label,
// membership) live with the bridge (bridgeServer.ts), mirroring
// burnRate.ts's own pure/impure split.
//
// The four honesty corrections the ticket demands are structural here:
//   1. every range carries a paceAssumption naming pack + trailing window;
//   2. blocked children contribute NO weight to any duration - they are
//      counted and surfaced, never folded in (invariant 2);
//   3. remaining size is a mutation_cost-weighted roll-up over OPEN
//      children only (done children and the epic tracker itself are the
//      caller's job to exclude; a defensive isEpicTracker/done filter
//      backs that up);
//   4. the ETA is a RANGE (low strictly below high, invariant 1) with a
//      visible confidence, never a point date.

export interface EpicEtaChild {
  // Weighting. Absent mutationCost counts at the medium weight.
  mutationCost?: string;
  // Blocked markers (the ticket's checkable predicate): held in
  // backlog/hold/, status blocked or needs_design, or non-empty
  // promotion_blockers / block_until.
  held?: boolean;
  statusText?: string;
  promotionBlockers?: string[];
  blockUntil?: string[];
  // Defensive exclusions (the caller's membership already excludes both).
  type?: string;
  done?: boolean;
}

export interface EpicEtaInput {
  children: EpicEtaChild[];
  // Completion event timestamps (ms) - the git-derived "a done ticket was
  // added" events. Only events inside [nowMs - windowMs, nowMs] count.
  completionsMs: number[];
  nowMs: number;
  windowMs: number;
  // The pack the pace rests on (e.g. "full-forge") - folded verbatim into
  // the paceAssumption, which must name it (invariant 1).
  packLabel: string;
}

export type EpicEtaConfidence = 'high' | 'medium' | 'low';

export type EpicEtaState =
  | { kind: 'complete' }
  | { kind: 'blocked'; reason: string; blockedCount: number }
  | { kind: 'no-recent-pace'; blockedCount: number }
  | {
      kind: 'ranged';
      lowDays: number;
      highDays: number;
      blockedCount: number;
      confidence: EpicEtaConfidence;
      confidenceReason: string;
      paceAssumption: string;
    };

// Strictly monotonic low < medium < high, in "median-ticket equivalents"
// so a tickets/day velocity divides a weighted remaining size directly.
const WEIGHTS: Record<string, number> = { low: 0.5, medium: 1, high: 2 };

export function childWeight(child: EpicEtaChild): number {
  const cost = (child.mutationCost ?? 'medium').toLowerCase();
  return WEIGHTS[cost] ?? WEIGHTS.medium;
}

export function childBlocked(child: EpicEtaChild): boolean {
  const status = (child.statusText ?? '').toLowerCase();
  return Boolean(
    child.held === true ||
      status === 'blocked' ||
      status === 'needs_design' ||
      (child.promotionBlockers && child.promotionBlockers.length > 0) ||
      (child.blockUntil && child.blockUntil.length > 0)
  );
}

function finite(n: number): boolean {
  return Number.isFinite(n) && !Number.isNaN(n);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function estimateEpicEta(input: EpicEtaInput): EpicEtaState {
  const children = Array.isArray(input.children) ? input.children : [];
  // Defensive: the tracker itself and done children weigh zero even if the
  // caller's membership ever leaks them in.
  const open = children.filter((c) => c.type !== 'epic' && c.done !== true);
  if (open.length === 0) {
    return { kind: 'complete' };
  }

  const blocked = open.filter(childBlocked);
  const buildable = open.filter((c) => !childBlocked(c));
  const blockedCount = blocked.length;
  if (buildable.length === 0) {
    // Every open child is blocked: no velocity number describes this work.
    const anyDesign = blocked.some((c) => (c.statusText ?? '').toLowerCase() === 'needs_design');
    return { kind: 'blocked', reason: anyDesign ? 'designing' : 'blocked', blockedCount };
  }

  // Invariant 2: the duration is a function of BUILDABLE weight only.
  const buildableWeight = buildable.reduce((sum, c) => sum + childWeight(c), 0);
  const blockedWeight = blocked.reduce((sum, c) => sum + childWeight(c), 0);

  const windowMs = finite(input.windowMs) && input.windowMs > 0 ? input.windowMs : 0;
  const nowMs = finite(input.nowMs) ? input.nowMs : 0;
  const windowDays = windowMs / DAY_MS;
  const events = (Array.isArray(input.completionsMs) ? input.completionsMs : []).filter(
    (t) => finite(t) && t <= nowMs && t >= nowMs - windowMs
  );
  if (windowDays <= 0 || events.length === 0) {
    return { kind: 'no-recent-pace', blockedCount };
  }

  // Velocity noise, measured over the window's two halves: the honest range
  // divides remaining weight by a fast and a slow rate rather than one mean
  // (a point estimate is false precision - the measured swing was 3-54/day).
  const midMs = nowMs - windowMs / 2;
  const olderCount = events.filter((t) => t < midMs).length;
  const recentCount = events.length - olderCount;
  const meanRate = events.length / windowDays;
  const halfDays = windowDays / 2;
  const halfRates = [olderCount / halfDays, recentCount / halfDays];
  // A half with zero completions must not divide to Infinity: floor the
  // slow rate at half the mean (a genuinely idle half already halves the
  // mean itself, which is the honest signal).
  const slowRate = Math.max(Math.min(...halfRates), meanRate / 2);
  const fastRate = Math.max(...halfRates, meanRate);

  let lowDays = buildableWeight / fastRate;
  let highDays = buildableWeight / slowRate;
  if (!finite(lowDays) || !finite(highDays)) {
    return { kind: 'no-recent-pace', blockedCount };
  }
  // Invariant 1: low strictly below high, always - a perfectly steady pace
  // still gets an honest band rather than a false point.
  if (highDays <= lowDays) {
    highDays = lowDays * 1.5 + 0.1;
  }

  // Confidence: start high; degrade for blocked weight, noisy pace, and a
  // mostly heavy/undesigned remainder - with the dominant reason in a word.
  const noiseRatio = fastRate / slowRate;
  const blockedFraction = blockedWeight / (blockedWeight + buildableWeight);
  const heavyFraction =
    buildable.filter((c) => (c.mutationCost ?? '').toLowerCase() === 'high').length / buildable.length;
  let degradations = 0;
  let confidenceReason = 'steady';
  if (blockedFraction > 0) {
    degradations += blockedFraction > 0.5 ? 2 : 1;
    confidenceReason = 'blocked';
  }
  if (noiseRatio > 3) {
    degradations += 1;
    if (confidenceReason === 'steady') confidenceReason = 'noisy';
  }
  if (heavyFraction > 0.5) {
    degradations += 1;
    if (confidenceReason === 'steady') confidenceReason = 'heavy';
  }
  const confidence: EpicEtaConfidence = degradations === 0 ? 'high' : degradations === 1 ? 'medium' : 'low';

  const windowDaysLabel = Math.max(1, Math.round(windowDays));
  const paceAssumption = `at current ${input.packLabel || 'unknown-pack'} pace over the trailing ${windowDaysLabel}d window`;

  return {
    kind: 'ranged',
    lowDays: round1(lowDays),
    highDays: Math.max(round1(highDays), round1(lowDays) + 0.1),
    blockedCount,
    confidence,
    confidenceReason,
    paceAssumption,
  };
}
