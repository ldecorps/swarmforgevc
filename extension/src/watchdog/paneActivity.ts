import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseRolesTsv } from '../swarm/swarmState';

/**
 * Activity tracking for the stuck-in-process chaser (BL-067). A role counts
 * as active when its pane's captured content changes between observations or
 * its outbox shows recent writes; "idle at prompt while holding in_process
 * work" is the reliable proxy for a context-exhausted agent.
 */

interface ActivityRecord {
  hash: string;
  lastChangeMs: number;
}

const records = new Map<string, ActivityRecord>();

export function trackPaneActivity(
  role: string,
  paneContent: string,
  outboxActivityMs: number,
  nowMs: number
): number {
  const hash = crypto.createHash('sha1').update(paneContent).digest('hex');
  const previous = records.get(role);
  if (!previous || previous.hash !== hash) {
    // First observation also counts as activity: never chase a role the
    // monitor has not watched for a full quiet threshold yet.
    records.set(role, { hash, lastChangeMs: nowMs });
    return nowMs;
  }
  return Math.max(previous.lastChangeMs, outboxActivityMs);
}

export function resetPaneActivity(): void {
  records.clear();
}

// Newest write under the role's outbox/sent dirs. The daemon's pickup happens
// within a poll cycle of the agent's write, so the directory mtimes track
// agent send activity closely enough for a minutes-scale stuck threshold.
export function outboxNewestMtimeMs(targetPath: string, role: string): number {
  try {
    const tsv = fs.readFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), 'utf8');
    const entry = parseRolesTsv(tsv).find((r) => r.role === role);
    if (!entry) return 0;
    const handoffs = path.join(entry.worktreePath, '.swarmforge', 'handoffs');
    return Math.max(
      0,
      ...['outbox', 'sent'].map((dir) => {
        try {
          return fs.statSync(path.join(handoffs, dir)).mtimeMs;
        } catch {
          return 0;
        }
      })
    );
  } catch {
    return 0;
  }
}
