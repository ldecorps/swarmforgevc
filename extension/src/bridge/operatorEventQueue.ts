// BL-281: the bridge's write access into the Operator runtime's OWN files
// - the event queue it enqueues into, and the reply outbox it reads back
// out of. Both are plain newline-delimited JSON, matching operator_
// runtime.bb's own append-event!/read-events shape exactly (one JSON
// object per line) - the bridge and the Babashka runtime are two
// processes sharing these files as their hand-off contract.
import * as fs from 'fs';
import * as path from 'path';
import { atomicAppend } from '../util/atomicWrite';

// BL-369: events.jsonl has TWO writers in TWO PROCESSES - this bridge
// (Node, O_APPEND-safe on its own) and swarmforge/scripts/operator_runtime.bb
// (Babashka), which does FOUR whole-file read-modify-writes per tick. An
// append landing between one of those sites' own read and its commit is
// silently destroyed the instant that commit lands (the BL-369 root-cause
// incident) - O_APPEND protects an append from another append, never from a
// concurrent whole-file rewrite. Reuses the EXACT mkdir-as-mutex convention
// swarm_handoff.bb's next-sequence already establishes (mkdir is atomic on
// POSIX; a second mkdirSync on an existing dir throws EEXIST, caught and
// treated as "held, retry") - the SAME lock DIRECTORY is honored identically
// whether acquired from this Node process or the Babashka one, since mkdir
// is a real filesystem operation, not a language-level primitive. The
// runtime side (operator_runtime.bb) implements the identical protocol
// against the SAME path; neither side owns a canonical "reference impl" -
// they must simply agree, which the shared path + shared semantics achieve.
function eventsLockDir(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'events.jsonl.lock');
}

// env-overridable (mirrors the Babashka side's identical env-var names) so
// a test can drive the bounded-timeout path in milliseconds instead of the
// real 5s default.
function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function lockRetryDelayMs(): number {
  return envMs('OPERATOR_EVENTS_LOCK_RETRY_DELAY_MS', 25);
}

function lockMaxWaitMs(): number {
  return envMs('OPERATOR_EVENTS_LOCK_MAX_WAIT_MS', 5000);
}

// A real synchronous sleep (Node allows Atomics.wait on the main thread,
// unlike browsers) - appendOperatorEvent is a synchronous, void-returning
// function relied on by many existing synchronous call sites; making the
// lock async would ripple an await through all of them for a lock that is
// contended only in a rare, brief cross-process window.
function synchronousSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireEventsLock(lockDir: string): void {
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });
  const deadline = Date.now() + lockMaxWaitMs();
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err;
      }
      if (Date.now() >= deadline) {
        throw new Error(`events lock timed out after ${lockMaxWaitMs()}ms - a stale lock dir may need manual cleanup: ${lockDir}`);
      }
      synchronousSleep(lockRetryDelayMs());
    }
  }
}

function releaseEventsLock(lockDir: string): void {
  fs.rmdirSync(lockDir);
}

export function withEventsLock<T>(targetPath: string, fn: () => T): T {
  const lockDir = eventsLockDir(targetPath);
  acquireEventsLock(lockDir);
  try {
    return fn();
  } finally {
    releaseEventsLock(lockDir);
  }
}

// Appends one line to .swarmforge/operator/events.jsonl - the bridge is a
// SECOND writer (alongside the runtime's own observed-event appends) for
// TELEGRAM_TOPIC_MESSAGE events specifically; every other event type is
// still runtime-observed exactly as before this ticket. BL-369: now
// lock-protected (see withEventsLock above) against operator_runtime.bb's
// own concurrent whole-file rewrites.
export function appendOperatorEvent(targetPath: string, event: Record<string, unknown>): void {
  const file = path.join(targetPath, '.swarmforge', 'operator', 'events.jsonl');
  withEventsLock(targetPath, () => atomicAppend(file, JSON.stringify(event) + '\n'));
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
