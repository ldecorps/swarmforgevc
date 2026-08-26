// BL-619: the impure read/write layer for human-recorded usage-percentage
// checkpoints - .swarmforge/operator/usage-anchors.jsonl, one line per
// recorded anchor. Machine-local runtime state (gitignored), same posture as
// qaBounceStore.ts's .swarmforge/qa_bounces/ log; unlike that log this one is
// NOT month-bucketed (anchor volume is low - one human transcription at a
// time - so a single file is simplest and burnProjection.ts already filters
// to the current weekly window on read).
//
// The account percentage itself is never programmatically readable (verified
// 2026-07-25 - no endpoint exists); every anchor here traces back to a human
// reading a number off their phone and typing it in via usage-anchor.ts. This
// module never invents or derives a percentage - it only validates, persists,
// and reads back exactly what it was given.
import * as fs from 'fs';
import * as path from 'path';
import { atomicAppend } from '../util/atomicWrite';
import { UsageAnchor } from './burnProjection';

export const DEFAULT_ANCHOR_SCOPE = 'all-models';

export function usageAnchorsFilePath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'usage-anchors.jsonl');
}

// anchor-validation-07: only 0..100 inclusive is a real percentage; anything
// else (130, -5, NaN, non-finite) is rejected rather than silently clamped -
// a clamp would let a fat-fingered entry masquerade as a real checkpoint.
export function isValidAnchorPct(pct: number): boolean {
  return typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 && pct <= 100;
}

function hasValidAtMs(candidate: Partial<UsageAnchor>): boolean {
  return typeof candidate.atMs === 'number' && Number.isFinite(candidate.atMs);
}

function hasValidPct(candidate: Partial<UsageAnchor>): boolean {
  return typeof candidate.pct === 'number' && isValidAnchorPct(candidate.pct);
}

function hasValidScope(candidate: Partial<UsageAnchor>): boolean {
  return typeof candidate.scope === 'string' && candidate.scope.length > 0;
}

function isUsageAnchor(value: unknown): value is UsageAnchor {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<UsageAnchor>;
  return hasValidAtMs(candidate) && hasValidPct(candidate) && hasValidScope(candidate);
}

// A malformed or unrecognized line is skipped, never a crash - same
// forgiving-reader posture as qaBounceStore.ts's readJsonlRecordsFromFile.
export function readUsageAnchors(targetPath: string): UsageAnchor[] {
  let content: string;
  try {
    content = fs.readFileSync(usageAnchorsFilePath(targetPath), 'utf8');
  } catch {
    return [];
  }
  const anchors: UsageAnchor[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      if (isUsageAnchor(parsed)) {
        anchors.push(parsed);
      }
    } catch {
      // skip malformed line
    }
  }
  return anchors;
}

export type AppendAnchorResult = { ok: true; anchor: UsageAnchor } | { ok: false; error: string };

// Validates then appends one anchor checkpoint. Rejects out-of-range
// percentages before touching disk - anchor-validation-07's "rejects the
// value" outcome never writes a line at all.
export function appendUsageAnchor(targetPath: string, atMs: number, pct: number, scope: string = DEFAULT_ANCHOR_SCOPE): AppendAnchorResult {
  if (!isValidAnchorPct(pct)) {
    return { ok: false, error: `usage anchor percentage must be within 0..100 (got ${pct})` };
  }
  const anchor: UsageAnchor = { atMs, pct, scope };
  atomicAppend(usageAnchorsFilePath(targetPath), JSON.stringify(anchor) + '\n');
  return { ok: true, anchor };
}
