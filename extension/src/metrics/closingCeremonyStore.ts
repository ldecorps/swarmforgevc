// BL-820: the impure read/write layer for the closing-ceremony lean pass -
// one durable run record per shift at
// .swarmforge/lean/ceremony/<yyyy-MM-dd>.json, holding that shift's packet
// (closingCeremony.ts's pure fold) plus whatever outcome/adjustments the
// specifier/coordinator have recorded against it since. Mirrors
// leanLedgerStore.ts's split: this file is the only place a run is ever
// written; every state transition (finalize-as-failed, record-outcome,
// record-adjustment) reads the current run fresh from disk first, never
// trusts an in-memory copy across calls.
import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';
import {
  CeremonyRun,
  CeremonyOutcome,
  CeremonyAdjustment,
  ceremonyRunState,
  isValidCeremonyOutcome,
  isValidCeremonyAdjustment,
} from '../quality/closingCeremony';

export function ceremonyDir(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'lean', 'ceremony');
}

export function ceremonyRunFilePath(targetPath: string, shiftKey: string): string {
  return path.join(ceremonyDir(targetPath), `${shiftKey}.json`);
}

function isCeremonyRunShape(value: unknown): value is CeremonyRun {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const run = value as Partial<CeremonyRun>;
  return typeof run.shiftKey === 'string' && typeof run.packet === 'object' && run.packet !== null && Array.isArray(run.adjustments);
}

export function readCeremonyRun(targetPath: string, shiftKey: string): CeremonyRun | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(ceremonyRunFilePath(targetPath, shiftKey), 'utf8'));
  } catch {
    return null;
  }
  return isCeremonyRunShape(raw) ? raw : null;
}

export function writeCeremonyRun(targetPath: string, run: CeremonyRun): void {
  atomicWrite(ceremonyRunFilePath(targetPath, run.shiftKey), JSON.stringify(run, null, 2) + '\n');
}

export function listCeremonyRuns(targetPath: string): CeremonyRun[] {
  let files: string[];
  try {
    files = fs.readdirSync(ceremonyDir(targetPath)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const runs: CeremonyRun[] = [];
  for (const file of files) {
    const shiftKey = file.slice(0, -'.json'.length);
    const run = readCeremonyRun(targetPath, shiftKey);
    if (run) {
      runs.push(run);
    }
  }
  return runs.sort((a, b) => a.shiftKey.localeCompare(b.shiftKey));
}

// Every run strictly before shiftKey that is still pending (no outcome, not
// yet finalized as failed) - the ceremony's own "never in silence" floor:
// scans every stored run rather than assuming at most one, so a gap (bedtime
// skipped for several days) still gets every stranded run caught, not just
// the most recent.
export function findOpenCeremonyRunsBefore(targetPath: string, shiftKey: string): CeremonyRun[] {
  return listCeremonyRuns(targetPath).filter((r) => r.shiftKey < shiftKey && ceremonyRunState(r) === 'pending');
}

export function finalizeCeremonyRunAsFailed(targetPath: string, run: CeremonyRun, atIso: string): CeremonyRun {
  const failed: CeremonyRun = { ...run, failedAt: atIso };
  writeCeremonyRun(targetPath, failed);
  return failed;
}

export function recordCeremonyOutcome(targetPath: string, shiftKey: string, outcome: CeremonyOutcome): CeremonyRun {
  const run = readCeremonyRun(targetPath, shiftKey);
  if (!run) {
    throw new Error(`closingCeremonyStore: no ceremony run found for shift ${shiftKey}`);
  }
  const state = ceremonyRunState(run);
  if (state !== 'pending') {
    throw new Error(`closingCeremonyStore: ceremony run for shift ${shiftKey} is already ${state}, refusing to overwrite`);
  }
  if (!isValidCeremonyOutcome(outcome)) {
    throw new Error(`closingCeremonyStore: refusing to record an outcome with invalid shape: ${JSON.stringify(outcome)}`);
  }
  const updated: CeremonyRun = { ...run, outcome };
  writeCeremonyRun(targetPath, updated);
  return updated;
}

export function recordCeremonyAdjustment(targetPath: string, shiftKey: string, adjustment: CeremonyAdjustment): CeremonyRun {
  const run = readCeremonyRun(targetPath, shiftKey);
  if (!run) {
    throw new Error(`closingCeremonyStore: no ceremony run found for shift ${shiftKey}`);
  }
  if (ceremonyRunState(run) === 'failed') {
    throw new Error(`closingCeremonyStore: ceremony run for shift ${shiftKey} already failed, refusing to record an adjustment`);
  }
  if (!isValidCeremonyAdjustment(adjustment)) {
    throw new Error(`closingCeremonyStore: refusing to record an adjustment with invalid shape: ${JSON.stringify(adjustment)}`);
  }
  const updated: CeremonyRun = { ...run, adjustments: [...run.adjustments, adjustment] };
  writeCeremonyRun(targetPath, updated);
  return updated;
}
