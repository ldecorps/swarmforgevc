// BL-595: append-only human-loop reliability ledger under
// `.swarmforge/telemetry/human-loop-YYYY-MM.jsonl`.
//
// Emit is fire-and-forget async (never awaits on the caller's hot path): a
// naive sync append on every concierge tick would deepen the stall series 4
// exists to detect. Write failures are swallowed so measuring never changes
// what is measured.

import * as fs from 'fs';
import * as path from 'path';
import {
  HumanLoopRecord,
  HumanLoopOutcomeRecord,
  HumanLoopTickRecord,
  isOutcomeRecord,
  isTickRecord,
} from './humanLoopReliability';

export function humanLoopTelemetryDir(mainWorktreePath: string): string {
  return path.join(mainWorktreePath, '.swarmforge', 'telemetry');
}

function monthKey(isoInstant: string): string {
  return isoInstant.slice(0, 7);
}

export function humanLoopLedgerFileForMonth(mainWorktreePath: string, month: string): string {
  return path.join(humanLoopTelemetryDir(mainWorktreePath), `human-loop-${month}.jsonl`);
}

export function humanLoopLedgerPath(mainWorktreePath: string, atIso: string = new Date().toISOString()): string {
  return humanLoopLedgerFileForMonth(mainWorktreePath, monthKey(atIso));
}

// Chain of in-flight writes so tests can await quiescence without the
// front-desk hot path ever awaiting. Failures never reject the chain.
let emitChain: Promise<void> = Promise.resolve();

function appendLineAsync(filePath: string, line: string): void {
  emitChain = emitChain
    .then(
      () =>
        new Promise<void>((resolve) => {
          fs.mkdir(path.dirname(filePath), { recursive: true }, (mkdirErr) => {
            if (mkdirErr) {
              resolve();
              return;
            }
            fs.appendFile(filePath, line, () => resolve());
          });
        })
    )
    .catch(() => undefined);
}

/** Await pending emits (tests only). Production callers must not await. */
export function whenHumanLoopIdle(): Promise<void> {
  return emitChain;
}

/** Fire-and-forget append. Never throws; never blocks the caller. */
export function emitHumanLoopRecord(
  mainWorktreePath: string,
  record: HumanLoopRecord
): void {
  try {
    const filePath = humanLoopLedgerPath(mainWorktreePath, record.at);
    appendLineAsync(filePath, `${JSON.stringify(record)}\n`);
  } catch {
    // swallow
  }
}

export function emitApprovalTap(
  mainWorktreePath: string,
  outcome: string,
  reason?: string,
  atIso: string = new Date().toISOString()
): void {
  const record: HumanLoopOutcomeRecord = reason
    ? { at: atIso, series: 'approval-tap', outcome, reason }
    : { at: atIso, series: 'approval-tap', outcome };
  emitHumanLoopRecord(mainWorktreePath, record);
}

export function emitSteeringDelivery(
  mainWorktreePath: string,
  outcome: string,
  atIso: string = new Date().toISOString()
): void {
  emitHumanLoopRecord(mainWorktreePath, {
    at: atIso,
    series: 'steering-delivery',
    outcome,
  });
}

export function emitPollHealth(
  mainWorktreePath: string,
  outcome: string,
  atIso: string = new Date().toISOString()
): void {
  emitHumanLoopRecord(mainWorktreePath, {
    at: atIso,
    series: 'poll-health',
    outcome,
  });
}

export function emitTickDuration(
  mainWorktreePath: string,
  durationMs: number,
  atIso: string = new Date().toISOString()
): void {
  const record: HumanLoopTickRecord = {
    at: atIso,
    series: 'tick-duration',
    durationMs,
  };
  emitHumanLoopRecord(mainWorktreePath, record);
}

function parseRecord(line: string): HumanLoopRecord | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<HumanLoopRecord>;
    if (typeof candidate.at !== 'string' || typeof candidate.series !== 'string') {
      return null;
    }
    if (candidate.series === 'tick-duration') {
      const durationMs = Number((candidate as HumanLoopTickRecord).durationMs);
      return Number.isFinite(durationMs)
        ? { at: candidate.at, series: 'tick-duration', durationMs }
        : null;
    }
    if (typeof (candidate as HumanLoopOutcomeRecord).outcome !== 'string') {
      return null;
    }
    const outcome = candidate as HumanLoopOutcomeRecord;
    return outcome.reason
      ? { at: outcome.at, series: outcome.series, outcome: outcome.outcome, reason: outcome.reason }
      : { at: outcome.at, series: outcome.series, outcome: outcome.outcome };
  } catch {
    return null;
  }
}

/** Sync read for tests/aggregators — callers that already hold records in memory skip this. */
export function readHumanLoopRecords(mainWorktreePath: string): HumanLoopRecord[] {
  const dir = humanLoopTelemetryDir(mainWorktreePath);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => /^human-loop-\d{4}-\d{2}\.jsonl$/.test(n));
  } catch {
    return [];
  }
  const records: HumanLoopRecord[] = [];
  for (const name of names.sort()) {
    let content: string;
    try {
      content = fs.readFileSync(path.join(dir, name), 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      const record = parseRecord(line);
      if (record) records.push(record);
    }
  }
  return records;
}

export function readOutcomeRecords(mainWorktreePath: string): HumanLoopOutcomeRecord[] {
  return readHumanLoopRecords(mainWorktreePath).filter(isOutcomeRecord);
}

export function readTickRecords(mainWorktreePath: string): HumanLoopTickRecord[] {
  return readHumanLoopRecords(mainWorktreePath).filter(isTickRecord);
}
