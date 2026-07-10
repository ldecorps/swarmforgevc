import * as fs from 'fs';
import * as path from 'path';
import { parseResetTime, recordCooldown } from './cooldownScheduler';

// BL-209: closes the loop on BL-082's cooldownScheduler — nothing fed it a
// real signal before this, so recordCooldown was only ever called from
// tests. This module is the DETECT + RECORD half: it watches a role's pane
// text (as already tailed for recordSessionUrl) for a provider usage-limit
// message and, when one names a reset time, records a cooldown to the
// shared state file. The daemon's chase_sweep_lib.bb reads that same file
// to gate the live wake sweep (ENFORCE + RESUME, already wired there).
//
// Provider-specific message shapes are covered generically here (any line
// mentioning a usage/rate limit); a descriptor-driven per-provider matcher
// can follow BL-142 later (explicitly deferred by BL-209's own scope).
const USAGE_LIMIT_LINE_PATTERN = /\b(usage|rate)[\s-]?limit\b/i;

/**
 * Scans pane text (the full current pane content, so later output appears
 * later in the string) for the most recent line naming a usage/rate limit.
 * Returns null when no such line is present.
 */
export function extractUsageLimitLine(paneText: string | null | undefined): string | null {
  if (!paneText) return null;
  const lines = paneText.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (USAGE_LIMIT_LINE_PATTERN.test(lines[i])) {
      return lines[i];
    }
  }
  return null;
}

export function rateLimitCooldownFilePath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'rate-limit-cooldown.json');
}

/**
 * Detects a usage-limit line in paneText and, if it names a reset time,
 * records a cooldown for role to the shared state file the daemon reads.
 * A no-op when there is no usage-limit line, or when one is present but its
 * reset time can't be parsed (BL-082's parseResetTime already treats
 * unparseable text as "do not enter cooldown", never permanent suppression).
 */
export function recordRateLimitCooldownIfPresent(
  targetPath: string,
  role: string,
  paneText: string | null | undefined,
  nowMs: number
): void {
  const line = extractUsageLimitLine(paneText);
  if (!line) return;
  const untilMs = parseResetTime(line, nowMs);
  if (untilMs === null) return;
  const filePath = rateLimitCooldownFilePath(targetPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  recordCooldown(filePath, role, untilMs);
}
