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
  atomicWrite(recordPath(targetPath, ticketId), JSON.stringify(record));
  return entry;
}
