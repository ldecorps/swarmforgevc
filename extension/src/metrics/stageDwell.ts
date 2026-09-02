import { extractTicketId, PIPELINE_ORDER, readHandoffHeaderRecordsWithBatches } from './swarmMetrics';
import { computeTrend, TrendResult, TrendSeriesPoint } from './trend';
import { RoleEntry, mailboxDir, stageOfSeat } from '../swarm/swarmState';

// BL-102: the coordinator's core optimizer instrument - per-stage queue-wait
// and processing dwell, a bottleneck line, and outlier honesty - derived
// purely from each role's own completed handoff audit headers. Header
// parsing/derivation below is pure over already-read header records
// (dwell-01/02/03, unit-tested with fabricated data); only
// readRoleStageDwellRecords/computeStageDwellReportForRoles touch the
// filesystem, mirroring ticketHoldingWindows.ts's own pure/fs-adapter split.

export interface DwellRecord {
  role: string;
  ticketId: string | null;
  /** null when enqueued_at is absent/unparsable - processing is still counted. */
  queueWaitMs: number | null;
  processingMs: number;
  completedAtMs: number;
}

export interface DwellStats {
  medianMs: number | null;
  p90Ms: number | null;
  maxMs: number | null;
  outliersMs: number[];
}

export interface StageDwellReport {
  role: string;
  parcelsProcessed: number;
  queueWait: DwellStats;
  processing: DwellStats;
  trend: TrendResult;
}

export interface BottleneckSummary {
  role: string;
  /** Queue wait + processing median for the named stage - unchanged meaning from before BL-909; kept for existing readers, but no longer what decides the ranking below. */
  totalDwellMs: number;
  /** BL-909: the processing-only median that actually decided which stage is named - a dormant stage's queue wait (mailbox time while the resident plays another role) never contributes here. */
  processingDwellMs: number;
  /** null when this is the only stage with data - nothing to compare against. BL-909: derived from processing medians only, never queue-wait-inclusive totals. */
  multipleOverNext: number | null;
}

export interface StageDwellReportResult {
  windowHours: number;
  windowStartIso: string;
  windowEndIso: string;
  stages: StageDwellReport[];
  bottleneck: BottleneckSummary | null;
  unparseableCount: number;
}

export const DEFAULT_STAGE_DWELL_WINDOW_HOURS = 24;

// ── pure: header record -> DwellRecord ──────────────────────────────────

function parseMsOrNaN(iso: string | undefined): number {
  return iso ? Date.parse(iso) : NaN;
}

// A dequeued_at/completed_at pair only means something for dwell purposes
// when both parse and land in order; anything else is unparseable per this
// ticket's "missing/partial headers degrade per-item" gate.
function isValidDwellWindow(dequeuedMs: number, completedMs: number): boolean {
  return !Number.isNaN(dequeuedMs) && !Number.isNaN(completedMs) && completedMs >= dequeuedMs;
}

// null when enqueued_at is absent/unparsable or out of order - processing is
// still counted in that case, only queue-wait is unknown.
function computeQueueWaitMs(enqueuedMs: number, dequeuedMs: number): number | null {
  return !Number.isNaN(enqueuedMs) && dequeuedMs >= enqueuedMs ? dequeuedMs - enqueuedMs : null;
}

// Split out of deriveDwellRecords, and further split into the two helpers
// above, so each function stays under the CRAP<=6 gate.
function deriveOneDwellRecord(role: string, headers: Record<string, string>): DwellRecord | null {
  const dequeuedMs = parseMsOrNaN(headers.dequeued_at);
  const completedMs = parseMsOrNaN(headers.completed_at);
  if (!isValidDwellWindow(dequeuedMs, completedMs)) {
    return null;
  }
  const enqueuedMs = parseMsOrNaN(headers.enqueued_at);
  return {
    role,
    ticketId: headers.task ? extractTicketId(headers.task) : null,
    queueWaitMs: computeQueueWaitMs(enqueuedMs, dequeuedMs),
    processingMs: completedMs - dequeuedMs,
    completedAtMs: completedMs,
  };
}

