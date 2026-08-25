// BL-598: append-only alert telemetry under
// `.swarmforge/telemetry/alerts-YYYY-MM.jsonl`.
//
// Fire-and-forget async — measuring never blocks or changes alert emission.

import * as fs from 'fs';
import * as path from 'path';
import { AlertTelemetryRecord, AlertVerdict } from './alertTelemetry';

export function alertTelemetryDir(mainWorktreePath: string): string {
  return path.join(mainWorktreePath, '.swarmforge', 'telemetry');
}

function monthKey(isoInstant: string): string {
  return isoInstant.slice(0, 7);
}

export function alertLedgerFileForMonth(mainWorktreePath: string, month: string): string {
  return path.join(alertTelemetryDir(mainWorktreePath), `alerts-${month}.jsonl`);
}

export function alertLedgerPath(mainWorktreePath: string, atIso: string = new Date().toISOString()): string {
  return alertLedgerFileForMonth(mainWorktreePath, monthKey(atIso));
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

export function whenAlertTelemetryIdle(): Promise<void> {
  return emitChain;
}

export function emitAlertRecord(
  mainWorktreePath: string,
  record: AlertTelemetryRecord
): void {
  try {
    const filePath = alertLedgerPath(mainWorktreePath, record.at);
    appendLineAsync(filePath, `${JSON.stringify(record)}\n`);
  } catch {
    // swallow
  }
}

export function emitAlertVerdict(
  mainWorktreePath: string,
  alertType: string,
  verdict: AlertVerdict,
  atIso: string = new Date().toISOString()
): void {
  emitAlertRecord(mainWorktreePath, {
    at: atIso,
    alertType,
    verdict,
    fired: true,
  });
}

function parseRecord(line: string): AlertTelemetryRecord | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<AlertTelemetryRecord>;
    if (
      typeof candidate.at !== 'string' ||
      typeof candidate.alertType !== 'string' ||
      typeof candidate.verdict !== 'string' ||
      (candidate.verdict !== 'false-positive' && candidate.verdict !== 'actionable')
    ) {
      return null;
    }
    return {
      at: candidate.at,
      alertType: candidate.alertType,
      verdict: candidate.verdict,
      fired: candidate.fired !== false,
    };
  } catch {
    return null;
  }
}

export function readAlertRecords(mainWorktreePath: string): AlertTelemetryRecord[] {
  const dir = alertTelemetryDir(mainWorktreePath);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => /^alerts-\d{4}-\d{2}\.jsonl$/.test(n));
  } catch {
    return [];
  }
  const records: AlertTelemetryRecord[] = [];
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

/**
 * BL-598: run an alert evaluation without letting telemetry I/O change the
 * outcome. The verdict is supplied by the caller's existing classification.
 */
export function evaluateAlertWithTelemetry<T>(
  mainWorktreePath: string,
  alertType: string,
  verdict: AlertVerdict,
  evaluate: () => T
): T {
  const result = evaluate();
  emitAlertVerdict(mainWorktreePath, alertType, verdict);
  return result;
}
