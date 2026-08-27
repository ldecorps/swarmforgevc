import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';
import { utcDayKey } from '../notify/briefingScheduler';
import type { TicketLifecycleEvent } from './gitHistoryAdapter';

// BL-897: a machine-local snapshot of deriveTicketLifecycles' output,
// gathered once per UTC day (emit-lifecycle-snapshot.ts) and shared by
// every briefing-section CLI that would otherwise each re-walk the
// backlog's full git history on its own (costHealthSidecar.ts,
// briefing-digest-line.ts, render-briefing-burndown.ts). Written under
// .swarmforge/ (already gitignored at any depth - never a committed
// artifact) so every section of one send agrees on the same ticket state,
// while a missing/unreadable/stale snapshot degrades a consumer straight
// back to deriving its own, exactly as it did before this ticket.

export interface LifecycleSnapshotFile {
  dayKey: string;
  generatedAtIso: string;
  records: TicketLifecycleEvent[];
}

export function lifecycleSnapshotPath(projectRoot: string): string {
  return path.join(projectRoot, '.swarmforge', 'briefing', 'lifecycle-snapshot.json');
}

// Pure: the file's shape for a given records array/clock reading.
export function serializeLifecycleSnapshot(records: TicketLifecycleEvent[], nowMs: number): LifecycleSnapshotFile {
  return { dayKey: utcDayKey(nowMs), generatedAtIso: new Date(nowMs).toISOString(), records };
}

export function writeLifecycleSnapshot(projectRoot: string, records: TicketLifecycleEvent[], nowMs: number): string {
  const filePath = lifecycleSnapshotPath(projectRoot);
  atomicWrite(filePath, JSON.stringify(serializeLifecycleSnapshot(records, nowMs), null, 2));
  return filePath;
}

// Pure: whether already-parsed JSON is a snapshot usable RIGHT NOW - the
// right shape, and from TODAY's UTC day-key. A snapshot from yesterday
// (the sidecar sweep and the email sweep can land on different daemon
// ticks, possibly hours apart) is stale, not usable - a consumer must
// derive its own rather than reporting yesterday's ticket state.
export function isUsableSnapshot(parsed: unknown, nowMs: number): parsed is LifecycleSnapshotFile {
  if (!parsed || typeof parsed !== 'object') {
    return false;
  }
  const candidate = parsed as Partial<LifecycleSnapshotFile>;
  return candidate.dayKey === utcDayKey(nowMs) && Array.isArray(candidate.records);
}

// Adapter: read + parse + freshness-check in one step, degrading to null
// on ANY failure - missing file, invalid JSON, wrong shape, or a stale
// day-key - never throws. filePath is whatever a --snapshot flag named,
// not re-derived from a project root, so a consumer stays testable against
// an arbitrary fixture path.
export function readLifecycleSnapshot(filePath: string, nowMs: number): TicketLifecycleEvent[] | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isUsableSnapshot(parsed, nowMs) ? parsed.records : null;
}
