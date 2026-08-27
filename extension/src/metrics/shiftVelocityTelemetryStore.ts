// BL-1184: optional append-only shift-velocity telemetry when no existing series.

import * as fs from 'fs';
import * as path from 'path';

export interface ShiftVelocityTelemetryRecord {
  at: string;
  dayLabel: string;
  landedMax: number;
  windowHours: number;
}

export const SHIFT_VELOCITY_TELEMETRY_GLOB = 'shift-velocity-*.jsonl';

export function shiftVelocityTelemetryDir(mainWorktreePath: string): string {
  return path.join(mainWorktreePath, '.swarmforge', 'telemetry');
}

function monthKey(isoInstant: string): string {
  return isoInstant.slice(0, 7);
}

export function shiftVelocityLedgerPath(mainWorktreePath: string, atIso: string = new Date().toISOString()): string {
  return path.join(shiftVelocityTelemetryDir(mainWorktreePath), `shift-velocity-${monthKey(atIso)}.jsonl`);
}

export function listShiftVelocityLedgerFiles(mainWorktreePath: string): string[] {
  const dir = shiftVelocityTelemetryDir(mainWorktreePath);
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => /^shift-velocity-\d{4}-\d{2}\.jsonl$/.test(n))
      .map((n) => path.join(dir, n))
      .sort();
  } catch {
    return [];
  }
}

export function hasShiftVelocityTelemetry(mainWorktreePath: string): boolean {
  return listShiftVelocityLedgerFiles(mainWorktreePath).length > 0;
}

function isTelemetryRecordShape(c: Partial<ShiftVelocityTelemetryRecord>): c is ShiftVelocityTelemetryRecord {
  return (
    typeof c.at === 'string' &&
    typeof c.dayLabel === 'string' &&
    typeof c.landedMax === 'number' &&
    typeof c.windowHours === 'number'
  );
}

function parseRecord(line: string): ShiftVelocityTelemetryRecord | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== 'object') return null;
    const c = parsed as Partial<ShiftVelocityTelemetryRecord>;
    return isTelemetryRecordShape(c) ? { at: c.at, dayLabel: c.dayLabel, landedMax: c.landedMax, windowHours: c.windowHours } : null;
  } catch {
    return null;
  }
}

export function readShiftVelocityRecords(mainWorktreePath: string): ShiftVelocityTelemetryRecord[] {
  const records: ShiftVelocityTelemetryRecord[] = [];
  for (const filePath of listShiftVelocityLedgerFiles(mainWorktreePath)) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf8');
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

export function appendShiftVelocityRecord(mainWorktreePath: string, record: ShiftVelocityTelemetryRecord): void {
  try {
    const filePath = shiftVelocityLedgerPath(mainWorktreePath, record.at);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
  } catch {
    // fire-and-forget
  }
}
