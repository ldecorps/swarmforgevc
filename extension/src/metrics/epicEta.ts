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

const BLOCKING_STATUSES = new Set(['blocked', 'needs_design']);

function hasBlockingEntries(list?: string[]): boolean {
  return Array.isArray(list) && list.length > 0;
}

export function childBlocked(child: EpicEtaChild): boolean {
  const status = (child.statusText ?? '').toLowerCase();
  return (
    child.held === true ||
    BLOCKING_STATUSES.has(status) ||
    hasBlockingEntries(child.promotionBlockers) ||
    hasBlockingEntries(child.blockUntil)
  );
}

function finite(n: number): boolean {
  return Number.isFinite(n) && !Number.isNaN(n);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

interface OpenPartition {
  open: EpicEtaChild[];
  blocked: EpicEtaChild[];
  buildable: EpicEtaChild[];
}

// Defensive: the tracker itself and done children weigh zero even if the
// caller's membership ever leaks them in.
function partitionOpen(children: EpicEtaChild[]): OpenPartition {
  const open = children.filter((c) => c.type !== 'epic' && c.done !== true);
  const blocked = open.filter(childBlocked);
  const buildable = open.filter((c) => !childBlocked(c));
  return { open, blocked, buildable };
}

function weightSum(list: EpicEtaChild[]): number {
  return list.reduce((sum, c) => sum + childWeight(c), 0);
}

interface ResolvedWindow {
  windowMs: number;
  nowMs: number;
  windowDays: number;
  events: number[];
}

function resolveWindowMs(raw: number): number {
  return finite(raw) && raw > 0 ? raw : 0;
}

function resolveNowMs(raw: number): number {
  return finite(raw) ? raw : 0;
}

function safeCompletions(list: number[]): number[] {
  return Array.isArray(list) ? list : [];
}

// Normalizes the clock/window inputs and the git-derived completion events
// down to nothing when there is no usable window or no completions in it -
// the caller degrades both to the same no-recent-pace state.
function resolveWindow(input: EpicEtaInput): ResolvedWindow | null {
  const windowMs = resolveWindowMs(input.windowMs);
  const nowMs = resolveNowMs(input.nowMs);
  const windowDays = windowMs / DAY_MS;
  const events = safeCompletions(input.completionsMs).filter(
    (t) => finite(t) && t <= nowMs && t >= nowMs - windowMs
  );
  if (windowDays <= 0 || events.length === 0) {
    return null;
  }
  return { windowMs, nowMs, windowDays, events };
}

interface RateRange {
  lowDays: number;
  highDays: number;
  fastRate: number;
  slowRate: number;
}

// Velocity noise, measured over the window's two halves: the honest range
// divides remaining weight by a fast and a slow rate rather than one mean
// (a point estimate is false precision - the measured swing was 3-54/day).
function computeRateRange(window: ResolvedWindow, buildableWeight: number): RateRange | null {
  const { events, nowMs, windowMs, windowDays } = window;
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

  const lowDays = buildableWeight / fastRate;
  let highDays = buildableWeight / slowRate;
  if (!finite(lowDays) || !finite(highDays)) {
    return null;
  }
  // Invariant 1: low strictly below high, always - a perfectly steady pace
  // still gets an honest band rather than a false point.
  if (highDays <= lowDays) {
    highDays = lowDays * 1.5 + 0.1;
  }
  return { lowDays, highDays, fastRate, slowRate };
}

// Confidence: start high; degrade for blocked weight, noisy pace, and a
// mostly heavy/undesigned remainder - with the dominant reason in a word.
// Rules are listed in priority order: the first ACTIVE rule names the
// reason, exactly as the original if-chain only ever overwrote a still-
// 'steady' reason.
function computeConfidence(
  buildable: EpicEtaChild[],
  blockedWeight: number,
  buildableWeight: number,
  rate: RateRange
): { confidence: EpicEtaConfidence; confidenceReason: string } {
  const noiseRatio = rate.fastRate / rate.slowRate;
  const blockedFraction = blockedWeight / (blockedWeight + buildableWeight);
  const heavyFraction =
    buildable.filter((c) => (c.mutationCost ?? '').toLowerCase() === 'high').length / buildable.length;

  const rules = [
    { active: blockedFraction > 0, weight: blockedFraction > 0.5 ? 2 : 1, reason: 'blocked' },
    { active: noiseRatio > 3, weight: 1, reason: 'noisy' },
    { active: heavyFraction > 0.5, weight: 1, reason: 'heavy' },
  ];
  const applied = rules.filter((r) => r.active);
  const degradations = applied.reduce((sum, r) => sum + r.weight, 0);
  const confidenceReason = applied.length > 0 ? applied[0].reason : 'steady';
  const confidence: EpicEtaConfidence = degradations === 0 ? 'high' : degradations === 1 ? 'medium' : 'low';
  return { confidence, confidenceReason };
}

function resolvePackLabel(packLabel: string): string {
  return packLabel || 'unknown-pack';
}

function safeChildren(children: EpicEtaChild[]): EpicEtaChild[] {
  return Array.isArray(children) ? children : [];
}

// Every open child is blocked: no velocity number describes this work.
function blockedReason(blocked: EpicEtaChild[]): string {
  const anyDesign = blocked.some((c) => (c.statusText ?? '').toLowerCase() === 'needs_design');
  return anyDesign ? 'designing' : 'blocked';
}

export function estimateEpicEta(input: EpicEtaInput): EpicEtaState {
  const { open, blocked, buildable } = partitionOpen(safeChildren(input.children));
  if (open.length === 0) {
    return { kind: 'complete' };
  }

  const blockedCount = blocked.length;
  if (buildable.length === 0) {
    return { kind: 'blocked', reason: blockedReason(blocked), blockedCount };
  }

  // Invariant 2: the duration is a function of BUILDABLE weight only.
  const buildableWeight = weightSum(buildable);
  const blockedWeight = weightSum(blocked);

  const window = resolveWindow(input);
  if (!window) {
    return { kind: 'no-recent-pace', blockedCount };
  }

  const rate = computeRateRange(window, buildableWeight);
  if (!rate) {
    return { kind: 'no-recent-pace', blockedCount };
  }

  const { confidence, confidenceReason } = computeConfidence(buildable, blockedWeight, buildableWeight, rate);

  const windowDaysLabel = Math.max(1, Math.round(window.windowDays));
  const paceAssumption = `at current ${resolvePackLabel(input.packLabel)} pace over the trailing ${windowDaysLabel}d window`;

  return {
    kind: 'ranged',
    lowDays: round1(rate.lowDays),
    highDays: Math.max(round1(rate.highDays), round1(rate.lowDays) + 0.1),
    blockedCount,
    confidence,
    confidenceReason,
    paceAssumption,
  };
}
