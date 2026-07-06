import * as fs from 'fs';
import * as path from 'path';
import { readDaemonHealth, DaemonHealth } from './daemonHealth';
import {
  scanInboxNew,
  scanInProcess,
  parseHandoffHeaderField,
  listDeadLetters,
  DeadLetterInfo,
  RoleInbox,
} from './inboxChaser';

/**
 * BL-121: delivery-level transport health. Process liveness alone (BL-061's
 * daemonHealth) says nothing about whether parcels are actually arriving —
 * a dead-lettered or stalled parcel can rot in an agent's inbox for days
 * while the supervisor reports "healthy". This module answers the real
 * question: are parcels being delivered?
 */

export type TransportState = 'healthy' | 'delivery-degraded' | 'broken' | 'unknown';

export type OffendingReason = 'dead-letter' | 'stalled' | 'canary-miss';

export interface OffendingParcel {
  /** "<from>-><recipient>" so an alarm names who is silently blocked. */
  route: string;
  ageSeconds: number;
  reason: OffendingReason;
}

export interface TransportHealth {
  state: TransportState;
  offending: OffendingParcel[];
}

export type CanaryState = 'healthy' | 'missed' | 'no-data';

export interface CanaryStatus {
  state: CanaryState;
  ageSeconds: number;
}

// Canary parcels are marked in their task name so detection can tell them
// apart from real work and exclude them from stall accounting (BL-121
// canary-isolation-04): a canary must never appear as a work item to any
// pipeline role.
export const CANARY_TASK_PREFIX = 'canary-';

export function isCanaryTask(taskName: string | undefined): boolean {
  return !!taskName && taskName.startsWith(CANARY_TASK_PREFIX);
}

export function evaluateCanary(
  lastRoundTripMs: number | null,
  nowMs: number,
  budgetSeconds: number
): CanaryStatus {
  if (lastRoundTripMs == null) {
    return { state: 'no-data', ageSeconds: 0 };
  }
  const ageSeconds = (nowMs - lastRoundTripMs) / 1000;
  return { state: ageSeconds <= budgetSeconds ? 'healthy' : 'missed', ageSeconds };
}

function canaryStatusFile(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'daemon', 'canary-status.json');
}

// Mirrors readDaemonHealth's pattern: a status file the canary injector
// maintains. Absent or unreadable means no-data, never a false alarm.
export function readCanaryStatus(targetPath: string, nowMs: number, budgetSeconds: number): CanaryStatus {
  try {
    const raw = JSON.parse(fs.readFileSync(canaryStatusFile(targetPath), 'utf-8'));
    const lastRoundTripMs = typeof raw.lastRoundTripMs === 'number' ? raw.lastRoundTripMs : null;
    return evaluateCanary(lastRoundTripMs, nowMs, budgetSeconds);
  } catch {
    return { state: 'no-data', ageSeconds: 0 };
  }
}

function routeFor(from: string | undefined, recipient: string | undefined): string {
  return `${from ?? 'unknown'}->${recipient ?? 'unknown'}`;
}

// A parcel sitting in inbox/new or inbox/in_process past the stall threshold
// is undelivered work regardless of whether the daemon ever dead-lettered
// it (cf. BL-067's 4h overnight miss) — this is the STALL half of detection,
// distinct from listDeadLetters' failed/-style `.dead` files.
export function scanStalledParcels(
  roleInboxes: Pick<RoleInbox, 'role' | 'inboxNewDir' | 'inProcessDir'>[],
  nowMs: number,
  stallThresholdSeconds: number
): OffendingParcel[] {
  const offending: OffendingParcel[] = [];
  for (const { inboxNewDir, inProcessDir } of roleInboxes) {
    const items = [...scanInboxNew(inboxNewDir), ...scanInProcess(inProcessDir)];
    for (const item of items) {
      const ageSeconds = (nowMs - item.mtimeMs) / 1000;
      if (ageSeconds < stallThresholdSeconds) {
        continue;
      }
      const content = fs.readFileSync(item.filePath, 'utf-8');
      if (isCanaryTask(parseHandoffHeaderField(content, 'task'))) {
        continue;
      }
      const from = parseHandoffHeaderField(content, 'from');
      const recipient = parseHandoffHeaderField(content, 'recipient');
      offending.push({ route: routeFor(from, recipient), ageSeconds, reason: 'stalled' });
    }
  }
  return offending;
}

export function deadLettersToOffending(deadLetters: DeadLetterInfo[], nowMs: number): OffendingParcel[] {
  return deadLetters.map((d) => {
    const ageSeconds = (nowMs - fs.statSync(d.filePath).mtimeMs) / 1000;
    return { route: routeFor(d.from, d.recipient), ageSeconds, reason: 'dead-letter' as const };
  });
}

export interface TransportHealthInput {
  daemonHealth: DaemonHealth;
  deadLetters: OffendingParcel[];
  stalledParcels: OffendingParcel[];
  canary: CanaryStatus;
}

// Only reached when there is no offending parcel and no canary data: fall
// back to the daemon's own process-level health. Split out of
// computeTransportHealth to keep that function's branch count low (BL-121
// hardening: behavior-preserving split, CRAP was 7 on the merged version).
function daemonHealthFallback(daemonHealth: DaemonHealth): TransportHealth {
  switch (daemonHealth.state) {
    case 'healthy':
      return { state: 'healthy', offending: [] };
    case 'restarting':
      return { state: 'delivery-degraded', offending: [] };
    case 'persistent-failure':
      return { state: 'broken', offending: [] };
    default:
      return { state: 'unknown', offending: [] };
  }
}

// The state machine: a missed canary is the definitive "broken" signal
// (overrides mere process liveness, per BL-121 canary-03); any dead-letter
// or stall is at least "delivery-degraded" even while the daemon heartbeats
// healthy (delivery-detection-01, stall-detection-02); only when there is no
// offending parcel and no canary data do we fall back to the daemon's own
// process-level read.
export function computeTransportHealth(input: TransportHealthInput): TransportHealth {
  const offending = [...input.deadLetters, ...input.stalledParcels];

  if (input.canary.state === 'missed') {
    return {
      state: 'broken',
      offending: [...offending, { route: 'canary', ageSeconds: input.canary.ageSeconds, reason: 'canary-miss' }],
    };
  }
  if (offending.length > 0) {
    return { state: 'delivery-degraded', offending };
  }
  if (input.canary.state === 'healthy') {
    return { state: 'healthy', offending: [] };
  }
  return daemonHealthFallback(input.daemonHealth);
}

export interface TransportHealthConfig {
  stallThresholdSeconds: number;
  canaryBudgetSeconds: number;
}

// Ties the live filesystem signals together for callers (e.g. the swarm
// panel) that want one authoritative "is this actually working" read
// instead of daemonHealth's process-only view.
export function computeLiveTransportHealth(
  targetPath: string,
  roleInboxes: Pick<RoleInbox, 'role' | 'inboxNewDir' | 'inProcessDir'>[],
  nowMs: number,
  config: TransportHealthConfig
): TransportHealth {
  const daemonHealth = readDaemonHealth(targetPath);
  const deadLetters = deadLettersToOffending(listDeadLetters(roleInboxes), nowMs);
  const stalledParcels = scanStalledParcels(roleInboxes, nowMs, config.stallThresholdSeconds);
  const canary = readCanaryStatus(targetPath, nowMs, config.canaryBudgetSeconds);
  return computeTransportHealth({ daemonHealth, deadLetters, stalledParcels, canary });
}
