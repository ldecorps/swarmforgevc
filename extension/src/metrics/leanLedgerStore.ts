// BL-819: the impure read/write layer for the coordinator-owned ticket
// lifecycle ledger - .swarmforge/lean/<yyyy-MM-dd>.jsonl, one line per
// LeanLedgerEvent, plus a per-ticket latest-snapshot file folded from it.
//
// File names are calendar-day buckets (the same granularity every other
// durable store in this repo uses for "how much data accumulated recently"),
// but the day is only a FILE NAME: readers return every event in append
// order across all files, and the closing ceremony (BL-1968) tracks what it
// already folded with a per-file line cursor, never with date stamps.
import * as fs from 'fs';
import * as path from 'path';
import { atomicAppend, atomicWrite } from '../util/atomicWrite';
import { readJsonlRecordsFromDir } from './qaBounceStore';
import { hasLeanLedgerEvent, hasLeanLedgerEventShape, LeanLedgerEvent, LeanLedgerSnapshot, foldLeanLedgerSnapshot } from '../quality/leanLedger';

export function leanLedgerDir(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'lean');
}

function dayKeyOf(isoAt: string): string {
  return isoAt.slice(0, 10); // yyyy-MM-dd
}

export function leanLedgerFilePath(targetPath: string, isoAt: string): string {
  return path.join(leanLedgerDir(targetPath), `${dayKeyOf(isoAt)}.jsonl`);
}

function isLeanLedgerEvent(value: unknown): value is LeanLedgerEvent {
  return typeof value === 'object' && value !== null && hasLeanLedgerEventShape(value as Partial<LeanLedgerEvent>);
}

export function readLeanLedgerEvents(targetPath: string, ticket?: string): LeanLedgerEvent[] {
  const events = readJsonlRecordsFromDir(leanLedgerDir(targetPath), isLeanLedgerEvent);
  return ticket ? events.filter((e) => e.ticket === ticket) : events;
}

// Idempotent append: refuses (throws) an event that does not carry a known
// source/type/closed data-key shape - never persist something that would
// fail to read back as a real event - and dedupes against every event
// ALREADY in the log (across every day file, not just the target day's) on
// the natural key before appending. Returns whether a new event was
// actually written.
export function appendLeanLedgerEventIfNew(targetPath: string, event: LeanLedgerEvent): boolean {
  // Runtime defense-in-depth for a caller that bypasses the compiler
  // (plain JS, or a value read back from disk): shapeOk is a plain
  // boolean, not narrowed via the type predicate directly on `event`, so
  // TS does not (wrongly) treat the else-branch `event` as unreachable.
  const shapeOk: boolean = hasLeanLedgerEventShape(event);
  if (!shapeOk) {
    throw new Error(`leanLedgerStore: refusing to append an event with an invalid shape (ticket=${event.ticket}, type=${event.type}, source=${event.source})`);
  }
  const existing = readLeanLedgerEvents(targetPath);
  if (hasLeanLedgerEvent(existing, event)) {
    return false;
  }
  atomicAppend(leanLedgerFilePath(targetPath, event.at), JSON.stringify(event) + '\n');
  return true;
}

// ── per-ticket latest snapshot: a pure fold, persisted as its own file ──

function snapshotsDir(targetPath: string): string {
  return path.join(leanLedgerDir(targetPath), 'snapshots');
}

export function snapshotFilePath(targetPath: string, ticket: string): string {
  return path.join(snapshotsDir(targetPath), `${ticket}.json`);
}

export function readLeanLedgerSnapshot(targetPath: string, ticket: string): LeanLedgerSnapshot | null {
  try {
    return JSON.parse(fs.readFileSync(snapshotFilePath(targetPath, ticket), 'utf8'));
  } catch {
    return null;
  }
}

// Recomputes the ticket's snapshot as a pure fold over its own events (read
// fresh from disk, never accumulated in memory across calls) and writes it
// - invariant 1's "per-ticket snapshot is always a pure fold... never an
// independent writer": this is the ONLY function that writes a snapshot
// file, and it always derives from readLeanLedgerEvents, never accepts a
// snapshot object from a caller.
export function writeLeanLedgerSnapshotFor(targetPath: string, ticket: string): LeanLedgerSnapshot {
  const events = readLeanLedgerEvents(targetPath, ticket);
  const snapshot = foldLeanLedgerSnapshot(ticket, events);
  atomicWrite(snapshotFilePath(targetPath, ticket), JSON.stringify(snapshot, null, 2) + '\n');
  return snapshot;
}
