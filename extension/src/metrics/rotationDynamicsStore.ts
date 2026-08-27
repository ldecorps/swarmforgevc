// BL-596: read append-only rotation telemetry and emit rotation events for tests.

import * as fs from 'fs';
import * as path from 'path';
import { RotationEvent } from './rotationDynamics';

export function rotationTelemetryDir(mainWorktreePath: string): string {
  return path.join(mainWorktreePath, '.swarmforge', 'telemetry');
}

function monthKey(isoInstant: string): string {
  return isoInstant.slice(0, 7);
}

export function rotationLedgerFileForMonth(mainWorktreePath: string, month: string): string {
  return path.join(rotationTelemetryDir(mainWorktreePath), `rotation-${month}.jsonl`);
}

export function rotationLedgerPath(
  mainWorktreePath: string,
  atIso: string = new Date().toISOString()
): string {
  return rotationLedgerFileForMonth(mainWorktreePath, monthKey(atIso));
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

export function whenRotationTelemetryIdle(): Promise<void> {
  return emitChain;
}

function parseRotationLine(line: string): RotationEvent | null {
  try {
    const raw = JSON.parse(line) as Partial<RotationEvent>;
    if (
      typeof raw.at !== 'string' ||
      typeof raw.from !== 'string' ||
      typeof raw.to !== 'string'
    ) {
      return null;
    }
    return {
      at: raw.at,
      from: raw.from,
      to: raw.to,
      reason: typeof raw.reason === 'string' ? raw.reason : 'rotate',
    };
  } catch {
    return null;
  }
}

export function readRotationEvents(mainWorktreePath: string): RotationEvent[] {
  const dir = rotationTelemetryDir(mainWorktreePath);
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^rotation-\d{4}-\d{2}\.jsonl$/.test(f))
    .sort();
  const out: RotationEvent[] = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const ev = parseRotationLine(trimmed);
      if (ev) out.push(ev);
    }
  }
  return out;
}

/** Fire-and-forget append matching rotation_telemetry_lib.bb shape. */
export function emitRotationEvent(
  mainWorktreePath: string,
  event: Omit<RotationEvent, 'at'> & { at?: string }
): void {
  try {
    const at = event.at ?? new Date().toISOString();
    const record: RotationEvent = {
      at,
      from: event.from,
      to: event.to,
      reason: event.reason ?? 'rotate',
    };
    appendLineAsync(rotationLedgerPath(mainWorktreePath, at), `${JSON.stringify(record)}\n`);
  } catch {
    // swallow — observability must not block callers
  }
}
