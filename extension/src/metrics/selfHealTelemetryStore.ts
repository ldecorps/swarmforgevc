// BL-597: read append-only self-heal telemetry and emit events for tests.

import * as fs from 'fs';
import * as path from 'path';
import { SelfHealEvent } from './selfHealTelemetry';

export function selfHealTelemetryDir(mainWorktreePath: string): string {
  return path.join(mainWorktreePath, '.swarmforge', 'telemetry');
}

function monthKey(isoInstant: string): string {
  return isoInstant.slice(0, 7);
}

export function selfHealLedgerFileForMonth(mainWorktreePath: string, month: string): string {
  return path.join(selfHealTelemetryDir(mainWorktreePath), `self-heal-${month}.jsonl`);
}

export function selfHealLedgerPath(
  mainWorktreePath: string,
  atIso: string = new Date().toISOString()
): string {
  return selfHealLedgerFileForMonth(mainWorktreePath, monthKey(atIso));
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

export function whenSelfHealTelemetryIdle(): Promise<void> {
  return emitChain;
}

function parseSelfHealLine(line: string): SelfHealEvent | null {
  try {
    const raw = JSON.parse(line) as Partial<SelfHealEvent>;
    if (
      typeof raw.type !== 'string' ||
      typeof raw.subject !== 'string' ||
      typeof raw.at !== 'string'
    ) {
      return null;
    }
    return {
      type: raw.type,
      subject: raw.subject,
      reason: typeof raw.reason === 'string' ? raw.reason : '',
      at: raw.at,
    };
  } catch {
    return null;
  }
}

export function readSelfHealEvents(mainWorktreePath: string): SelfHealEvent[] {
  const dir = selfHealTelemetryDir(mainWorktreePath);
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^self-heal-\d{4}-\d{2}\.jsonl$/.test(f))
    .sort();
  const out: SelfHealEvent[] = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const ev = parseSelfHealLine(trimmed);
      if (ev) out.push(ev);
    }
  }
  return out;
}

/** Fire-and-forget append matching self_heal_telemetry_lib.bb shape. */
export function emitSelfHealEvent(
  mainWorktreePath: string,
  event: Omit<SelfHealEvent, 'at'> & { at?: string }
): void {
  try {
    const at = event.at ?? new Date().toISOString();
    const record: SelfHealEvent = {
      type: event.type,
      subject: event.subject,
      reason: event.reason ?? '',
      at,
    };
    appendLineAsync(selfHealLedgerPath(mainWorktreePath, at), `${JSON.stringify(record)}\n`);
  } catch {
    // swallow — observability must not block callers
  }
}
