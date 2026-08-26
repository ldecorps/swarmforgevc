// BL-658: pure night closing ceremony — briefing is the last act before stop.
// Edge-6 (human 2026-08-26): option d — closure_stop_local in swarmforge.conf
// is authoritative; cron generation may be a sibling slice. This module owns
// the resolver + sequence decisions; IO lives behind adapters.

import { parseLocalTime, type LocalTime } from '../tools/cooldownWindowCore';

export type ClosureScheduleState = 'ok' | 'absent' | 'ambiguous';

export type ClosureScheduleResolution =
  | { state: 'ok'; closure: LocalTime; surfaced: 'nothing' }
  | { state: 'absent'; surfaced: 'nothing' }
  | { state: 'ambiguous'; surfaced: 'closure-schedule-ambiguous' };

export type CeremonyBudgets = {
  drainBudgetMinutes: number;
  briefingBudgetMinutes: number;
};

export type InFlightParcel = {
  role: string;
  /** 'completes' = drains inside budget; 'running' = still running at deadline */
  drainOutcome: 'completes' | 'running';
};

export type CeremonyFixture = {
  schedule: ClosureScheduleResolution;
  budgets: CeremonyBudgets;
  /** Hard stop backstop as HH:MM local (e.g. closure time). */
  hardDeadline: LocalTime;
  inFlight: InFlightParcel | null;
  /** Parcel ids held in inbox by the promotion freeze. */
  heldParcelIds: string[];
  briefingAlreadySent: boolean;
  /** When true, documenter never commits (scenario 04). */
  briefingNeverCommits: boolean;
};

export type CeremonyResult = {
  sequence: string[];
  rotationRequested: boolean;
  deliveriesAfterFreeze: number;
  sendConfirmations: number;
  sendSource: 'sent-state' | 'file-exists' | 'none';
  parkedClaimIntact: boolean;
  loudSurfaces: string[];
  couldNotProcess: { spanningCeremony: boolean; heldParcelIds: string[] } | null;
  swarmStoppedAtOrBeforeHardDeadline: boolean;
  fixedMorningTriggerConsulted: boolean;
  fixedMorningTriggerFired: boolean;
};

const CONFIG_KEY = 'closure_stop_local';
const CONFIG_LINE = new RegExp(`^\\s*config\\s+${CONFIG_KEY}\\s+(\\S+)\\s*$`, 'gm');

export function collectClosureStopLocals(confContent: string): string[] {
  const values: string[] = [];
  for (const match of confContent.matchAll(CONFIG_LINE)) {
    values.push(match[1]);
  }
  return values;
}

export function resolveClosureSchedule(confContent: string): ClosureScheduleResolution {
  const raw = collectClosureStopLocals(confContent);
  if (raw.length === 0) {
    return { state: 'absent', surfaced: 'nothing' };
  }
  const parsed = raw.map((v) => ({ raw: v, time: parseLocalTime(v) }));
  const ok = parsed.filter((p) => p.time !== null) as { raw: string; time: LocalTime }[];
  if (ok.length === 0) {
    return { state: 'ambiguous', surfaced: 'closure-schedule-ambiguous' };
  }
  const unique = new Set(ok.map((p) => `${p.time.hour}:${p.time.minute}`));
  if (unique.size > 1 || ok.length !== raw.length) {
    return { state: 'ambiguous', surfaced: 'closure-schedule-ambiguous' };
  }
  return { state: 'ok', closure: ok[0].time, surfaced: 'nothing' };
}

export function minutesOfDay(time: LocalTime): number {
  return time.hour * 60 + time.minute;
}

export function localTimeFromMinutes(total: number): LocalTime {
  const normalized = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return { hour: Math.floor(normalized / 60), minute: normalized % 60 };
}

export function formatLocalTime(time: LocalTime): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

export function resolveCeremonyBegin(
  closure: LocalTime,
  budgets: CeremonyBudgets
): LocalTime {
  const begin = minutesOfDay(closure) - budgets.drainBudgetMinutes - budgets.briefingBudgetMinutes;
  return localTimeFromMinutes(begin);
}

export function shouldConsultFixedMorningTrigger(schedule: ClosureScheduleResolution): boolean {
  return schedule.state !== 'ok';
}

/** Fixed-time path only when schedule is unusable (scenarios 06). */
export function fixedMorningTriggerFires(schedule: ClosureScheduleResolution): boolean {
  return schedule.state === 'absent' || schedule.state === 'ambiguous';
}

