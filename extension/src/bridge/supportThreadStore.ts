// BL-281: the bridge-side (TS) read/write for the SAME SUP-### thread
// store support_thread_store.bb (Babashka) owns for the RC channel -
// mirrors its exact file layout/shape (.swarmforge/support/threads/
// <id>.json) so a thread opened over either channel lives in ONE store,
// never a second implementation. appendMessage is pure (fixture thread +
// fields in, updated thread out); readThread/writeThread are the thin fs
// adapter, mirroring recertification.ts/costTelemetry.ts's own pure+impure
// split.
import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';

export interface ThreadMessage {
  channel: string;
  timestamp: string;
  text: string;
  // BL-369: Telegram's own update_id, when this message originated from an
  // inbound Telegram update - the idempotency key a REDELIVERED POST is
  // deduped against at the bridge (mirrors BL-320's id-based reply-outbox
  // dedup). Undefined for a message with no Telegram update behind it (an
  // outbound/system message, or one written before this ticket).
  updateId?: number;
  // BL-369: true once this message's corresponding Operator-wake event was
  // CONFIRMED durably enqueued - the same "arm on confirmed delivery, never
  // on attempt" discipline the engineering article's alarm-flag rule
  // requires (BL-215/BL-333/BL-345). A message can be present (durably
  // recorded) with this false when the enqueue step itself failed AFTER the
  // transcript write succeeded - exactly the crash window BL-369 exists to
  // close; a retry then re-attempts ONLY the enqueue, never a second
  // transcript write.
  eventQueued?: boolean;
}

export interface SupportThread {
  id: string;
  status: string;
  messages: ThreadMessage[];
}

function threadsDir(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'support', 'threads');
}

function threadPath(targetPath: string, id: string): string {
  return path.join(threadsDir(targetPath), `${id}.json`);
}

export function readThread(targetPath: string, id: string): SupportThread | null {
  try {
    return JSON.parse(fs.readFileSync(threadPath(targetPath, id), 'utf8')) as SupportThread;
  } catch {
    return null;
  }
}

export function writeThread(targetPath: string, thread: SupportThread): void {
  atomicWrite(threadPath(targetPath, thread.id), JSON.stringify(thread));
}

// Pure: appends a message to an existing thread, or opens a fresh one
// (status "open", support_lib.bb's new-thread convention) when none
// exists yet - the bridge route's own "create the thread on first
// mention" fallback, even though the happy path always has one already
// (the Front Desk Bot resolves/creates the SUP-### id before POSTing).
// updateId (BL-369) rides through when the message came from an inbound
// Telegram update; omitted for anything else (outbound/system messages).
export function appendMessage(
  thread: SupportThread | null,
  id: string,
  channel: string,
  timestamp: string,
  text: string,
  updateId?: number
): SupportThread {
  const message: ThreadMessage = updateId === undefined ? { channel, timestamp, text } : { channel, timestamp, text, updateId };
  if (!thread) {
    return { id, status: 'open', messages: [message] };
  }
  return { ...thread, messages: [...thread.messages, message] };
}

// BL-369: the record's own "has THIS update_id already been recorded"
// lookup - the dedup check a redelivered POST needs before writing
// anything, mirroring hasCompletionRecord's own shape in blTopicStore.ts
// (a predicate over the record, not a second parallel index).
export function messageForUpdateId(thread: SupportThread | null, updateId: number): ThreadMessage | undefined {
  return thread?.messages.find((m) => m.updateId === updateId);
}

// Pure: flips eventQueued to true on the ONE message matching updateId,
// once its Operator-wake event is CONFIRMED durably enqueued - never called
// speculatively before that confirmation (see ThreadMessage.eventQueued's
// own docstring for why the ordering matters).
export function withEventQueued(thread: SupportThread, updateId: number): SupportThread {
  return { ...thread, messages: thread.messages.map((m) => (m.updateId === updateId ? { ...m, eventQueued: true } : m)) };
}
