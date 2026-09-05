import * as fs from 'fs';
import * as path from 'path';
import { INTERVAL_CATEGORIES, coverageFromIntervals, walkTranscriptFiles } from './transcriptWalker';
import type { ClassifiedInterval, HandoffTrailEntry, IntervalCategory } from './transcriptWalker';
import { buildTurnProfileSeries } from './turnProfile';
import { listTranscriptJsonlPaths } from './transcriptUsage';
import { RoleWorktree, groupRolesByWorktreePath } from './swarmMetrics';

/**
 * BL-1364: the production consumer of BL-664's buildTurnProfileSeries.
 *
 * The walker and the series builder both shipped and were both tested; the
 * series builder simply had no caller, so no mechanical-share trend ever
 * existed and two epics that sequenced themselves behind that number
 * proceeded without it. This module is the missing call site plus somewhere
 * durable to put the answer, in the shape contextTelemetryProducer.ts (the
 * sibling that already walks the same transcripts) established.
 *
 * It adds no classifier and no instrumentation. What it does add is the
 * fail-closed posture the raw walker does not have: walkTranscriptFiles
 * silently SKIPS a path it cannot stat, which would quietly turn a partly
 * unreadable window into a smaller, plausible-looking one.
 */

export const TURN_PROFILE_STORE_FILE = 'turn-profile-series.jsonl';

export interface TranscriptReadability {
  readable: string[];
  unreadable: string[];
  /**
   * Readable, but the FINAL line was torn - a transcript its agent is still
   * appending to. Reported so the condition stays visible rather than hidden
   * inside "readable"; see assessTranscriptReadability for why it is not
   * treated as damage.
   */
  truncatedTail: string[];
}

export interface TurnProfileStageRecord {
  stage: string;
  mechanical_share: number;
  turn_overhead_share: number;
  category_shares: Record<IntervalCategory, number>;
}

export interface TurnProfileWindowRecord {
  /**
   * UTC date of window_end. The store keeps ONE row per day, upserted: the
   * walk's window widens on every daemon tick (the transcripts keep growing),
   * so keying on the exact window would append a new row every cycle and the
   * store would grow without bound while claiming to be idempotent.
   */
  window_day: string | null;
  window_start: string | null;
  window_end: string | null;
  complete: boolean;
  unreadable_transcripts: string[];
  /** Readable, final line still being written; recorded, not hidden. */
  truncated_tail_transcripts: string[];
  stages: TurnProfileStageRecord[];
}

/**
 * A transcript is UNREADABLE if it cannot be read at all, or if a line fails
 * to parse with any complete line after it - interior damage, where something
 * is genuinely wrong with the file.
 *
 * A torn FINAL line is different in kind and is tolerated. It is the ordinary
 * shape of a JSONL file sampled while its writer is mid-append: the last
 * record is not finished being written, so it is not yet part of the window,
 * and every record before it is whole. Measured on the live repo on
 * 2026-09-05, 6 of 2256 role transcripts had exactly this shape - every one a
 * final line only, all six belonging to agents working at that moment.
 * Treating them as damage made the producer report INCOMPLETE for the entire
 * 2256-transcript window, so it could never publish a share at all, which is
 * the very outcome this ticket exists to end. The torn line is dropped (the
 * walker already ignores an unparseable line) and named in truncatedTail, so
 * the condition is recorded rather than silently absorbed.
 *
 * This distinction is a coder reading of invariant 2's "unreadable or partial"
 * and was raised to the specifier by priority-00 note in the same pass.
 */
export function assessTranscriptReadability(transcriptPaths: string[]): TranscriptReadability {
  const readable: string[] = [];
  const unreadable: string[] = [];
  const truncatedTail: string[] = [];
  for (const filePath of transcriptPaths) {
    let text: string;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch {
      unreadable.push(filePath);
      continue;
    }
    const lines = text.split('\n').filter((line) => line.trim());
    const badIndexes: number[] = [];
    lines.forEach((line, index) => {
      try {
        JSON.parse(line);
      } catch {
        badIndexes.push(index);
      }
    });
    if (badIndexes.length === 0) {
      readable.push(filePath);
    } else if (badIndexes.length === 1 && badIndexes[0] === lines.length - 1) {
      readable.push(filePath);
      truncatedTail.push(filePath);
    } else {
      unreadable.push(filePath);
    }
  }
  return { readable, unreadable, truncatedTail };
}

/**
 * The ONE place a window record is assembled. Both entry points below go
 * through it: the shape was briefly built twice and `window_day` had to be
 * added to each copy, which is precisely how two builders of the same record
 * drift apart (BL-897's shape, one level down).
 *
 * Fail closed: one unreadable transcript and NO stage from that window
 * reports a share. Reporting the readable remainder would publish a number
 * that looks like a measurement and is not one.
 */
function assembleWindowRecord(
  intervals: ClassifiedInterval[],
  unreadable: string[],
  truncatedTail: string[]
): TurnProfileWindowRecord {
  if (unreadable.length > 0) {
    return {
      window_day: null,
      window_start: null,
      window_end: null,
      complete: false,
      unreadable_transcripts: unreadable,
      truncated_tail_transcripts: truncatedTail,
      stages: [],
    };
  }
  const coverage = coverageFromIntervals(intervals);
  const series = buildTurnProfileSeries(intervals, coverage);
  const endIso = coverage ? new Date(coverage.endMs).toISOString() : null;
  return {
    window_day: endIso ? endIso.slice(0, 10) : null,
    window_start: coverage ? new Date(coverage.startMs).toISOString() : null,
    window_end: endIso,
    complete: true,
    unreadable_transcripts: [],
    truncated_tail_transcripts: truncatedTail,
    // Only stages the walker actually saw intervals for reach the series, so a
    // stage nobody worked is ABSENT rather than present at zero (invariant 1).
    // Nothing here seeds a stage list, and nothing downstream should.
    stages: series.stages.map((entry) => ({
      stage: entry.stage,
      mechanical_share: entry.mechanicalShare.value,
      turn_overhead_share: entry.turnOverheadShare.value,
      category_shares: entry.categoryShares,
    })),
  };
}

