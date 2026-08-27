// BL-601: append-only compaction telemetry under
// `.swarmforge/telemetry/compaction-YYYY-MM.jsonl` — derived from structured
// context-events with compaction:true. Fire-and-forget; write failures swallowed.

import * as fs from 'fs';
import * as path from 'path';
import {
  CompactionRecord,
  ContextCompactionEvent,
  deriveCompactionRecordFromContextEvent,
} from './compactionCadence';

export function compactionTelemetryDir(mainWorktreePath: string): string {
  return path.join(mainWorktreePath, '.swarmforge', 'telemetry');
}

function monthKey(isoInstant: string): string {
  return isoInstant.slice(0, 7);
}

export function compactionLedgerFileForMonth(mainWorktreePath: string, month: string): string {
  return path.join(compactionTelemetryDir(mainWorktreePath), `compaction-${month}.jsonl`);
}

export function compactionLedgerPath(
  mainWorktreePath: string,
  atIso: string = new Date().toISOString()
): string {
  return compactionLedgerFileForMonth(mainWorktreePath, monthKey(atIso));
}

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

export function whenCompactionTelemetryIdle(): Promise<void> {
  return emitChain;
}

export function emitCompactionRecord(mainWorktreePath: string, record: CompactionRecord): void {
  try {
    const filePath = compactionLedgerPath(mainWorktreePath, record.timestamp);
    appendLineAsync(filePath, `${JSON.stringify(record)}\n`);
  } catch {
    // swallow
  }
}

export function emitCompactionFromContextEvent(
  mainWorktreePath: string,
  event: ContextCompactionEvent
): CompactionRecord | null {
  const record = deriveCompactionRecordFromContextEvent(event);
  if (record) {
    emitCompactionRecord(mainWorktreePath, record);
  }
  return record;
}

export function readCompactionRecords(mainWorktreePath: string, filePath?: string): CompactionRecord[] {
  const target = filePath ?? compactionLedgerPath(mainWorktreePath);
  if (!fs.existsSync(target)) {
    return [];
  }
  return fs
    .readFileSync(target, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CompactionRecord);
}
