// BL-823: append-only swarm availability interval ledger, TS write side.
// Two interval classes have no durable record today - control/cooldown
// pauses (a current-state marker resume overwrites) and stop-to-start gaps
// (a stop writes nothing). This module is the thin, shared writer the two
// TS pause twins (writeControlPauseState, writeOperatorPauseState) call
// into. Mirrors resourceTelemetry.ts's appendResourceSample "never throws,
// thin adapter" shape and llm_cost_ledger_lib.bb's monthly-file convention
// (`.swarmforge/telemetry/<name>-YYYY-MM.jsonl`).
//
// The shell twin (kill_pipeline_swarm.sh / start-swarm.sh, via
// swarmforge/scripts/availability_ledger_lib.sh's availability_record) and
// the Babashka reader (swarmforge/scripts/availability_ledger_lib.bb) write
// and read the SAME file/record shape - see that pair for the stop/start
// side and the interval fold.
import * as fs from 'fs';
import * as path from 'path';

export type AvailabilityEvent = 'pause-start' | 'pause-end' | 'stop' | 'start';
export type AvailabilityClass = 'control-pause' | 'swarm-stop';

export interface AvailabilityRecord {
  ts: string;
  event: AvailabilityEvent;
  class: AvailabilityClass;
  source: string;
}

export function availabilityTelemetryDir(mainWorktreePath: string): string {
  return path.join(mainWorktreePath, '.swarmforge', 'telemetry');
}

function monthKey(isoInstant: string): string {
  return isoInstant.slice(0, 7);
}

export function availabilityLedgerFileForMonth(mainWorktreePath: string, month: string): string {
  return path.join(availabilityTelemetryDir(mainWorktreePath), `availability-${month}.jsonl`);
}

// Never throws - a ledger write failure must never block, fail, or alter
// the pause/stop/start transition it observes (BL-823 invariant 1).
export function appendAvailabilityRecord(
  mainWorktreePath: string,
  event: AvailabilityEvent,
  cls: AvailabilityClass,
  source: string,
  atIso: string = new Date().toISOString()
): void {
  try {
    const record: AvailabilityRecord = { ts: atIso, event, class: cls, source };
    const filePath = availabilityLedgerFileForMonth(mainWorktreePath, monthKey(atIso));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n');
  } catch {
    // swallow - ledger recording must never break the caller
  }
}
