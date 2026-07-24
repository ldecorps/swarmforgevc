// BL-617: I/O glue for the nightly cooldown window scheduler - the marker
// file recording which window instance has already been handled, plus a
// conf-file reader for cooldownWindowCore.ts's pure parseCooldownConfig.
// Kept separate from cooldownWindowCore.ts (which stays pure/I/O-free, same
// split as telegramControlCore.ts vs telegram-front-desk-bot.ts) so both
// apply-cooldown-pause.ts (the sweep's own CLI) and telegram-front-desk-bot.ts's
// resumeNow (the human resume-now writer) can share one reader/writer pair
// without either duplicating the other's file-format knowledge.

import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';
import { parseCooldownConfig, ParsedCooldownConfig } from './cooldownWindowCore';

export function cooldownWindowMarkerPath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'cooldown-window.json');
}

export function readCooldownWindowMarker(targetPath: string): { lastHandledWindowStartMs: number | undefined } {
  try {
    const parsed = JSON.parse(fs.readFileSync(cooldownWindowMarkerPath(targetPath), 'utf8')) as {
      lastHandledWindowStartMs?: number;
    };
    return { lastHandledWindowStartMs: typeof parsed.lastHandledWindowStartMs === 'number' ? parsed.lastHandledWindowStartMs : undefined };
  } catch {
    return { lastHandledWindowStartMs: undefined };
  }
}

export function writeCooldownWindowMarker(targetPath: string, lastHandledWindowStartMs: number): void {
  atomicWrite(cooldownWindowMarkerPath(targetPath), JSON.stringify({ lastHandledWindowStartMs }));
}

function cooldownConfPath(targetPath: string): string {
  return path.join(targetPath, 'swarmforge', 'swarmforge.conf');
}

// Degrades to disabled (never throws) on a missing/unreadable conf file -
// same "degrade-never-crash" posture as every other swarmforge.conf reader
// in this codebase (readConfigValue, daemon_alarm_lib.bb's parse-conf).
export function readCooldownConfigFromDisk(targetPath: string): ParsedCooldownConfig {
  let content = '';
  try {
    content = fs.readFileSync(cooldownConfPath(targetPath), 'utf8');
  } catch {
    content = '';
  }
  return parseCooldownConfig(content);
}
