// BL-329: the durable, git-tracked, per-ticket record of every message sent
// in a BL topic - inbound (human) and outbound (swarm) - so the Telegram
// topic becomes a disposable PROJECTION of state held in the repo, not the
// source of truth itself. Mirrors support_thread_store.bb's own shape (one
// JSON record per id, atomic whole-file write via tmp+rename) but lives
// under backlog/topics/, never under .swarmforge/ (gitignored, lost on a
// fresh checkout) - the record belongs next to the work, per the ticket's
// own framing.
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { atomicWrite } from '../util/atomicWrite';

export type TopicMessageDirection = 'inbound' | 'outbound';

export interface TopicMessage {
  seq: number;
  ts: number;
  author: string;
  type: TopicMessageDirection;
  text: string;
}

export interface TopicRecord {
  id: string;
  messages: TopicMessage[];
}

export function topicsDir(targetPath: string): string {
  return path.join(targetPath, 'backlog', 'topics');
}

export function recordPath(targetPath: string, ticketId: string): string {
  return path.join(topicsDir(targetPath), `${ticketId}.json`);
}

export function readRecord(targetPath: string, ticketId: string): TopicRecord {
  const file = recordPath(targetPath, ticketId);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && Array.isArray(parsed.messages)) {
      return parsed;
    }
  } catch {
    // missing file, or a corrupt/non-JSON one - degrade to empty, never crash
  }
  return { id: ticketId, messages: [] };
}

// Architect bounce (2026-07-13): a record that is merely written to a
// non-gitignored path is NOT durable - a fresh checkout, a disk failure, or
// a `git clean` loses it exactly as before this store existed. This is what
// makes the record actually survive those, per the ticket's own "This is
// what makes it the source of truth rather than a cache." Mirrors
// costHealthSidecar.ts's own commitCostHealthSidecar exactly: commits ONLY
// the one record file (never a broader `git add`, so another role's own
// in-flight uncommitted work in the same worktree is left untouched), fails
// open (returns false, never throws) on any git error including "nothing to
// commit" - appendMessage's own write must succeed regardless of whether
// this particular commit does.
export function commitTopicRecord(targetPath: string, filePath: string, ticketId: string): boolean {
  try {
    execFileSync('git', ['-C', targetPath, 'add', '--', filePath], { stdio: 'ignore' });
    execFileSync(
      'git',
      ['-C', targetPath, 'commit', '-m', `BL topic record for ${ticketId}\n\nBy coder.`, '--', filePath],
      { stdio: 'ignore' }
    );
    return true;
  } catch {
    return false;
  }
}

// seq is assigned from the CURRENT record's own length at append time - the
// record is always read fresh immediately before writing (never cached
// across calls), so this is correct for the single-writer-per-process
// shape every real caller uses (BL-329's own scope: the front desk bot
// process handles one Telegram update at a time).
export function appendMessage(
  targetPath: string,
  ticketId: string,
  message: { author: string; type: TopicMessageDirection; text: string; ts?: number }
): TopicMessage {
  const record = readRecord(targetPath, ticketId);
  const entry: TopicMessage = {
    seq: record.messages.length,
    ts: message.ts ?? Date.now(),
    author: message.author,
    type: message.type,
    text: message.text,
  };
  record.messages.push(entry);
  const filePath = recordPath(targetPath, ticketId);
  atomicWrite(filePath, JSON.stringify(record));
  commitTopicRecord(targetPath, filePath, ticketId);
  return entry;
}
