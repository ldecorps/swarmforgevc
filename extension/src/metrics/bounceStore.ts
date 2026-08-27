// BL-635: the impure read/write layer for the GENERALISED (by-role) bounce
// log - .swarmforge/bounces/<YYYY-MM>.jsonl, additive over the LEGACY
// QA-only log qaBounceStore.ts owns (.swarmforge/qa_bounces/): this file
// never writes there, only reads it (readBounceRecords below), so the 53
// pre-BL-635 records and backfill-qa-bounces.js's one-time seed are never
// orphaned.
//
// Split out of qaBounceStore.ts (BL-485 mutation-site budget - the legacy
// store plus this one together were pushing a single module past a
// tractable size) - mirrors the recordBounceArgs.ts/recordQaBounceArgs.ts
// split already made at the CLI layer: the legacy store's locked contract
// stays untouched in its own file, and this one is free to evolve with the
// generalised recorder. Reuses qaBounceStore.ts's shape-check building
// blocks and JSONL-directory traversal rather than duplicating them.
import * as path from 'path';
import { atomicAppend } from '../util/atomicWrite';
import {
  BounceCorrection,
  BounceRecord,
  applyBounceCorrections,
  hasBounceCorrection,
  hasBounceRecord,
  isBounceCorrection,
  isKnownBounceRole,
} from '../quality/qaBounce';
import { hasKnownQaBounceValues, hasQaBounceRecordShape, monthOf, qaBouncesDir, readJsonlRecordsFromDir } from './qaBounceStore';

// BL-635: the generalised, go-forward log path - written by record-bounce.js
// (any reviewing role), never the legacy QA-only qa_bounces/ path.
export function bouncesDir(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'bounces');
}

function bounceFilePath(targetPath: string, isoDate: string): string {
  return path.join(bouncesDir(targetPath), `${monthOf(isoDate)}.jsonl`);
}

// `by` is optional even on a well-formed line (legacy qa_bounces/ records
// predate the field entirely); present-but-not-a-known-role is still
// rejected, same forgiving-but-not-trusting-raw posture as every other field.
function hasBounceRecordShape(candidate: Partial<BounceRecord>): boolean {
  return hasQaBounceRecordShape(candidate) && (candidate.by === undefined || typeof candidate.by === 'string');
}

function hasKnownBounceValues(candidate: Partial<BounceRecord>): boolean {
  return hasKnownQaBounceValues(candidate) && (candidate.by === undefined || isKnownBounceRole(candidate.by as string));
}

function isBounceRecord(value: unknown): value is BounceRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<BounceRecord>;
  return hasBounceRecordShape(candidate) && hasKnownBounceValues(candidate);
}

// BL-635 (record-bounce-by-role-06): merges the NEW generalised log with the
// LEGACY QA-only log - the 53 records already there (and
// backfill-qa-bounces.js's one-time seed from the evidence corpus) predate
// `by` entirely and read back as unattributed (bounceAttribution), never
// silently folded into QA or dropped. Legacy-dir records are read
// read-only forever; nothing ever writes there again.
// BL-990: the RAW merged history, corrections NOT applied. Two callers need
// this rather than the attributed view: the append dedup below (a corrected
// bounce is still IN the store, so deduping against the corrected view would
// let a re-run append it a second time), and any reader proving the store is
// append-only.
export function readRawBounceRecords(targetPath: string): BounceRecord[] {
  return [...readJsonlRecordsFromDir(qaBouncesDir(targetPath), isBounceRecord), ...readJsonlRecordsFromDir(bouncesDir(targetPath), isBounceRecord)];
}

// BL-990: correction records share the JSONL files with bounce records and
// are told apart by their `kind` discriminator - bounce records have no such
// field, and isBounceRecord rejects a correction line, so neither reader
// ever sees the other's lines. Legacy qa_bounces/ is read here too purely
// for symmetry; nothing has ever written a correction there.
export function readBounceCorrections(targetPath: string): BounceCorrection[] {
  return [
    ...readJsonlRecordsFromDir(qaBouncesDir(targetPath), isBounceCorrection),
    ...readJsonlRecordsFromDir(bouncesDir(targetPath), isBounceCorrection),
  ];
}

// BL-990: the ATTRIBUTED view - the merged history with superseded records
// resolved out. This is the chokepoint every attribution consumer reads
// through, so a correction reaches all of them at once rather than one at a
// time (the ticket's own "two different bounce rates from one store" line).
export function readBounceRecords(targetPath: string): BounceRecord[] {
  return applyBounceCorrections(readRawBounceRecords(targetPath), readBounceCorrections(targetPath));
}

// BL-635 (record-bounce-by-role-07): writes ONLY to the new generalised
// path - the legacy qa_bounces/ log is never written again. Dedups against
// the FULL merged history (both dirs) on the generalised natural key
// (ticket+date+class+commit+by, bounceNaturalKey), so a re-run can never
// double-count against either log.
export function appendBounceRecordIfNew(targetPath: string, record: BounceRecord): boolean {
  // BL-990: dedups against the RAW history deliberately. A corrected bounce
  // is still a recorded bounce; deduping against the attributed view would
  // make it invisible here and let a re-run append it again, quietly
  // resurrecting the attribution a correction was issued to remove.
  const existing = readRawBounceRecords(targetPath);
  if (hasBounceRecord(existing, record)) {
    return false;
  }
  atomicAppend(bounceFilePath(targetPath, record.at), JSON.stringify(record) + '\n');
  return true;
}

// BL-990: append-only, exactly like the recorder above - a correction is a
// NEW line that supersedes an earlier one, never an edit or a deletion of
// it. Idempotent on the correction's own target key, so recording the same
// correction twice leaves the store byte-identical (scenario 05).
export function appendBounceCorrectionIfNew(targetPath: string, correction: BounceCorrection): boolean {
  if (!isBounceCorrection(correction)) {
    return false;
  }
  if (hasBounceCorrection(readBounceCorrections(targetPath), correction)) {
    return false;
  }
  atomicAppend(bounceFilePath(targetPath, correction.at), JSON.stringify(correction) + '\n');
  return true;
}
