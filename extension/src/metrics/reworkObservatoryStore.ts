/**
 * BL-430: durable storage for observatory signals under
 * `.swarmforge/telemetry/`. A SINGLE file holding an array of signals, each
 * tagged by `kind`, so a later signal (bottleneck dwell, idle waste) joins
 * the same file without a rewrite - mirroring swarmMetrics.ts's own
 * additive chaser-telemetry discipline. Writing upserts by `kind`: this is
 * a current-state snapshot per signal, not an append-only log, so
 * re-running the same signal's computation replaces only its own entry.
 */
import * as fs from 'fs';
import * as path from 'path';

export function observatorySignalsPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'telemetry', 'observatory-signals.json');
}

interface SignalsFile {
  signals: Array<Record<string, unknown>>;
}

// A missing or corrupt file starts fresh rather than crashing the writer -
// telemetry recording must never break its caller (matches
// appendResourceSample's own "never throws" spirit in resourceTelemetry.ts).
function readSignalsFile(targetPath: string): SignalsFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(observatorySignalsPath(targetPath), 'utf8'));
    if (parsed && Array.isArray(parsed.signals)) {
      return parsed;
    }
  } catch {
    // missing or unparseable - fall through to a fresh file below
  }
  return { signals: [] };
}

export function persistReworkSignal(targetPath: string, entry: Record<string, unknown> & { kind: string }): void {
  const file = readSignalsFile(targetPath);
  const otherKinds = file.signals.filter((s) => s.kind !== entry.kind);
  const updated: SignalsFile = { signals: [...otherKinds, entry] };
  const filePath = observatorySignalsPath(targetPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2) + '\n');
}

// BL-431: the diagnosis slice's read side of persistReworkSignal above -
// the missing/corrupt/wrong-shape file and wrong-kind cases all resolve to
// null (never a crash, never a fabricated entry), matching
// readSignalsFile's own "start fresh" posture.
export function readReworkSignalEntry(targetPath: string): Record<string, unknown> | null {
  const file = readSignalsFile(targetPath);
  return file.signals.find((s) => s.kind === 'rework-rate') ?? null;
}