export function deriveDwellRecords(
  headerRecords: Array<Record<string, string>>,
  role: string
): { records: DwellRecord[]; unparseableCount: number } {
  const records: DwellRecord[] = [];
  let unparseableCount = 0;
  for (const headers of headerRecords) {
    const record = deriveOneDwellRecord(role, headers);
    if (record) {
      records.push(record);
    } else {
      unparseableCount++;
    }
  }
  return { records, unparseableCount };
}

// ── pure: stats + outlier honesty (dwell-03) ────────────────────────────

function median(sorted: number[]): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function quartile(sorted: number[], q: number): number {
  const idx = (sorted.length - 1) * q;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

// Fewer than this many points can't support a meaningful quartile fence -
// every point reads as normal rather than flagging noise as an "outlier".
const MIN_SAMPLES_FOR_OUTLIER_DETECTION = 4;

// Upper-fence-only IQR split: dwell times only become a problem when they
// run long, so only the slow tail is ever worth calling out separately
// (dwell-03: "one extreme parcel... the outlier is listed separately").
export function splitOutliers(durationsMs: number[]): { normal: number[]; outliers: number[] } {
  if (durationsMs.length < MIN_SAMPLES_FOR_OUTLIER_DETECTION) {
    return { normal: [...durationsMs], outliers: [] };
  }
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const q1 = quartile(sorted, 0.25);
  const q3 = quartile(sorted, 0.75);
  const upperFence = q3 + 1.5 * (q3 - q1);
  return {
    normal: sorted.filter((v) => v <= upperFence),
    outliers: sorted.filter((v) => v > upperFence),
  };
}

export function computeDwellStats(durationsMs: number[]): DwellStats {
  const { normal, outliers } = splitOutliers(durationsMs);
  const sorted = [...normal].sort((a, b) => a - b);
  return {
    medianMs: median(sorted),
    p90Ms: percentile(sorted, 90),
    maxMs: sorted.length > 0 ? sorted[sorted.length - 1] : null,
    outliersMs: outliers,
  };
}

// ── pure: per-stage report + trend (dwell-01) ───────────────────────────

// A stage's dwell figure for trend/bottleneck ranking: median queue wait
// (0 when never measured) plus median processing. null when the stage
// processed nothing this period - there is no dwell to report or compare.
function stageTotalDwellMs(queueWait: DwellStats, processing: DwellStats): number | null {
  return processing.medianMs === null ? null : (queueWait.medianMs ?? 0) + processing.medianMs;
}

function trendSeries(priorTotalMs: number | null, priorIso: string, currentTotalMs: number | null, currentIso: string): TrendSeriesPoint[] {
  const series: TrendSeriesPoint[] = [];
  if (priorTotalMs !== null) {
    series.push({ periodStart: priorIso, value: priorTotalMs });
  }
  if (currentTotalMs !== null) {
    series.push({ periodStart: currentIso, value: currentTotalMs });
  }
  return series;
}

export function buildStageDwellReport(
  role: string,
  currentRecords: DwellRecord[],
  priorRecords: DwellRecord[],
  currentPeriodStartIso: string,
  priorPeriodStartIso: string
): StageDwellReport {
  const queueWait = computeDwellStats(currentRecords.map((r) => r.queueWaitMs).filter((v): v is number => v !== null));
  const processing = computeDwellStats(currentRecords.map((r) => r.processingMs));

  const priorQueueWait = computeDwellStats(priorRecords.map((r) => r.queueWaitMs).filter((v): v is number => v !== null));
  const priorProcessing = computeDwellStats(priorRecords.map((r) => r.processingMs));

  const currentTotalMs = stageTotalDwellMs(queueWait, processing);
  const priorTotalMs = stageTotalDwellMs(priorQueueWait, priorProcessing);
  const trend = computeTrend(trendSeries(priorTotalMs, priorPeriodStartIso, currentTotalMs, currentPeriodStartIso));

  return { role, parcelsProcessed: currentRecords.length, queueWait, processing, trend };
}

// ── pure: bottleneck naming (dwell-02) ──────────────────────────────────

// BL-909: ranks on median PROCESSING time alone - queue wait is real
// dormancy (mailbox time while a mono-router's single resident plays
// another role), not capacity, and the human's ruling was to fix the
// formula for every dormant role rather than exclude any one of them. The
// per-stage lines still report queue wait alongside processing (unchanged);
// only which stage gets named, and its multiple, ranks on processing.
//
// BL-1319: the role a row carries is folded to its STAGE before ranking.
// computeStageDwellReportForRoles below already hands this function
// stage-keyed rows, but nameBottleneck is exported and ranks whatever it is
// given, and naming a SEAT as the bottleneck tells the coordinator to
// optimize something that is not a stage.
export function nameBottleneck(stages: StageDwellReport[]): BottleneckSummary | null {
  const withProcessing = stages
    .map((s) => ({ role: stageOfSeat(s.role), processingMs: s.processing.medianMs, totalMs: stageTotalDwellMs(s.queueWait, s.processing) }))
    .filter((s): s is { role: string; processingMs: number; totalMs: number } => s.processingMs !== null && s.processingMs > 0)
    .sort((a, b) => b.processingMs - a.processingMs);

  if (withProcessing.length === 0) {
    return null;
  }
  const [top, next] = withProcessing;
  return {
    role: top.role,
    totalDwellMs: top.totalMs,
    processingDwellMs: top.processingMs,
    multipleOverNext: next ? top.processingMs / next.processingMs : null,
  };
}

// BL-1319 ops seat-detail (human ruling: "Fold plus ops seat-detail - build
// the seat-and-model view in this same slice"). The stage fold above is what
// makes the OPTIMIZER's answer correct; it also makes per-seat work invisible
// everywhere, and this is the sanctioned surface that brings it back. It
// reads the per-seat attribution the fold deliberately preserved rather than
// re-deriving anything.
//
// Deliberately NOT folded into StageDwellReportResult: the bridge serves that
// shape on /stage-dwell, and this ticket requires that payload to carry no
// seat id. Ops surfaces may show seat detail; the optimizer payload may not.
export interface SeatDwellDetail {
  /** The stage this seat belongs to - the fold's key, so ops and optimizer agree. */
  stage: string;
  /** The seat id as roles.tsv spells it. Bare for a single-seat stage. */
  seat: string;
  /** The configured agent/provider brand. 'unknown' for a short TSV row - never invented. */
  agent: string;
  parcelsProcessed: number;
  queueWait: DwellStats;
  processing: DwellStats;
}

export const SEAT_DWELL_UNKNOWN_AGENT = 'unknown';

export function computeSeatDwellDetail(
  roles: Array<Pick<RoleEntry, 'role' | 'worktreeName' | 'worktreePath' | 'agent'>>,
  nowMs: number = Date.now(),
  windowHours: number = DEFAULT_STAGE_DWELL_WINDOW_HOURS
): SeatDwellDetail[] {
  const windowStartMs = nowMs - windowHours * 60 * 60 * 1000;
  return roles
    .filter((entry) => (PIPELINE_ORDER as string[]).includes(stageOfSeat(entry.role)))
    .map((entry) => {
      const { records } = readRoleStageDwellRecords(entry, windowStartMs, nowMs);
      return {
        stage: stageOfSeat(entry.role),
        seat: entry.role,
        agent: entry.agent && entry.agent.length > 0 ? entry.agent : SEAT_DWELL_UNKNOWN_AGENT,
        parcelsProcessed: records.length,
        queueWait: computeDwellStats(records.map((r) => r.queueWaitMs).filter((v): v is number => v !== null)),
        processing: computeDwellStats(records.map((r) => r.processingMs)),
      };
    });
}

// ── fs adapter: completed handoffs, including batch_* dirs (dwell-04) ───

// Reads one role's completed dwell records in [earliestMs, latestMs), via
// its correctly-resolved mailbox dir (mailboxDir handles the master-resident
// coordinator/specifier nesting - never hand-construct this path). A
// completed batch role moves its whole completed batch into a batch_*
// subdirectory (done_with_current_batch.sh), so the walk must include those
// (dwell-04) - swarmMetrics.ts's shared batch-aware reader already does
// this for ticketHoldingWindows.ts's in_process read. Absent directories
// read as zero records, never an error.
export function readRoleStageDwellRecords(
  entry: Pick<RoleEntry, 'role' | 'worktreeName' | 'worktreePath'>,
  earliestMs: number,
  latestMs: number
): { records: DwellRecord[]; unparseableCount: number } {
  const completedDir = mailboxDir(entry, 'inbox', 'completed');
  const headerRecords = readHandoffHeaderRecordsWithBatches(completedDir);
  const { records, unparseableCount } = deriveDwellRecords(headerRecords, entry.role);
  return {
    records: records.filter((r) => r.completedAtMs >= earliestMs && r.completedAtMs < latestMs),
    unparseableCount,
  };
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

// Full orchestration: every pipeline stage (never the coordinator, which
// sits outside the forward chain), current window vs the immediately prior
// window of the same length, bottleneck named across stages.
export function computeStageDwellReportForRoles(
  roles: Array<Pick<RoleEntry, 'role' | 'worktreeName' | 'worktreePath'>>,
  nowMs: number = Date.now(),
  windowHours: number = DEFAULT_STAGE_DWELL_WINDOW_HOURS
): StageDwellReportResult {
  const windowMs = windowHours * 60 * 60 * 1000;
  const windowStartMs = nowMs - windowMs;
  const priorStartMs = windowStartMs - windowMs;
  const windowStartIso = toIso(windowStartMs);

  // BL-1319: seats of one stage merge into ONE row, and the merge happens
  // BEFORE nameBottleneck ranks - after it picks would leave the wrong-answer
  // consequence intact. Filtering on the FOLDED stage matters as much as the
  // merge: PIPELINE_ORDER holds bare stage names only, so a non-bare seat
  // used to fail this filter and be dropped entirely, reporting the stage as
  // though the seat's parcels never happened. Per-seat attribution stays in
  // the DwellRecords themselves (record.role is the seat that worked the
  // parcel) - folding is a REPORTING concern, and the ops seat view below
  // reads exactly those preserved records.
  const seatsByStage = new Map<string, Array<Pick<RoleEntry, 'role' | 'worktreeName' | 'worktreePath'>>>();
  for (const entry of roles) {
    const stage = stageOfSeat(entry.role);
    if (!(PIPELINE_ORDER as string[]).includes(stage)) {
      continue;
    }
    const seats = seatsByStage.get(stage);
    if (seats) {
      seats.push(entry);
    } else {
      seatsByStage.set(stage, [entry]);
    }
  }
  let unparseableCount = 0;

  const stages = [...seatsByStage.entries()].map(([stage, seats]) => {
    const records: DwellRecord[] = [];
    for (const entry of seats) {
      const read = readRoleStageDwellRecords(entry, priorStartMs, nowMs);
      unparseableCount += read.unparseableCount;
      records.push(...read.records);
    }
    const currentRecords = records.filter((r) => r.completedAtMs >= windowStartMs);
    const priorRecords = records.filter((r) => r.completedAtMs < windowStartMs);
    return buildStageDwellReport(stage, currentRecords, priorRecords, windowStartIso, toIso(priorStartMs));
  });

  return {
    windowHours,
    windowStartIso,
    windowEndIso: toIso(nowMs),
    stages,
    bottleneck: nameBottleneck(stages),
    unparseableCount,
  };
}
