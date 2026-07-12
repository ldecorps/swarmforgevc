// BL-281: the bridge's write access into the Operator runtime's OWN files
// - the event queue it enqueues into, and the reply outbox it reads back
// out of. Both are plain newline-delimited JSON, matching operator_
// runtime.bb's own append-event!/read-events shape exactly (one JSON
// object per line) - the bridge and the Babashka runtime are two
// processes sharing these files as their hand-off contract.
import * as fs from 'fs';
import * as path from 'path';
import { atomicAppend } from '../util/atomicWrite';

// Appends one line to .swarmforge/operator/events.jsonl - the bridge is a
// SECOND writer (alongside the runtime's own observed-event appends) for
// TELEGRAM_TOPIC_MESSAGE events specifically; every other event type is
// still runtime-observed exactly as before this ticket.
export function appendOperatorEvent(targetPath: string, event: Record<string, unknown>): void {
  const file = path.join(targetPath, '.swarmforge', 'operator', 'events.jsonl');
  atomicAppend(file, JSON.stringify(event) + '\n');
}

export interface ReplyOutboxEntry {
  // BL-320: the idempotency key a redelivery (a replayed-on-reconnect or
  // replayed-after-restart entry) is deduped against, both bridge-side
  // (advanceCursorOnAck matches an ack against the entry AT the cursor by
  // id) and bot-side (relayOneRecord's seenIds set). operator_reply.bb
  // generates one per line going forward; a line written before this
  // ticket has none, so it is synthesized below from its own absolute
  // line position - stable across re-reads (the file is append-only) and
  // unique, since no two lines share a position.
  id: string;
  threadId: string;
  text: string;
}

// Reads reply-outbox lines strictly AFTER sinceIndex (the count of lines
// already delivered) - the bridge's own "what's new since I last checked"
// cursor, mirroring the SSE poll loop's existing lastSnapshot diff
// convention but for an append-only log instead of a whole-state diff. A
// malformed line is skipped, never a crash of the whole poll.
export function readNewReplyOutboxEntries(targetPath: string, sinceIndex: number): { entries: ReplyOutboxEntry[]; totalLines: number } {
  const file = path.join(targetPath, '.swarmforge', 'operator', 'telegram-reply-outbox.jsonl');
  let content: string;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return { entries: [], totalLines: sinceIndex };
  }
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  const entries: ReplyOutboxEntry[] = [];
  lines.slice(sinceIndex).forEach((line, offset) => {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (typeof parsed.threadId === 'string' && typeof parsed.text === 'string') {
        const id = typeof parsed.id === 'string' ? parsed.id : `legacy-${sinceIndex + offset}`;
        entries.push({ id, threadId: parsed.threadId, text: parsed.text });
      }
    } catch {
      // skip a malformed line rather than crash the whole poll
    }
  });
  return { entries, totalLines: lines.length };
}
