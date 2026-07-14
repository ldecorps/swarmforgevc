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
import { commitScopedFile } from '../util/gitCommitScopedFile';

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
// what makes it the source of truth rather than a cache." commitScopedFile
// (shared with costHealthSidecar.ts's own commitCostHealthSidecar) commits
// ONLY the one record file (never a broader `git add`, so another role's own
// in-flight uncommitted work in the same worktree is left untouched), fails
// open (returns false, never throws) on any git error including "nothing to
// commit" - appendMessage's own write must succeed regardless of whether
// this particular commit does.
export function commitTopicRecord(targetPath: string, filePath: string, ticketId: string): boolean {
  return commitScopedFile(targetPath, filePath, `BL topic record for ${ticketId}\n\nBy coder.`);
}

// BL-348: commitTopicRecord fails open by design (never throws, so
// appendMessage's own write always succeeds regardless of whether the
// commit does) - but a caller that then DISCARDS the boolean, as
// appendMessage itself used to, turns every commit failure into
// PERMANENT SILENCE: 31 of 34 real records were found untracked with no
// trace of why. "Surfaced, never silently dropped" does not mean throw -
// throwing here would turn a durability nice-to-have into an outage
// (recordMessage's own adapter type is a fire-and-forget `void` callback
// with no caller prepared to catch), it means LOUD by default, with the
// reporter itself adapter-injected (this codebase's own established
// testability convention - RouteAdapters, ShellRunFn) so a test can assert
// the failure was reported without polluting real stderr, and a future
// caller could route it somewhere richer than stderr without touching
// appendMessage's own logic.
export type CommitFailureReporter = (ticketId: string, filePath: string) => void;

export const reportCommitFailureToStderr: CommitFailureReporter = (ticketId, filePath) => {
  process.stderr.write(
    `blTopicStore: FAILED to commit topic record for ${ticketId} at ${filePath} - the write succeeded locally but is NOT yet durable (git commit failed). It will be lost on a fresh checkout until a later successful commit.\n`
  );
};

// seq is assigned from the CURRENT record's own length at append time - the
// record is always read fresh immediately before writing (never cached
// across calls), so this is correct for the single-writer-per-process
// shape every real caller uses (BL-329's own scope: the front desk bot
// process handles one Telegram update at a time).
export function appendMessage(
  targetPath: string,
  ticketId: string,
  message: { author: string; type: TopicMessageDirection; text: string; ts?: number },
  reportCommitFailure: CommitFailureReporter = reportCommitFailureToStderr
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
  const committed = commitTopicRecord(targetPath, filePath, ticketId);
  if (!committed) {
    reportCommitFailure(ticketId, filePath);
  }
  return entry;
}