function push(seq: string[], step: string): void {
  seq.push(step);
}

function unusableScheduleResult(schedule: ClosureScheduleResolution): CeremonyResult {
  return {
    sequence: [],
    rotationRequested: false,
    deliveriesAfterFreeze: 0,
    sendConfirmations: 0,
    sendSource: 'none',
    parkedClaimIntact: false,
    loudSurfaces: schedule.state === 'ambiguous' ? [schedule.surfaced] : [],
    couldNotProcess: null,
    swarmStoppedAtOrBeforeHardDeadline: false,
    fixedMorningTriggerConsulted: true,
    fixedMorningTriggerFired: fixedMorningTriggerFires(schedule),
  };
}

function recordHeldWindow(heldParcelIds: string[]): CeremonyResult['couldNotProcess'] {
  if (heldParcelIds.length === 0) {
    return null;
  }
  return { spanningCeremony: true, heldParcelIds: [...heldParcelIds] };
}

function applyDrain(
  sequence: string[],
  loudSurfaces: string[],
  inFlight: InFlightParcel | null
): { parkedClaimIntact: boolean; endedAtDocumenter: boolean } {
  if (!inFlight) {
    return { parkedClaimIntact: false, endedAtDocumenter: false };
  }
  if (inFlight.drainOutcome === 'completes') {
    push(sequence, 'parcel-drained');
    return {
      parkedClaimIntact: false,
      endedAtDocumenter: inFlight.role === 'documenter',
    };
  }
  push(sequence, 'parcel-parked');
  loudSurfaces.push('closing-drain-deadline-exceeded');
  return { parkedClaimIntact: true, endedAtDocumenter: false };
}

/**
 * Synchronous fixture runner for the closing sequence. Live IO (pause file,
 * rotate, night-stop) is wired by adapters outside this pure core.
 */
export function runClosingCeremony(fixture: CeremonyFixture): CeremonyResult {
  if (fixture.schedule.state !== 'ok') {
    return unusableScheduleResult(fixture.schedule);
  }

  const sequence: string[] = [];
  const loudSurfaces: string[] = [];
  push(sequence, 'freeze-promotion');
  const couldNotProcess = recordHeldWindow(fixture.heldParcelIds);
  const deliveriesAfterFreeze = 0;

  if (fixture.briefingAlreadySent) {
    push(sequence, 'briefing-already-sent');
    push(sequence, 'swarm-stopped');
    return resultBase({
      sequence,
      rotationRequested: false,
      deliveriesAfterFreeze,
      sendConfirmations: 1,
      sendSource: 'sent-state',
      parkedClaimIntact: false,
      loudSurfaces,
      couldNotProcess,
    });
  }

  const { parkedClaimIntact, endedAtDocumenter } = applyDrain(
    sequence,
    loudSurfaces,
    fixture.inFlight
  );
  const rotationRequested = !endedAtDocumenter;
  if (rotationRequested) {
    push(sequence, 'rotate-documenter');
  }

  if (fixture.briefingNeverCommits) {
    push(sequence, 'briefing-missing');
    loudSurfaces.push('closing-briefing-missing');
    push(sequence, 'swarm-stopped');
    return resultBase({
      sequence,
      rotationRequested,
      deliveriesAfterFreeze,
      sendConfirmations: 0,
      sendSource: 'none',
      parkedClaimIntact,
      loudSurfaces,
      couldNotProcess,
    });
  }

  push(sequence, 'briefing-committed');
  push(sequence, 'send-confirmed');
  push(sequence, 'swarm-stopped');
  return resultBase({
    sequence,
    rotationRequested,
    deliveriesAfterFreeze,
    sendConfirmations: 1,
    sendSource: 'sent-state',
    parkedClaimIntact,
    loudSurfaces,
    couldNotProcess,
  });
}

function resultBase(
  partial: Omit<
    CeremonyResult,
    'swarmStoppedAtOrBeforeHardDeadline' | 'fixedMorningTriggerConsulted' | 'fixedMorningTriggerFired'
  >
): CeremonyResult {
  return {
    ...partial,
    swarmStoppedAtOrBeforeHardDeadline: true,
    fixedMorningTriggerConsulted: false,
    fixedMorningTriggerFired: false,
  };
}

export function defaultBudgets(): CeremonyBudgets {
  return { drainBudgetMinutes: 25, briefingBudgetMinutes: 10 };
}
