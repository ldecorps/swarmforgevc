// BL-320: the Telegram reply egress's ack-driven, persisted cursor.
// relayNewReplyOutboxEntries (bridgeServer.ts, pre-BL-320) advanced its
// cursor the moment an entry was WRITTEN to the SSE socket, not when the
// bot actually received and posted it - a dropped connection mid-relay
// silently ate the reply, and an in-memory-only cursor forgot everything
// on a bridge restart. This module is the pure, persisted replacement:
// ackedIndex only ever advances on an explicit ack for the entry
// currently sitting at that position, and is durable across restarts.
import * as fs from 'fs';
import * as path from 'path';
import { atomicWrite } from '../util/atomicWrite';
import { ReplyOutboxEntry } from './operatorEventQueue';

export interface ReplyRelayCursorState {
  ackedIndex: number;
}

function cursorFilePath(targetPath: string): string {
  return path.join(targetPath, '.swarmforge', 'operator', 'telegram-reply-relay-cursor.json');
}

// Missing or corrupt (never written yet, or a partial write from a killed
// process - atomicWrite's rename makes the latter structurally near-
// impossible, but a hand-edited/truncated file is still worth degrading
// gracefully from) both mean "nothing genuinely acked yet" - the same
// safe-default posture as every other small-JSON-under-.swarmforge/ marker
// in this codebase (e.g. handoffd.bb's context-clear markers).
export function readPersistedCursor(targetPath: string): ReplyRelayCursorState {
  try {
    const parsed = JSON.parse(fs.readFileSync(cursorFilePath(targetPath), 'utf8')) as Record<string, unknown>;
    if (typeof parsed.ackedIndex === 'number' && Number.isInteger(parsed.ackedIndex) && parsed.ackedIndex >= 0) {
      return { ackedIndex: parsed.ackedIndex };
    }
  } catch {
    // no cursor file yet, or it is not valid JSON - fall through to the default
  }
  return { ackedIndex: 0 };
}

export function writePersistedCursor(targetPath: string, state: ReplyRelayCursorState): void {
  atomicWrite(cursorFilePath(targetPath), JSON.stringify(state));
}

// Pure: advances ackedIndex by exactly one ONLY when the entry currently
// sitting at ackedIndex (unackedEntries[0], since unackedEntries is
// whatever readNewReplyOutboxEntries(targetPath, ackedIndex) returned) is
// the one being acked. A stale ack (e.g. a duplicate ack the bot resends
// after its own reconnect, for an entry already advanced past) or an
// out-of-order ack for the WRONG entry leaves the cursor unchanged rather
// than corrupting it forward past something never actually confirmed.
export function advanceCursorOnAck(ackedIndex: number, ackedId: string, unackedEntries: ReplyOutboxEntry[]): number {
  const next = unackedEntries[0];
  return next && next.id === ackedId ? ackedIndex + 1 : ackedIndex;
}