/**
 * Single-group entry point: stages come from time-matching a handoff trail.
 */
export function buildTurnProfileWindowRecord(params: {
  transcriptPaths: string[];
  handoffTrail?: HandoffTrailEntry[];
}): TurnProfileWindowRecord {
  const { readable, unreadable, truncatedTail } = assessTranscriptReadability(params.transcriptPaths);
  const intervals =
    unreadable.length > 0 ? [] : walkTranscriptFiles(readable, params.handoffTrail ?? []).intervals;
  return assembleWindowRecord(intervals, unreadable, truncatedTail);
}

export interface TranscriptGroup {
  stage: string;
  transcriptPaths: string[];
}

/**
 * The per-stage walk. A transcript living in a role's worktree IS that role's
 * turn, so the stage comes from the worktree rather than from time-matching
 * against a handoff trail - walking every role's transcripts in one
 * undifferentiated pass attributes everything to 'unknown' and produces a
 * single meaningless row, which is what the first live run of this producer
 * actually did.
 *
 * Fail-closed across groups: one unreadable transcript in ANY group refuses
 * the whole window, since a per-stage share is only comparable when every
 * stage in it was measured over the same window (invariant 2).
 */
export function buildTurnProfileWindowForGroups(groups: TranscriptGroup[]): TurnProfileWindowRecord {
  const intervals: ClassifiedInterval[] = [];
  const unreadable: string[] = [];
  const truncatedTail: string[] = [];
  for (const group of groups) {
    const readability = assessTranscriptReadability(group.transcriptPaths);
    unreadable.push(...readability.unreadable);
    truncatedTail.push(...readability.truncatedTail);
    if (readability.unreadable.length > 0) {
      continue;
    }
    for (const row of walkTranscriptFiles(readability.readable).intervals) {
      intervals.push({ ...row, stage: group.stage });
    }
  }
  return assembleWindowRecord(intervals, unreadable, truncatedTail);
}

/** Idempotency key: one row per UTC day - see TurnProfileWindowRecord.window_day. */
export function windowDedupeKey(record: Pick<TurnProfileWindowRecord, 'window_day' | 'complete'>): string {
  return `${record.window_day ?? 'none'}:${record.complete}`;
}

export function turnProfileStorePath(telemetryDir: string): string {
  return path.join(telemetryDir, TURN_PROFILE_STORE_FILE);
}

export function readPersistedTurnProfileWindows(telemetryDir: string): TurnProfileWindowRecord[] {
  const filePath = turnProfileStorePath(telemetryDir);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as TurnProfileWindowRecord);
}

export function filterNewTurnProfileWindows(
  existing: TurnProfileWindowRecord[],
  derived: TurnProfileWindowRecord[]
): TurnProfileWindowRecord[] {
  const seen = new Set(existing.map(windowDedupeKey));
  return derived.filter((record) => !seen.has(windowDedupeKey(record)));
}

/**
 * Upsert by window_day: the day's row is REPLACED rather than appended, so a
 * store driven by an every-tick daemon sweep stays one row per day and always
 * carries that day's latest numbers. Appending instead would grow the file on
 * every cycle - each tick's window ends a little later than the last - which
 * is duplication wearing an idempotent key.
 */
function upsertWindowRecord(telemetryDir: string, record: TurnProfileWindowRecord): void {
  fs.mkdirSync(telemetryDir, { recursive: true });
  const kept = readPersistedTurnProfileWindows(telemetryDir).filter(
    (row) => windowDedupeKey(row) !== windowDedupeKey(record)
  );
  kept.push(record);
  fs.writeFileSync(
    turnProfileStorePath(telemetryDir),
    `${kept.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8'
  );
}

export interface TurnProfileProducerResult {
  recorded: number;
  updated: number;
  stages: string[];
  complete: boolean;
}

/**
 * `writeFn` is the injected side-effect seam (never a *_FORCE_RESULT env
 * bypass): a test drives the real derivation and observes what would be
 * written without needing a writable telemetry dir.
 */
export function runTurnProfileProducer(params: {
  repoRoot: string;
  roleWorktrees: RoleWorktree[];
  claudeProjectsDir?: string;
  writeFn?: (record: TurnProfileWindowRecord) => void;
}): TurnProfileProducerResult {
  const telemetryDir = path.join(params.repoRoot, '.swarmforge', 'telemetry');
  const existing = readPersistedTurnProfileWindows(telemetryDir);

  const groups: TranscriptGroup[] = groupRolesByWorktreePath(params.roleWorktrees).map((group) => ({
    stage: group[0].role,
    transcriptPaths: listTranscriptJsonlPaths(group[0].worktreePath, params.claudeProjectsDir),
  }));

  const derived = buildTurnProfileWindowForGroups(groups);
  const isNew = filterNewTurnProfileWindows(existing, [derived]).length === 1;
  const writeFn = params.writeFn ?? ((record) => upsertWindowRecord(telemetryDir, record));
  writeFn(derived);

  return {
    recorded: isNew ? 1 : 0,
    updated: isNew ? 0 : 1,
    stages: derived.stages.map((entry) => entry.stage),
    complete: derived.complete,
  };
}

/** Exposed so a consumer can enumerate categories without restating them. */
export const TURN_PROFILE_CATEGORIES = INTERVAL_CATEGORIES;
