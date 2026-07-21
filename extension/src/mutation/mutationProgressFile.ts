// BL-132: thin IO adapter for the durable mutation-progress file. The
// pure record shape/math lives in mutationProgress.ts; this module only
// resolves the standard path and does the atomic write/best-effort read.

import * as fs from 'fs';
import * as path from 'path';
import { MutationProgressRecord } from './mutationProgress';

export function defaultProgressFilePath(repoRoot: string, role: string): string {
  return path.join(repoRoot, '.swarmforge', 'mutation-progress', `${role}.json`);
}

// Write via a same-directory tmp file then rename, so a reader never sees a
// half-written file (same atomic-write discipline as the handoff daemon's
// outbox, per handoff-protocol.md).
export function writeProgressRecord(filePath: string, record: MutationProgressRecord): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

// Readable "without the extension/webview" per the ticket - a plain `cat`
// or this helper both work. Returns null (never throws) for a missing or
// malformed file, so a reader degrades gracefully instead of crashing.
export function readProgressRecord(filePath: string): MutationProgressRecord | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as MutationProgressRecord;
  } catch {
    return null;
  }
}
